import { describe, it, expect } from 'vitest';
import { calculateCancellationRefund, hoursUntilStart } from '../cancellation.js';

const HOUR = 60 * 60 * 1000;
const policy = { fullRefundHours: 48, partialRefundPercent: 50 };
const now = new Date('2026-10-14T12:00:00.000Z');
const at = (hoursFromNow: number) => new Date(now.getTime() + hoursFromNow * HOUR);

describe('calculateCancellationRefund', () => {
  it('refunds the whole charge at or beyond the full-refund window', () => {
    const result = calculateCancellationRefund(66, at(48), policy, now);
    expect(result.tier).toBe('FULL');
    expect(result.refundableAmount.toNumber()).toBe(66);
  });

  it('refunds the whole charge well before the window', () => {
    const result = calculateCancellationRefund('66', at(200), policy, now);
    expect(result.tier).toBe('FULL');
    expect(result.refundableAmount.toNumber()).toBe(66);
  });

  it('refunds a percentage just inside the partial window', () => {
    const result = calculateCancellationRefund(66, at(47.9), policy, now);
    expect(result.tier).toBe('PARTIAL');
    expect(result.refundableAmount.toNumber()).toBe(33);
  });

  it('refunds nothing once the rental has started', () => {
    const result = calculateCancellationRefund(66, at(0), policy, now);
    expect(result.tier).toBe('NONE');
    expect(result.refundableAmount.toNumber()).toBe(0);
  });

  it('refunds nothing after the start date has passed', () => {
    const result = calculateCancellationRefund(66, at(-10), policy, now);
    expect(result.tier).toBe('NONE');
    expect(result.refundableAmount.toNumber()).toBe(0);
  });

  it('rounds partial refunds half-up to two decimals', () => {
    // 10.01 * 50% = 5.005 -> 5.01
    const result = calculateCancellationRefund('10.01', at(24), policy, now);
    expect(result.refundableAmount.toFixed(2)).toBe('5.01');
  });

  it('honors a custom policy', () => {
    const custom = { fullRefundHours: 0, partialRefundPercent: 25 };
    const before = calculateCancellationRefund(100, at(1), custom, now);
    expect(before.tier).toBe('FULL');
    expect(before.refundableAmount.toNumber()).toBe(100);
  });
});

describe('hoursUntilStart', () => {
  it('is positive before the start and negative after', () => {
    expect(hoursUntilStart(at(24), now)).toBe(24);
    expect(hoursUntilStart(at(-2), now)).toBe(-2);
  });
});
