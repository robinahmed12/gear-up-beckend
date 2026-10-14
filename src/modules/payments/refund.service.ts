import Stripe from 'stripe';
import { Prisma, PaymentStatus, RefundStatus } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { stripe } from '../../config/stripe.js';
import { NotFoundError } from '../../errors/NotFoundError.js';
import { ConflictError } from '../../errors/ConflictError.js';
import { AppError } from '../../errors/AppError.js';
import { toMinorUnits, fromMinorUnits } from '../../utils/money.js';

export const refundSelect = {
  id: true,
  paymentId: true,
  amount: true,
  currency: true,
  reason: true,
  status: true,
  stripeRefundId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RefundSelect;

const ZERO = new Prisma.Decimal(0);

const mapRefundStatus = (status: Stripe.Refund['status']): RefundStatus => {
  switch (status) {
    case 'succeeded':
      return RefundStatus.SUCCEEDED;
    case 'failed':
    case 'canceled':
      return RefundStatus.FAILED;
    default:
      // 'pending' | 'requires_action' — still settling.
      return RefundStatus.PENDING;
  }
};

const summarizeRefund = (refund: Stripe.Refund) => ({
  id: refund.id,
  amount: refund.amount,
  currency: refund.currency,
  status: refund.status,
  reason: refund.reason,
});

const paymentIntentIdOf = (value: Stripe.Charge['payment_intent']): string | null =>
  typeof value === 'string' ? value : (value?.id ?? null);

/** Sum of successfully-settled refunds for a payment. */
const sumSucceededRefunds = async (paymentId: string): Promise<Prisma.Decimal> => {
  const agg = await prisma.refund.aggregate({
    where: { paymentId, status: RefundStatus.SUCCEEDED },
    _sum: { amount: true },
  });

  return agg._sum.amount ?? ZERO;
};

/**
 * Recomputes a payment's refund state from its settled refunds. Only ever
 * moves a payment *into* a refunded state, never downgrades it, and is a
 * no-op when the status already matches — so webhook replays are safe.
 */
export const reconcilePaymentRefundStatus = async (paymentId: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, amount: true, status: true },
  });

  if (!payment) {
    return null;
  }

  const refunded = await sumSucceededRefunds(paymentId);
  let nextStatus: PaymentStatus | null = null;

  if (refunded.gte(payment.amount) && payment.amount.gt(0)) {
    nextStatus = PaymentStatus.REFUNDED;
  } else if (refunded.gt(0)) {
    nextStatus = PaymentStatus.PARTIALLY_REFUNDED;
  }

  if (!nextStatus || nextStatus === payment.status) {
    return payment;
  }

  return prisma.payment.update({
    where: { id: paymentId },
    data: { status: nextStatus },
    select: { id: true, status: true },
  });
};

export interface CreateRefundInput {
  paymentId: string;
  amount?: number;
  reason?: string;
}

/**
 * Issues a full or partial refund against a captured payment. The amount is
 * always derived server-side from the payment's refundable balance — a
 * client can never refund more than was actually collected.
 */
export const createRefund = async (input: CreateRefundInput) => {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    select: {
      id: true,
      amount: true,
      currency: true,
      status: true,
      transactionId: true,
      rentalOrder: { select: { id: true, status: true } },
    },
  });

  if (!payment) {
    throw new NotFoundError('Payment not found');
  }

  if (
    payment.status !== PaymentStatus.COMPLETED &&
    payment.status !== PaymentStatus.PARTIALLY_REFUNDED
  ) {
    throw new ConflictError(
      `Only a captured payment can be refunded (this one is ${payment.status}).`,
    );
  }

  const alreadyRefunded = await sumSucceededRefunds(payment.id);
  const refundable = payment.amount.minus(alreadyRefunded);

  if (refundable.lte(0)) {
    throw new ConflictError('This payment has already been fully refunded');
  }

  const amount = input.amount === undefined ? refundable : new Prisma.Decimal(input.amount);

  if (amount.lte(0)) {
    throw new AppError('Refund amount must be greater than zero', 400);
  }
  if (amount.gt(refundable)) {
    throw new AppError(
      `Refund amount exceeds the refundable balance of ${refundable.toString()}`,
      400,
    );
  }

  const stripeRefund = await stripe.refunds.create({
    payment_intent: payment.transactionId,
    amount: toMinorUnits(amount),
    ...(input.reason ? { metadata: { reason: input.reason } } : {}),
  });

  const refund = await prisma.refund.upsert({
    where: { stripeRefundId: stripeRefund.id },
    create: {
      paymentId: payment.id,
      stripeRefundId: stripeRefund.id,
      amount: fromMinorUnits(stripeRefund.amount),
      currency: (stripeRefund.currency ?? payment.currency).toUpperCase(),
      reason: input.reason ?? null,
      status: mapRefundStatus(stripeRefund.status),
      rawResponse: summarizeRefund(stripeRefund),
    },
    update: {
      status: mapRefundStatus(stripeRefund.status),
      rawResponse: summarizeRefund(stripeRefund),
    },
    select: refundSelect,
  });

  await reconcilePaymentRefundStatus(payment.id);

  return refund;
};

/**
 * Webhook reconciliation for `charge.refunded`. Every refund Stripe knows
 * about is upserted by its unique id, so replaying the event (or a refund
 * issued from the Stripe dashboard) never creates duplicates or moves money
 * twice.
 */
export const handleChargeRefunded = async (charge: Stripe.Charge) => {
  const stripePaymentIntentId = paymentIntentIdOf(charge.payment_intent);
  if (!stripePaymentIntentId) {
    return null;
  }

  const payment = await prisma.payment.findUnique({
    where: { transactionId: stripePaymentIntentId },
    select: { id: true, currency: true },
  });

  if (!payment) {
    return null;
  }

  const refunds = charge.refunds?.data ?? [];

  for (const refund of refunds) {
    const status = mapRefundStatus(refund.status);
    await prisma.refund.upsert({
      where: { stripeRefundId: refund.id },
      create: {
        paymentId: payment.id,
        stripeRefundId: refund.id,
        amount: fromMinorUnits(refund.amount),
        currency: (refund.currency ?? payment.currency).toUpperCase(),
        reason: refund.reason,
        status,
        rawResponse: summarizeRefund(refund),
      },
      update: { status, rawResponse: summarizeRefund(refund) },
    });
  }

  return reconcilePaymentRefundStatus(payment.id);
};
