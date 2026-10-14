import { Prisma } from '../generated/prisma/client.js';
import { roundMoney } from './pricing.js';

const MS_PER_HOUR = 1000 * 60 * 60;

/** Which band of the cancellation window a cancellation falls into. */
export type CancellationTier = 'FULL' | 'PARTIAL' | 'NONE';

export interface CancellationPolicy {
  /** Cancelling at least this many hours before start refunds in full. */
  fullRefundHours: number;
  /** Whole-number percent refunded inside the partial window (50 === 50%). */
  partialRefundPercent: number;
}

export interface CancellationRefundResult {
  tier: CancellationTier;
  refundableAmount: Prisma.Decimal;
  hoursUntilStart: number;
}

/** Hours between `now` and the rental start; negative once it has started. */
export const hoursUntilStart = (startDate: Date, now: Date = new Date()): number =>
  (startDate.getTime() - now.getTime()) / MS_PER_HOUR;

/**
 * The refund owed when a rental is cancelled, as a pure function of the
 * amount charged, the start date and the active policy. Kept separate from
 * the service layer so the tiering rules can be unit-tested without a DB or
 * a Stripe key, and so both customer- and (for the full-refund shortcut)
 * provider/admin-initiated cancellations share one source of truth.
 *
 *   hoursUntilStart >= fullRefundHours  -> FULL    (whole charge)
 *   0 < hoursUntilStart <  fullHours    -> PARTIAL (partialRefundPercent%)
 *   hoursUntilStart <= 0                -> NONE    (rental already started)
 */
export const calculateCancellationRefund = (
  chargeAmount: Prisma.Decimal | number | string,
  startDate: Date,
  policy: CancellationPolicy,
  now: Date = new Date(),
): CancellationRefundResult => {
  const amount = new Prisma.Decimal(chargeAmount);
  const hours = hoursUntilStart(startDate, now);

  if (hours <= 0) {
    return { tier: 'NONE', refundableAmount: new Prisma.Decimal(0), hoursUntilStart: hours };
  }

  if (hours >= policy.fullRefundHours) {
    return { tier: 'FULL', refundableAmount: roundMoney(amount), hoursUntilStart: hours };
  }

  return {
    tier: 'PARTIAL',
    refundableAmount: roundMoney(amount.times(policy.partialRefundPercent).dividedBy(100)),
    hoursUntilStart: hours,
  };
};
