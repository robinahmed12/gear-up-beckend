import { Prisma, PaymentMethod, PaymentStatus } from '../../generated/prisma/client.js';
import Stripe from 'stripe';
import { prisma } from '../../config/prisma.js';
import { stripe } from '../../config/stripe.js';
import { NotFoundError } from '../../errors/NotFoundError.js';
import { ForbiddenError } from '../../errors/ForbiddenError.js';
import { ConflictError } from '../../errors/ConflictError.js';
import { AppError } from '../../errors/AppError.js';
import { RentalStatus } from '../../constants/orderStatus.js';
import {
  getPrismaPagination,
  buildPaginationMeta,
  PaginationMeta,
} from '../../utils/pagination.js';
import * as rentalService from '../rentals/rental.service.js';
import { PaymentQueryInput, CreatePaymentInput } from './payment.validation.js';

// Admin oversight (list/view every payment) lives alongside customer-facing
// creation + Stripe webhook handling in this one service — all of it
// operates on the same Payment model, and splitting "read" from "write"
// across files would just mean importing paymentSelect back and forth.
const paymentSelect = {
  id: true,
  transactionId: true,
  amount: true,
  currency: true,
  method: true,
  status: true,
  paidAt: true,
  createdAt: true,
  updatedAt: true,
  rentalOrderId: true,
  rentalOrder: {
    select: {
      id: true,
      status: true,
      customerId: true,
      customer: { select: { id: true, name: true, email: true } },
      gear: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

const buildPaymentWhere = (query: PaymentQueryInput): Prisma.PaymentWhereInput => {
  const where: Prisma.PaymentWhereInput = {};

  if (query.status) {
    where.status = query.status;
  }

  if (query.method) {
    where.method = query.method;
  }

  return where;
};

// ─────────────────────────────────────────────────────────────
// Admin oversight
// ─────────────────────────────────────────────────────────────

export const listPaymentsForAdmin = async (
  query: PaymentQueryInput,
): Promise<{ items: unknown[]; meta: PaginationMeta }> => {
  const where = buildPaymentWhere(query);
  const { skip, take } = getPrismaPagination(query);

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: paymentSelect,
    }),
    prisma.payment.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(query, total) };
};

export const getPaymentByIdForAdmin = async (id: string) => {
  const payment = await prisma.payment.findUnique({ where: { id }, select: paymentSelect });

  if (!payment) {
    throw new NotFoundError('Payment not found');
  }

  return payment;
};

// ─────────────────────────────────────────────────────────────
// Customer-facing: history + detail (scoped to their own orders)
// ─────────────────────────────────────────────────────────────

export const getPaymentHistoryForCustomer = async (
  customerId: string,
  query: PaymentQueryInput,
): Promise<{ items: unknown[]; meta: PaginationMeta }> => {
  const where: Prisma.PaymentWhereInput = {
    ...buildPaymentWhere(query),
    rentalOrder: { customerId },
  };
  const { skip, take } = getPrismaPagination(query);

  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: paymentSelect,
    }),
    prisma.payment.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(query, total) };
};

export const getPaymentByIdForCustomer = async (id: string, customerId: string) => {
  const payment = await prisma.payment.findUnique({ where: { id }, select: paymentSelect });

  if (!payment) {
    throw new NotFoundError('Payment not found');
  }

  if (payment.rentalOrder.customerId !== customerId) {
    throw new ForbiddenError('You do not have access to this payment');
  }

  return payment;
};

// ─────────────────────────────────────────────────────────────
// Create payment (Stripe)
// ─────────────────────────────────────────────────────────────

const centsFromDecimal = (amount: Prisma.Decimal | number): number =>
  Math.round(Number(amount) * 100);

/**
 * Creates a Stripe PaymentIntent for a CONFIRMED rental order and
 * persists a matching PENDING Payment row. `Payment.rentalOrderId` is
 * `@unique` in the schema (one payment record per order, ever), so a
 * retry after a failed/abandoned attempt updates the existing row
 * in-place with a fresh PaymentIntent rather than inserting a second
 * one — trying to `create` twice would hit a unique-constraint error.
 */
