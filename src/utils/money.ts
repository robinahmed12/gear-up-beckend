import { Prisma } from '../generated/prisma/client.js';

/**
 * Stripe works in integer minor units (cents for USD). All conversions
 * between our Decimal money columns and Stripe amounts funnel through
 * these two helpers so rounding can never drift between the charge, the
 * deposit hold, and a refund.
 */
export const toMinorUnits = (amount: Prisma.Decimal | number | string): number =>
  Math.round(Number(amount) * 100);

export const fromMinorUnits = (minor: number): Prisma.Decimal =>
  new Prisma.Decimal(minor).dividedBy(100);
