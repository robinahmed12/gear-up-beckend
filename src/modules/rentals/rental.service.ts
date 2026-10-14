import { Prisma, Role } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../errors/NotFoundError.js';
import { ForbiddenError } from '../../errors/ForbiddenError.js';
import { ConflictError } from '../../errors/ConflictError.js';
import { RentalStatus, assertValidTransition } from '../../constants/orderStatus.js';
import { calculateTotalDays } from '../../utils/rentalDates.js';
import {
  calculateOrderPricing,
  buildOrderLineItems,
} from '../../utils/pricing.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import * as depositService from '../payments/deposit.service.js';
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

export const cancelRentalOrder = async (orderId: string, customerId: string) => {
  const order = await prisma.rentalOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, customerId: true },
  });

  if (!order) {
    throw new NotFoundError('Rental order not found');
  }

  if (order.customerId !== customerId) {
    throw new ForbiddenError('You can only cancel your own rental orders');
  }

  assertValidTransition(order.status, RentalStatus.CANCELLED);

  // CANCELLED drops out of RESERVING_STATUSES, so the date window this order
  // held is released for other customers without any stock bookkeeping.
  return prisma.rentalOrder.update({
    where: { id: orderId },
    data: { status: RentalStatus.CANCELLED },
    select: rentalSelect,
  });
};
