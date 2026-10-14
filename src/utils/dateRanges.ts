/**
 * Half-open interval overlap: [start, end).
 *
 * Two ranges overlap when each starts before the other ends. Using "strictly
 * less than" (not `<=`) is deliberate: a booking ending exactly when the
 * next begins (10:00 return / 10:00 pickup) does NOT conflict, which is the
 * natural business rule for sequential rentals of the same unit.
 *
 * Examples (all [start, end)):
 *   [1,5) vs [5,9)  -> false (adjacent, touching)
 *   [1,5) vs [2,3)  -> true  (nested)
 *   [1,5) vs [1,5)  -> true  (exact)
 *   [1,5) vs [4,9)  -> true  (partial)
 */
export const rangesOverlap = (
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date,
): boolean => startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();

/** A range is valid only when its end is strictly after its start. */
export const isValidRange = (start: Date, end: Date): boolean =>
  start.getTime() < end.getTime();
