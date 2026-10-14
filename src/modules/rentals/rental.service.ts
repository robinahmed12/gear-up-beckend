import { Prisma, Role, PaymentStatus } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../errors/NotFoundError.js';
import { ForbiddenError } from '../../errors/ForbiddenError.js';
import { ConflictError } from '../../errors/ConflictError.js';
import { RentalStatus, assertValidTransition } from '../../constants/orderStatus.js';
import { calculateTotalDays } from '../../utils/rentalDates.js';
import {
  calculateCancellationRefund,
  CancellationTier,
} from '../../utils/cancellation.js';
import {
  calculateOrderPricing,
  buildOrderLineItems,
} from '../../utils/pricing.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import * as depositService from '../payments/deposit.service.js';
import * as refundService from '../payments/refund.service.js';
import {
  acquireGearBookingLock,
  assertGearAvailable,
} from '../availability/availability.service.js';
import {
  getPrismaPagination,
  buildPaginationMeta,
  PaginationMeta,
} from '../../utils/pagination.js';
import {
  CreateRentalInput,
  RentalQueryInput,
  UpdateRentalStatusInput,
  AdminRentalQueryInput,
} from './rental.validation.js';

const rentalSelect = {
  id: true,
  quantity: true,
  startDate: true,
  endDate: true,
  totalDays: true,
  pricePerDay: true,
  subtotal: true,
  serviceFee: true,
  depositAmount: true,
  taxAmount: true,
  currency: true,
  totalAmount: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  customerId: true,
  customer: { select: { id: true, name: true, email: true } },
  gearId: true,
  gear: {
    select: {
      id: true,
      title: true,
      images: true,
      providerId: true,
      provider: { select: { id: true, name: true } },
    },
  },
  payment: { select: { id: true, status: true, method: true } },
} satisfies Prisma.RentalOrderSelect;

export const createRentalOrder = async (customerId: string, input: CreateRentalInput) => {
  const gear = await prisma.gear.findUnique({
    where: { id: input.gearId },
    select: { id: true, pricePerDay: true, isAvailable: true, stock: true },
  });

  if (!gear) {
    throw new NotFoundError('Gear item not found');
  }

  if (!gear.isAvailable) {
    throw new ConflictError('This gear item is currently unavailable for rental');
  }

  const totalDays = calculateTotalDays(input.startDate, input.endDate);
  const pricePerDay = gear.pricePerDay;

  const pricing = calculateOrderPricing({
    pricePerDay,
    quantity: input.quantity,
    totalDays,
    platformFeePercent: env.PLATFORM_FEE_PERCENT,
    depositPercent: env.DEPOSIT_PERCENT,
    currency: env.CURRENCY,
  });

  // Availability is date-scoped: a gear item's `stock` is the number of
  // identical units, and an order reserves `quantity` of them for the
  // half-open window [startDate, endDate). Instead of decrementing a global
  // stock counter, we serialise bookings per gear with an advisory lock and
  // then count overlapping reserving orders — two requests for the same
  // window can never both pass the count.
  return prisma.$transaction(async (tx) => {
    await acquireGearBookingLock(tx, gear.id);
    await assertGearAvailable(tx, gear, {
      startDate: input.startDate,
      endDate: input.endDate,
      quantity: input.quantity,
    });

    const order = await tx.rentalOrder.create({
      data: {
        customerId,
        gearId: input.gearId,
        quantity: input.quantity,
        startDate: input.startDate,
        endDate: input.endDate,
        totalDays,
        pricePerDay,
        subtotal: pricing.subtotal,
        serviceFee: pricing.serviceFee,
        depositAmount: pricing.depositAmount,
        taxAmount: pricing.taxAmount,
        totalAmount: pricing.totalAmount,
        currency: pricing.currency,
        status: RentalStatus.PLACED,
        lineItems: { create: buildOrderLineItems(pricing) },
      },
      select: rentalSelect,
    });

    return order;
  });
};

export const getCustomerRentals = async (
  customerId: string,
  query: RentalQueryInput,
): Promise<{ items: unknown[]; meta: PaginationMeta }> => {
  const where: Prisma.RentalOrderWhereInput = {
    customerId,
    ...(query.status ? { status: query.status } : {}),
  };
  const { skip, take } = getPrismaPagination(query);

  const [items, total] = await Promise.all([
    prisma.rentalOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: rentalSelect,
    }),
    prisma.rentalOrder.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(query, total) };
};

export const getProviderOrders = async (
  providerId: string,
  query: RentalQueryInput,
): Promise<{ items: unknown[]; meta: PaginationMeta }> => {
  const where: Prisma.RentalOrderWhereInput = {
    gear: { providerId },
    ...(query.status ? { status: query.status } : {}),
  };
  const { skip, take } = getPrismaPagination(query);

  const [items, total] = await Promise.all([
    prisma.rentalOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: rentalSelect,
    }),
    prisma.rentalOrder.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(query, total) };
};

/**
 * Platform-wide rental oversight for admins — no ownership scoping,
 * unlike getCustomerRentals/getProviderOrders which are always filtered
 * down to "mine". Admins can additionally slice by customer or provider.
 */
