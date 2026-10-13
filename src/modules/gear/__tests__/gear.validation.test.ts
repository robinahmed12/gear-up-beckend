import { describe, expect, it } from 'vitest';
import { createGearSchema, gearQuerySchema } from '../gear.validation.js';

const validBase = {
  title: 'Tent',
  description: 'A roomy four person tent for weekend trips',
  pricePerDay: 20,
  categoryId: '00000000-0000-0000-0000-000000000000',
};

describe('createGearSchema.isAvailable', () => {
  it('parses the string "false" as false (not true)', () => {
    const parsed = createGearSchema.parse({ ...validBase, isAvailable: 'false' });
    expect(parsed.isAvailable).toBe(false);
  });

  it('parses the string "true" as true', () => {
    const parsed = createGearSchema.parse({ ...validBase, isAvailable: 'true' });
    expect(parsed.isAvailable).toBe(true);
  });

  it('defaults to true when omitted', () => {
    const parsed = createGearSchema.parse(validBase);
    expect(parsed.isAvailable).toBe(true);
  });

  it('accepts real booleans', () => {
    expect(createGearSchema.parse({ ...validBase, isAvailable: false }).isAvailable).toBe(false);
  });

  it('rejects ambiguous values', () => {
    expect(createGearSchema.safeParse({ ...validBase, isAvailable: 'nope' }).success).toBe(false);
  });
});

describe('gearQuerySchema.isAvailable', () => {
  it('parses the string "false" as false', () => {
    expect(gearQuerySchema.parse({ isAvailable: 'false' }).isAvailable).toBe(false);
  });

  it('parses the string "true" as true', () => {
    expect(gearQuerySchema.parse({ isAvailable: 'true' }).isAvailable).toBe(true);
  });

  it('stays undefined when omitted', () => {
    expect(gearQuerySchema.parse({}).isAvailable).toBeUndefined();
  });
});
