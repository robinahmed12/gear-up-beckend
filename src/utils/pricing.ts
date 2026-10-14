import { Prisma, OrderLineItemType } from '../generated/prisma/client.js';

const Decimal = Prisma.Decimal;

const MONEY_SCALE = 2;

/**
 * Rounds to 2 decimal places with ROUND_HALF_UP. All order money math goes
 * through this so float-style drift (0.1 + 0.2) can never reach the DB or
 * Stripe, and so the persisted total always equals the sum of the persisted
 * line items bit-for-bit.
 */
export const roundMoney = (value: Prisma.Decimal): Prisma.Decimal =>
  new Decimal(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);

export interface OrderPricingInput {
  pricePerDay: Prisma.Decimal | number | string;
  quantity: number;
  totalDays: number;
  /** Whole-number percentages (10 === 10%). */
  platformFeePercent: number;
  depositPercent: number;
  currency: string;
}

export interface OrderPricing {
  subtotal: Prisma.Decimal;
  serviceFee: Prisma.Decimal;
  depositAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  currency: string;
  platformFeePercent: number;
  depositPercent: number;
}

/**
 * Single source of truth for how an order total is composed:
 *   subtotal     = pricePerDay * quantity * totalDays
 *   serviceFee   = subtotal * platformFeePercent / 100
 *   depositAmount = subtotal * depositPercent / 100   (refundable)
 *   taxAmount    = 0 (added later by the tax provider)
 *   totalAmount  = subtotal + serviceFee + depositAmount + taxAmount
 *
 * Each component is rounded before it is summed, so totalAmount is the exact
 * sum of the four components.
 */
export const calculateOrderPricing = ({
  pricePerDay,
  quantity,
  totalDays,
  platformFeePercent,
  depositPercent,
  currency,
}: OrderPricingInput): OrderPricing => {
  const subtotal = roundMoney(new Decimal(pricePerDay).times(quantity).times(totalDays));
  const serviceFee = roundMoney(subtotal.times(platformFeePercent).dividedBy(100));
  const depositAmount = roundMoney(subtotal.times(depositPercent).dividedBy(100));
  const taxAmount = new Decimal(0);
  const totalAmount = roundMoney(subtotal.plus(serviceFee).plus(depositAmount).plus(taxAmount));

  return {
    subtotal,
    serviceFee,
    depositAmount,
    taxAmount,
    totalAmount,
    currency,
    platformFeePercent,
    depositPercent,
  };
};

export interface OrderLineItemDraft {
  type: OrderLineItemType;
  amount: Prisma.Decimal;
  currency: string;
  description: string;
}

/**
 * Turns a pricing result into the itemized breakdown persisted with the
 * order. Zero-value components are omitted so the trail only shows what the
 * customer actually paid (e.g. no "$0.00 deposit" line when deposits are
 * disabled). The RENTAL line is always present.
 */
export const buildOrderLineItems = (pricing: OrderPricing): OrderLineItemDraft[] => {
  const items: OrderLineItemDraft[] = [
    {
      type: OrderLineItemType.RENTAL,
      amount: pricing.subtotal,
      currency: pricing.currency,
      description: 'Rental cost',
    },
  ];

  if (!pricing.serviceFee.isZero()) {
    items.push({
      type: OrderLineItemType.SERVICE_FEE,
      amount: pricing.serviceFee,
      currency: pricing.currency,
      description: `Platform service fee (${pricing.platformFeePercent}%)`,
    });
  }

  if (!pricing.depositAmount.isZero()) {
    items.push({
      type: OrderLineItemType.DEPOSIT,
      amount: pricing.depositAmount,
      currency: pricing.currency,
      description: 'Refundable security deposit',
    });
  }

  if (!pricing.taxAmount.isZero()) {
    items.push({
      type: OrderLineItemType.TAX,
      amount: pricing.taxAmount,
      currency: pricing.currency,
      description: 'Tax',
    });
  }

  return items;
};
