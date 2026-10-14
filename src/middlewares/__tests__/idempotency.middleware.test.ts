import { describe, it, expect } from 'vitest';
import { stableStringify } from '../idempotency.middleware';

describe('stableStringify', () => {
  it('is independent of object key order', () => {
    expect(stableStringify({ a: 1, b: 2, c: 3 })).toBe(stableStringify({ c: 3, a: 1, b: 2 }));
  });

  it('distinguishes different Date values (zod-coerced date fields)', () => {
    const first = stableStringify({ startDate: new Date('2026-01-01T00:00:00.000Z') });
    const second = stableStringify({ startDate: new Date('2026-02-01T00:00:00.000Z') });

    expect(first).not.toBe(second);
    expect(first).toContain('2026-01-01');
  });

  it('serializes nested arrays and objects deterministically', () => {
    const value = { list: [1, { nested: true, n: null }], flag: false };

    expect(stableStringify(value)).toBe(
      '{"flag":false,"list":[1,{"n":null,"nested":true}]}',
    );
  });

  it('differs when any value differs', () => {
    expect(stableStringify({ quantity: 1 })).not.toBe(stableStringify({ quantity: 2 }));
  });
});
