import Stripe from 'stripe';
import { Prisma, DepositStatus, OrderLineItemType } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { stripe } from '../../config/stripe.js';
import { NotFoundError } from '../../errors/NotFoundError.js';
import { ConflictError } from '../../errors/ConflictError.js';
import { AppError } from '../../errors/AppError.js';
import { toMinorUnits } from '../../utils/money.js';
import { logger } from '../../utils/logger.js';

/**
 * Security-deposit lifecycle. A deposit is held on the customer's card with
 * a Stripe manual-capture PaymentIntent (authorize now, capture later), kept
 * separate from the rental charge so releasing it never moves collected
 * money. `createStripePayment` creates the PENDING hold; from there:
 *   - Stripe reports the hold as authorized -> AUTHORIZED
 *   - a clean return releases (voids) it     -> RELEASED
 *   - damage/late fees capture (part of) it  -> CAPTURED
 */

export const depositSelect = {
  id: true,
  rentalOrderId: true,
  amount: true,
  currency: true,
  status: true,
  authorizedAt: true,
  releasedAt: true,
  capturedAt: true,
  capturedAmount: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DepositSelect;

/** Trimmed, JSON-safe slice of the PaymentIntent persisted for audit. */
export const summarizeDepositIntent = (pi: Stripe.PaymentIntent) => ({
  id: pi.id,
  status: pi.status,
  amount: pi.amount,
});

/**
 * Marks the hold AUTHORIZED once Stripe confirms the funds are on the card.
 * Keyed by the deposit's PaymentIntent id so it never touches the rental
 * charge's PaymentIntent (which is not a deposit).
 */
export const markDepositAuthorized = async (pi: Stripe.PaymentIntent) => {
  const deposit = await prisma.deposit.findUnique({
    where: { stripePaymentIntentId: pi.id },
    select: { id: true, status: true },
  });

  if (!deposit || deposit.status === DepositStatus.AUTHORIZED) {
    return null;
  }

  return prisma.deposit.update({
    where: { id: deposit.id },
    data: {
      status: DepositStatus.AUTHORIZED,
      authorizedAt: new Date(),
      rawResponse: summarizeDepositIntent(pi),
    },
    select: depositSelect,
  });
};

/**
 * Voids the hold on a clean return. Idempotent: a deposit already released
 * or captured (or fully absent) is returned untouched, so a retried return
 * can't double-release.
 */
export const releaseDepositForOrder = async (orderId: string) => {
  const deposit = await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } });

  if (!deposit) {
    return null;
  }

  if (deposit.status === DepositStatus.RELEASED || deposit.status === DepositStatus.CAPTURED) {
    return deposit;
  }

  if (deposit.stripePaymentIntentId) {
    try {
      await stripe.paymentIntents.cancel(deposit.stripePaymentIntentId);
    } catch (err) {
      // A hold that was never confirmed, or was already canceled, can't be
      // cancelled again — that's fine; we still record the release locally.
      logger.warn(
        `Stripe deposit cancel failed for order ${orderId}: ${(err as Error).message}`,
      );
    }
  }

  return prisma.deposit.update({
    where: { id: deposit.id },
    data: { status: DepositStatus.RELEASED, releasedAt: new Date() },
    select: depositSelect,
  });
};

export interface CaptureDepositInput {
  amount?: number;
  reason?: string;
}

/**
 * Captures (part of) the held deposit to cover damage or late fees. The
 * captured amount is also recorded as a DAMAGE_FEE line item so the order
 * carries a visible, itemized penalty; whatever isn't captured is released
 * back to the customer by Stripe automatically.
 */
export const captureDepositForOrder = async (orderId: string, input: CaptureDepositInput) => {
  const deposit = await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } });

  if (!deposit) {
    throw new NotFoundError('No security deposit found for this order');
  }

  if (deposit.status !== DepositStatus.AUTHORIZED) {
    throw new ConflictError(
      `The security deposit cannot be captured while it is ${deposit.status}.`,
    );
  }

  if (!deposit.stripePaymentIntentId) {
    throw new ConflictError('The security deposit has no Stripe authorization to capture.');
  }

  const captureAmount =
    input.amount === undefined ? deposit.amount : new Prisma.Decimal(input.amount);

  if (captureAmount.lte(0)) {
    throw new AppError('Capture amount must be greater than zero', 400);
  }
  if (captureAmount.gt(deposit.amount)) {
    throw new AppError(
      `Capture amount cannot exceed the held deposit of ${deposit.amount.toString()}`,
      400,
    );
  }

  const pi = await stripe.paymentIntents.capture(deposit.stripePaymentIntentId, {
    amount_to_capture: toMinorUnits(captureAmount),
  });

  const updated = await prisma.deposit.update({
    where: { id: deposit.id },
    data: {
      status: DepositStatus.CAPTURED,
      capturedAmount: captureAmount,
      capturedAt: new Date(),
      rawResponse: summarizeDepositIntent(pi),
    },
    select: depositSelect,
  });

  await prisma.orderLineItem.create({
    data: {
      rentalOrderId: orderId,
      type: OrderLineItemType.DAMAGE_FEE,
      amount: captureAmount,
      currency: deposit.currency,
      description: input.reason ?? 'Damage/late fee captured from security deposit',
    },
  });

  return updated;
};

export const getDepositForOrder = async (orderId: string) => {
  const deposit = await prisma.deposit.findUnique({
    where: { rentalOrderId: orderId },
    select: depositSelect,
  });

  if (!deposit) {
    throw new NotFoundError('No security deposit found for this order');
  }

  return deposit;
};
