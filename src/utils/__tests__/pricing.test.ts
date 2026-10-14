import { describe, it, expect } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { calculateOrderPricing, buildOrderLineItems, roundMoney } from '../pricing';

const money = (d: Prisma.Decimal) => d.toFixed(2);

describe('calculateOrderPricing', () => {
  it('computes subtotal, fee, deposit and total', () => {
    const pricing = calculateOrderPricing({
      pricePerDay: 20,
      quantity: 1,
      totalDays: 3,
      platformFeePercent: 10,
      depositPercent: 0,
      currency: 'USD',
    });

    expect(money(pricing.subtotal)).toBe('60.00');
    expect(money(pricing.serviceFee)).toBe('6.00');
    expect(money(pricing.depositAmount)).toBe('0.00');
    expect(money(pricing.taxAmount)).toBe('0.00');
    expect(money(pricing.totalAmount)).toBe('66.00');
    expect(pricing.currency).toBe('USD');
  });

  it('multiplies by quantity and rounds each component half-up', () => {
    const pricing = calculateOrderPricing({
      pricePerDay: 19.99,
      quantity: 2,
      totalDays: 3,
      platformFeePercent: 10,
      depositPercent: 15,
      currency: 'USD',
    });

    expect(money(pricing.subtotal)).toBe('119.94');
    expect(money(pricing.serviceFee)).toBe('11.99'); // 11.994 -> 11.99
    expect(money(pricing.depositAmount)).toBe('17.99'); // 17.991 -> 17.99
    expect(money(pricing.totalAmount)).toBe('149.92');
  });

  it('keeps the total exactly equal to the sum of the persisted components', () => {
    const pricing = calculateOrderPricing({
      pricePerDay: 13.37,
      quantity: 3,
      totalDays: 7,
      platformFeePercent: 12.5,
      depositPercent: 7.5,
      currency: 'EUR',
    });

    const sum = pricing.subtotal
      .plus(pricing.serviceFee)
      .plus(pricing.depositAmount)
      .plus(pricing.taxAmount);

    expect(pricing.totalAmount.equals(roundMoney(sum))).toBe(true);
    expect(pricing.currency).toBe('EUR');
  });

  it('produces exact decimal output (no float drift)', () => {
    const pricing = calculateOrderPricing({
      pricePerDay: 0.1,
      quantity: 3,
      totalDays: 1,
      platformFeePercent: 0,
      depositPercent: 0,
      currency: 'USD',
    });

    expect(pricing.subtotal.toString()).toBe('0.3');
  });
});

describe('buildOrderLineItems', () => {
  it('always emits a RENTAL line and omits zero-value components', () => {
    const pricing = calculateOrderPricing({
      pricePerDay: 20,
      quantity: 1,
      totalDays: 3,
      platformFeePercent: 10,
      depositPercent: 0,
      currency: 'USD',
    });

    const items = buildOrderLineItems(pricing);
    const types = items.map((item) => item.type);

    expect(types).toEqual(['RENTAL', 'SERVICE_FEE']);
    expect(money(items[0].amount)).toBe('60.00');
    expect(money(items[1].amount)).toBe('6.00');
  });

  it('includes the deposit line when a deposit applies', () => {
    const pricing = calculateOrderPricing({
      pricePerDay: 100,
      quantity: 1,
      totalDays: 1,
      platformFeePercent: 10,
      depositPercent: 25,
      currency: 'USD',
    });

    const items = buildOrderLineItems(pricing);

    expect(items.map((item) => item.type)).toEqual(['RENTAL', 'SERVICE_FEE', 'DEPOSIT']);
    expect(money(items[2].amount)).toBe('25.00');
    // Line items sum back to the total.
    const sum = items.reduce((acc, item) => acc.plus(item.amount), new Prisma.Decimal(0));
    expect(money(sum)).toBe(money(pricing.totalAmount));
  });
});

describe('roundMoney', () => {
  it('rounds half up to two decimal places', () => {
    expect(money(roundMoney(new Prisma.Decimal('1.005')))).toBe('1.01');
    expect(money(roundMoney(new Prisma.Decimal('1.004')))).toBe('1.00');
  });
});