export const getAllRentalsForAdmin = async (
  query: AdminRentalQueryInput,
): Promise<{ items: unknown[]; meta: PaginationMeta }> => {
  const where: Prisma.RentalOrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.providerId ? { gear: { providerId: query.providerId } } : {}),
  };
  const { skip, take } = getPrismaPagination(query);

  const [items, total] = await Promise.all([
    prisma.rentalOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: rentalSelect,
    }),
    prisma.rentalOrder.count({ where }),
  ]);

  return { items, meta: buildPaginationMeta(query, total) };
};

/**
 * Fetches a single order and verifies the requester is either the
 * customer who placed it or the provider who owns the underlying gear.
 * Anyone else gets ForbiddenError, even with a valid token.
 */
export const getRentalByIdForUser = async (
  orderId: string,
  requester: { id: string; role: Role },
) => {
  const order = await prisma.rentalOrder.findUnique({
    where: { id: orderId },
    select: rentalSelect,
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  const isOwningCustomer = order.customerId === requester.id;
  const isOwningProvider = order.gear.providerId === requester.id;

  if (!isOwningCustomer && !isOwningProvider && requester.role !== Role.ADMIN) {
    throw new ForbiddenError('You do not have access to this rental order');
  }

  return order;
};

/**
 * Returns the frozen pricing breakdown for an order plus its itemized line
 * items. Visibility mirrors getRentalByIdForUser: the owning customer, the
 * provider whose gear was rented, or an admin.
 */
export const getRentalBreakdown = async (
  orderId: string,
  requester: { id: string; role: Role },
) => {
  const order = await prisma.rentalOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      customerId: true,
      subtotal: true,
      serviceFee: true,
      depositAmount: true,
      taxAmount: true,
      totalAmount: true,
      currency: true,
      gear: { select: { providerId: true } },
      lineItems: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          description: true,
          createdAt: true,
        },
      },
    },
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  const isOwningCustomer = order.customerId === requester.id;
  const isOwningProvider = order.gear.providerId === requester.id;

  if (!isOwningCustomer && !isOwningProvider && requester.role !== Role.ADMIN) {
    throw new ForbiddenError('You do not have access to this rental order');
  }

  const { customerId: _customerId, gear: _gear, ...breakdown } = order;
  return breakdown;
};

export const updateOrderStatus = async (
  orderId: string,
  providerId: string,
  input: UpdateRentalStatusInput,
) => {
  const order = await prisma.rentalOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      gear: { select: { providerId: true } },
    },
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  if (order.gear.providerId !== providerId) {
    throw new ForbiddenError('You can only manage orders for gear you own');
  }

  assertValidTransition(order.status, input.status);

  // No stock counter to touch: availability is derived from the statuses of
  // date-scoped orders (see RESERVING_STATUSES). Once an order leaves the
  // reserving set (RETURNED/CANCELLED), its window is automatically freed.
  const updated = await prisma.rentalOrder.update({
    where: { id: orderId },
    data: { status: input.status },
    select: rentalSelect,
  });

  // A clean return voids any security-deposit hold. Best-effort: a Stripe
  // hiccup must never block marking the gear returned, so we log and move on
  // (the release can be retried via the admin deposit endpoint).
  if (input.status === RentalStatus.RETURNED) {
    try {
      await depositService.releaseDepositForOrder(orderId);
    } catch (err) {
      logger.warn(
        `Failed to release security deposit for order ${orderId}: ${(err as Error).message}`,
      );
    }
  }

  return updated;
};

/**
 * Called only by the Payments module's Stripe webhook handler once a
 * PaymentIntent succeeds — never by a customer or provider action
 * directly, which is why this takes no requester/ownership argument
 * unlike every other mutation in this file. assertValidTransition still
 * guards it: a webhook retry against an order that's already PAID (or
 * further along) fails loudly instead of silently double-processing.
 */
export const markOrderAsPaid = async (orderId: string) => {
  const order = await prisma.rentalOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  assertValidTransition(order.status, RentalStatus.PAID);

  return prisma.rentalOrder.update({
    where: { id: orderId },
    data: { status: RentalStatus.PAID },
    select: rentalSelect,
  });
};

export interface CancellationActor {
  id: string;
  role: Role;
}

export interface CancellationOutcome {
  /** Which band of the cancellation window applied. */
  tier: CancellationTier;
  /** How much of the charge is (or would be) refunded. */
  refundableAmount: Prisma.Decimal;
  /** Id of the Stripe refund created, or null when nothing was refunded. */
  refundId: string | null;
  /** Whether a security-deposit hold existed and was released. */
  depositReleased: boolean;
}

const CANCELLATION_REASONS: Record<'CUSTOMER' | 'PROVIDER' | 'ADMIN', string> = {
  CUSTOMER: 'Cancelled by customer',
  PROVIDER: 'Cancelled by provider',
  ADMIN: 'Cancelled by admin',
};

/**
 * Voids any security-deposit hold for an order without ever throwing — a
 * cancel/return must not be blocked by a Stripe hiccup. Returns whether a
 * hold actually existed (so callers can report it). Release is idempotent,
 * so retries are safe.
 */