export const createStripePayment = async (customerId: string, input: CreatePaymentInput) => {
  if (input.method !== PaymentMethod.STRIPE) {
    throw new AppError(
      `${input.method} is not supported yet — only STRIPE payments can be created in this phase.`,
      400,
    );
  }

  const order = await prisma.rentalOrder.findUnique({
    where: { id: input.rentalOrderId },
    select: {
      id: true,
      customerId: true,
      status: true,
      totalAmount: true,
      currency: true,
      customer: { select: { name: true, email: true } },
      gear: { select: { title: true } },
      payment: { select: { id: true, status: true } },
    },
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  if (order.customerId !== customerId) {
    throw new ForbiddenError('You can only pay for your own rental orders');
  }

  if (order.status !== RentalStatus.CONFIRMED) {
    throw new ConflictError(
      `Cannot initiate payment while the order is ${order.status}. Payment is only accepted once the provider has confirmed the order.`,
    );
  }

  if (order.payment?.status === PaymentStatus.COMPLETED) {
    throw new ConflictError('This rental order has already been paid for');
  }

  // Stripe expects a lowercase ISO-4217 currency; the order's snapshot is
  // stored uppercase for display, so normalize here rather than hardcoding.
  const currency = order.currency.toLowerCase();

  const paymentIntent = await stripe.paymentIntents.create({
    amount: centsFromDecimal(order.totalAmount),
    currency,
    receipt_email: order.customer.email,
    description: `GearUp rental — ${order.gear.title}`,
    metadata: { rentalOrderId: order.id, customerId },
  });

  const data = {
    transactionId: paymentIntent.id,
    amount: order.totalAmount,
    currency: order.currency,
    method: PaymentMethod.STRIPE,
    status: PaymentStatus.PENDING,
  };

  const payment = order.payment
    ? await prisma.payment.update({
        where: { rentalOrderId: order.id },
        data,
        select: paymentSelect,
      })
    : await prisma.payment.create({
        data: { ...data, rentalOrderId: order.id },
        select: paymentSelect,
      });

  return { payment, clientSecret: paymentIntent.client_secret };
};

// ─────────────────────────────────────────────────────────────
// Stripe webhook handlers
// ─────────────────────────────────────────────────────────────

/**
 * Only a trimmed, JSON-safe slice of the Stripe object is persisted to
 * `Payment.rawResponse` — the full PaymentIntent can contain more than
 * we need for an audit trail, and this keeps the stored payload small
 * and predictable to read later.
 */
const summarizePaymentIntent = (pi: Stripe.PaymentIntent) => ({
  id: pi.id,
  status: pi.status,
  amount: pi.amount,
  currency: pi.currency,
  lastPaymentError: pi.last_payment_error?.message ?? null,
});

/**
 * Idempotent by design: Stripe redelivers webhook events on any
 * non-2xx response or timeout, so a payment already marked COMPLETED
 * is left untouched instead of re-running the RentalOrder transition
 * (which would otherwise throw via assertValidTransition on redelivery).
 */
export const handleStripePaymentSucceeded = async (
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> => {
  const payment = await prisma.payment.findUnique({
    where: { transactionId: paymentIntent.id },
    select: { id: true, status: true, rentalOrderId: true },
  });

  if (!payment || payment.status === PaymentStatus.COMPLETED) {
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.COMPLETED,
      paidAt: new Date(),
      rawResponse: summarizePaymentIntent(paymentIntent),
    },
  });

  await rentalService.markOrderAsPaid(payment.rentalOrderId);
};

export const handleStripePaymentFailed = async (
  paymentIntent: Stripe.PaymentIntent,
): Promise<void> => {
  const payment = await prisma.payment.findUnique({
    where: { transactionId: paymentIntent.id },
    select: { id: true, status: true },
  });

  if (!payment || payment.status === PaymentStatus.COMPLETED) {
    return;
  }

  await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: PaymentStatus.FAILED,
      rawResponse: summarizePaymentIntent(paymentIntent),
    },
  });
};
