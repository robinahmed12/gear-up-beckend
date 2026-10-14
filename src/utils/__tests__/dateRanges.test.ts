import { describe, it, expect } from 'vitest';
import { rangesOverlap, isValidRange } from '../dateRanges';

const d = (s: string) => new Date(s);

describe('rangesOverlap', () => {
  it('returns false for adjacent (touching) half-open ranges', () => {
    expect(rangesOverlap(d('2026-01-01'), d('2026-01-05'), d('2026-01-05'), d('2026-01-09'))).toBe(
      false,
    );
    expect(rangesOverlap(d('2026-01-05'), d('2026-01-09'), d('2026-01-01'), d('2026-01-05'))).toBe(
      false,
    );
  });

  it('returns true for identical ranges', () => {
    expect(rangesOverlap(d('2026-01-01'), d('2026-01-05'), d('2026-01-01'), d('2026-01-05'))).toBe(
      true,
    );
  });

  it('returns true when one range is nested inside the other', () => {
    expect(rangesOverlap(d('2026-01-01'), d('2026-01-10'), d('2026-01-03'), d('2026-01-04'))).toBe(
      true,
    );
  });

  it('returns true for partial overlap on either edge', () => {
    expect(rangesOverlap(d('2026-01-01'), d('2026-01-05'), d('2026-01-04'), d('2026-01-09'))).toBe(
      true,
    );
    expect(rangesOverlap(d('2026-01-04'), d('2026-01-09'), d('2026-01-01'), d('2026-01-05'))).toBe(
      true,
    );
  });

  it('returns false when ranges are fully disjoint', () => {
    expect(rangesOverlap(d('2026-01-01'), d('2026-01-05'), d('2026-01-10'), d('2026-01-15'))).toBe(
      false,
    );
  });
});

describe('isValidRange', () => {
  it('accepts end strictly after start', () => {
    expect(isValidRange(d('2026-01-01'), d('2026-01-02'))).toBe(true);
  });

  it('rejects zero-length and inverted ranges', () => {
    expect(isValidRange(d('2026-01-01'), d('2026-01-01'))).toBe(false);
    expect(isValidRange(d('2026-01-05'), d('2026-01-01'))).toBe(false);
  });
});