const releaseDepositSafely = async (orderId: string): Promise<boolean> => {
  try {
    const deposit = await depositService.releaseDepositForOrder(orderId);
    return Boolean(deposit);
  } catch (err) {
    logger.warn(`Deposit release failed for order ${orderId}: ${(err as Error).message}`);
    return false;
  }
};

/**
 * Time-tiered refund of the *charge* (the deposit is a hold, not a charge, so
 * it is released rather than refunded). Provider- and admin-initiated
 * cancellations always refund in full; a customer cancellation is banded by
 * how long is left before the start date. Refund failures are logged, never
 * thrown, so a Stripe hiccup can't block the cancellation itself.
 */
const refundOnCancellation = async (
  payment: { id: string; amount: Prisma.Decimal; status: PaymentStatus } | null,
  startDate: Date,
  initiatedBy: 'CUSTOMER' | 'PROVIDER' | 'ADMIN',
): Promise<CancellationOutcome> => {
  const outcome: CancellationOutcome = {
    tier: 'NONE',
    refundableAmount: new Prisma.Decimal(0),
    refundId: null,
    depositReleased: false,
  };

  const refundable =
    payment && (payment.status === PaymentStatus.COMPLETED || payment.status === PaymentStatus.PARTIALLY_REFUNDED);

  if (!payment || !refundable) {
    return outcome;
  }

  const fullRefund = initiatedBy === 'PROVIDER' || initiatedBy === 'ADMIN';

  if (fullRefund) {
    outcome.tier = 'FULL';
    outcome.refundableAmount = payment.amount;
  } else {
    const result = calculateCancellationRefund(payment.amount, startDate, {
      fullRefundHours: env.CANCELLATION_FULL_REFUND_HOURS,
      partialRefundPercent: env.CANCELLATION_PARTIAL_REFUND_PERCENT,
    });
    outcome.tier = result.tier;
    outcome.refundableAmount = result.refundableAmount;
  }

  if (outcome.refundableAmount.lte(0)) {
    return outcome;
  }

  try {
    const refund = await refundService.createRefund({
      paymentId: payment.id,
      // Full refunds (and provider/admin cancellations) omit the amount so
      // the service refunds the entire remaining balance server-side.
      ...(outcome.tier === 'PARTIAL' ? { amount: outcome.refundableAmount.toNumber() } : {}),
      reason:
        initiatedBy === 'CUSTOMER'
          ? `Cancellation (${outcome.tier.toLowerCase()})`
          : `Cancellation by ${initiatedBy.toLowerCase()}`,
    });
    outcome.refundId = refund.id;
  } catch (err) {
    logger.warn(
      `Refund on cancellation failed for payment ${payment.id}: ${(err as Error).message}`,
    );
  }

  return outcome;
};

export const cancelRentalOrder = async (orderId: string, actor: CancellationActor) => {
  const order = await prisma.rentalOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      customerId: true,
      startDate: true,
      gear: { select: { providerId: true } },
      payment: { select: { id: true, amount: true, status: true } },
    },
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  const isOwningCustomer = order.customerId === actor.id;
  const isOwningProvider = order.gear.providerId === actor.id;
  const isAdmin = actor.role === Role.ADMIN;

  if (!isOwningCustomer && !isOwningProvider && !isAdmin) {
    throw new ForbiddenError('You do not have access to cancel this rental order');
  }

  assertValidTransition(order.status, RentalStatus.CANCELLED);

  // CANCELLED drops out of RESERVING_STATUSES, so the date window this order
  // held is released for other customers with no stock bookkeeping at all.
  const cancelled = await prisma.rentalOrder.update({
    where: { id: orderId },
    data: { status: RentalStatus.CANCELLED },
    select: rentalSelect,
  });

  const initiatedBy = isAdmin ? 'ADMIN' : isOwningProvider ? 'PROVIDER' : 'CUSTOMER';

  const depositReleased = await releaseDepositSafely(orderId);
  const outcome = await refundOnCancellation(order.payment, order.startDate, initiatedBy);

  return {
    ...cancelled,
    cancellation: { ...outcome, depositReleased },
  };
};

/**
 * Admin override: force any status regardless of the normal transition graph
 * (e.g. un-stick a mis-sequenced order). Deliberately skips
 * assertValidTransition. Releasing a deposit on CANCELLED/RETURNED is the one
 * side effect that always applies; money movement stays explicit via the
 * payments refund endpoint.
 */
export const adminUpdateOrderStatus = async (orderId: string, status: RentalStatus) => {
  const order = await prisma.rentalOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true },
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  if (order.status === status) {
    return prisma.rentalOrder.findUniqueOrThrow({ where: { id: orderId }, select: rentalSelect });
  }

  const updated = await prisma.rentalOrder.update({
    where: { id: orderId },
    data: { status },
    select: rentalSelect,
  });

  if (status === RentalStatus.CANCELLED || status === RentalStatus.RETURNED) {
    await releaseDepositSafely(orderId);
  }

  return updated;
};
