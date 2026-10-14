import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma.js';
import { NotFoundError } from '../../errors/NotFoundError.js';
import { ForbiddenError } from '../../errors/ForbiddenError.js';
import { ConflictError } from '../../errors/ConflictError.js';
import { RESERVING_STATUSES } from '../../constants/orderStatus.js';
import { CreateBlockInput } from './availability.validation.js';

/** Minimal gear shape the availability engine needs to reason about stock. */
type GearForAvailability = { id: string; stock: number; isAvailable: boolean };

interface RangeInput {
  startDate: Date;
  endDate: Date;
  quantity?: number;
}

export interface AvailabilityResult {
  available: boolean;
  isAvailable: boolean;
  stock: number;
  reserved: number;
  remaining: number;
  quantity: number;
  blocked: boolean;
  reason?: string;
}

/**
 * Accepts either the shared PrismaClient or an interactive-transaction
 * client, so the exact same evaluation runs for a read-only query and for
 * the in-transaction booking check.
 */
type Db = Prisma.TransactionClient;

/**
 * Counts how many units are already committed for the requested window and
 * decides whether one more rental of `quantity` units fits. The overlap test
 * is half-open (`startDate < requested.endDate AND endDate > requested.startDate`),
 * matching `rangesOverlap` in `src/utils/dateRanges.ts`.
 */
export const evaluateAvailability = async (
  db: Db,
  gear: GearForAvailability,
  input: RangeInput,
): Promise<AvailabilityResult> => {
  const quantity = input.quantity ?? 1;

  const [overlapping, blockCount] = await Promise.all([
    db.rentalOrder.aggregate({
      where: {
        gearId: gear.id,
        status: { in: RESERVING_STATUSES },
        startDate: { lt: input.endDate },
        endDate: { gt: input.startDate },
      },
      _sum: { quantity: true },
    }),
    db.gearAvailabilityBlock.count({
      where: {
        gearId: gear.id,
        startDate: { lt: input.endDate },
        endDate: { gt: input.startDate },
      },
    }),
  ]);

  const reserved = overlapping._sum.quantity ?? 0;
  const remaining = Math.max(0, gear.stock - reserved);
  const blocked = blockCount > 0;

  let reason: string | undefined;
  if (!gear.isAvailable) {
    reason = 'This gear item is currently unavailable for rental';
  } else if (blocked) {
    reason = 'This gear is blocked by the provider for the selected dates';
  } else if (reserved + quantity > gear.stock) {
    reason = 'This gear is already fully booked for the selected dates';
  }

  return {
    available: reason === undefined,
    isAvailable: gear.isAvailable,
    stock: gear.stock,
    reserved,
    remaining,
    quantity,
    blocked,
    ...(reason ? { reason } : {}),
  };
};

export const getGearAvailability = async (
  gearId: string,
  input: RangeInput,
): Promise<AvailabilityResult> => {
  const gear = await prisma.gear.findUnique({
    where: { id: gearId },
    select: { id: true, stock: true, isAvailable: true },
  });

  if (!gear) {
    throw new NotFoundError('Gear item not found');
  }

  return evaluateAvailability(prisma, gear, input);
};

/**
 * Takes a per-gear advisory lock for the remainder of the current
 * transaction. Concurrent bookings for the same gear (and only that gear)
 * queue up here, so the overlap count that follows can never race.
 */
export const acquireGearBookingLock = async (db: Db, gearId: string): Promise<void> => {
  // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns void, which
  // Prisma cannot deserialize as a result set.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${gearId}))`;
};

/**
 * Booking-side guard: must be called AFTER `acquireGearBookingLock` and
 * inside the same transaction. Throws a 409 ConflictError when the window
 * cannot be honoured.
 */
export const assertGearAvailable = async (
  db: Db,
  gear: GearForAvailability,
  input: Required<RangeInput>,
): Promise<void> => {
  const result = await evaluateAvailability(db, gear, input);

  if (!result.available) {
    throw new ConflictError(result.reason ?? 'This gear is not available for the selected dates');
  }
};

// ─────────────────────────────────────────────────────────────
// Provider block CRUD
// ─────────────────────────────────────────────────────────────

const assertProviderOwnsGear = async (gearId: string, providerId: string): Promise<void> => {
  const gear = await prisma.gear.findUnique({
    where: { id: gearId },
    select: { providerId: true },
  });

  if (!gear) {
    throw new NotFoundError('Gear item not found');
  }

  if (gear.providerId !== providerId) {
    throw new ForbiddenError('You can only manage availability for gear you own');
  }
};

export const listGearBlocks = async (gearId: string, providerId: string) => {
  await assertProviderOwnsGear(gearId, providerId);

  return prisma.gearAvailabilityBlock.findMany({
    where: { gearId },
    orderBy: { startDate: 'asc' },
  });
};

export const createGearBlock = async (
  gearId: string,
  providerId: string,
  input: CreateBlockInput,
) => {
  await assertProviderOwnsGear(gearId, providerId);

  return prisma.gearAvailabilityBlock.create({
    data: {
      gearId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
    },
  });
};

export const deleteGearBlock = async (
  gearId: string,
  blockId: string,
  providerId: string,
): Promise<void> => {
  await assertProviderOwnsGear(gearId, providerId);

  const block = await prisma.gearAvailabilityBlock.findUnique({
    where: { id: blockId },
    select: { id: true, gearId: true },
  });

  if (!block || block.gearId !== gearId) {
    throw new NotFoundError('Availability block not found');
  }

  await prisma.gearAvailabilityBlock.delete({ where: { id: blockId } });
};
