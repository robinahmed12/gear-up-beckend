import { describe, expect, it } from 'vitest';
import { booleanish } from '../booleanSchema.js';

describe('booleanish', () => {
  it('accepts real booleans', () => {
    expect(booleanish.parse(true)).toBe(true);
    expect(booleanish.parse(false)).toBe(false);
  });

  it('accepts "true"/"false" strings in any case and trims whitespace', () => {
    expect(booleanish.parse('true')).toBe(true);
    expect(booleanish.parse('TRUE')).toBe(true);
    expect(booleanish.parse(' false ')).toBe(false);
    expect(booleanish.parse('False')).toBe(false);
  });

  it('rejects ambiguous or non-boolean values', () => {
    for (const bad of ['1', '0', 'yes', 'no', '', 'truthy', 1, null]) {
      expect(booleanish.safeParse(bad).success).toBe(false);
    }
  });
});
