import { RentalStatus } from '../generated/prisma/client.js';
import { ConflictError } from '../errors/ConflictError.js';

export { RentalStatus };

/**
 * Single source of truth for every legal status transition in the
 * rental lifecycle, regardless of which actor (customer vs provider)
 * triggers it. The route/service layer decides WHO is allowed to call
 * which transition; this table only decides WHETHER a transition makes
 * sense at all.
 *
 * PLACED    -> CONFIRMED : provider accepts the request
 * PLACED    -> CANCELLED : customer backs out before the provider acts
 * CONFIRMED -> PAID      : set by the Payments module's Stripe webhook —
 *                          never by a direct status PATCH.
 * PAID      -> PICKED_UP : provider hands over the gear
 * PICKED_UP -> RETURNED  : provider marks the gear returned
 *
 * Anything else — skipping a step (PLACED -> PICKED_UP, or CONFIRMED ->
 * PICKED_UP without paying first), moving backwards (RETURNED ->
 * PICKED_UP), or acting on a terminal status (RETURNED/CANCELLED ->
 * anything) — is rejected.
 */
export const RENTAL_STATUS_TRANSITIONS: Record<RentalStatus, RentalStatus[]> = {
  [RentalStatus.PLACED]: [RentalStatus.CONFIRMED, RentalStatus.CANCELLED],
  [RentalStatus.CONFIRMED]: [RentalStatus.PAID],
  [RentalStatus.PAID]: [RentalStatus.PICKED_UP],
  [RentalStatus.PICKED_UP]: [RentalStatus.RETURNED],
  [RentalStatus.RETURNED]: [],
  [RentalStatus.CANCELLED]: [],
};

/**
 * Throws a clear, actionable ConflictError if `current -> target` isn't
 * a legal transition, instead of letting a nonsensical status change
 * through silently or with a generic error.
 */
export const assertValidTransition = (current: RentalStatus, target: RentalStatus): void => {
  const allowedTargets = RENTAL_STATUS_TRANSITIONS[current] ?? [];

  if (!allowedTargets.includes(target)) {
    const allowedList = allowedTargets.length
      ? allowedTargets.join(', ')
      : '(no further transitions possible)';
    throw new ConflictError(
      `Cannot change order status from ${current} to ${target}. Allowed next status(es): ${allowedList}`,
    );
  }
};

/** Stock is reserved on order creation and released back on these outcomes. */
export const STOCK_RELEASING_STATUSES: RentalStatus[] = [
  RentalStatus.CANCELLED,
  RentalStatus.RETURNED,
];

/**
 * Statuses that still hold a date-scoped reservation against the gear's
 * stock. Availability for a requested window is computed by summing the
 * `quantity` of these orders whose [startDate,endDate) intersects that
 * window. CANCELLED/RETURNED are excluded, so moving an order into either
 * state automatically frees the window it held.
 */
export const RESERVING_STATUSES: RentalStatus[] = [
  RentalStatus.PLACED,
  RentalStatus.CONFIRMED,
  RentalStatus.PAID,
  RentalStatus.PICKED_UP,
];

/**
 * Statuses a PROVIDER may set via PATCH /provider/orders/:id/status.
 * CANCELLED is customer-initiated (separate endpoint, and only from
 * PLACED); PAID is webhook-initiated. This keeps the provider-facing
 * endpoint scoped to exactly the three actions in the requirements.
 */
export const PROVIDER_SETTABLE_STATUSES: RentalStatus[] = [
  RentalStatus.CONFIRMED,
  RentalStatus.PICKED_UP,
  RentalStatus.RETURNED,
];
