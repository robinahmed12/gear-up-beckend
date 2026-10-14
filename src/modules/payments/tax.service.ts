import type Stripe from 'stripe';
import { Prisma } from '../../generated/prisma/client.js';
import { stripe } from '../../config/stripe.js';
import { AppError } from '../../errors/AppError.js';
import { toMinorUnits, fromMinorUnits } from '../../utils/money.js';
import type { BillingAddressInput } from './payment.validation.js';

export interface TaxBreakdown {
  /** Stripe Tax Calculation id (null only if Stripe omits it), for reporting. */
  calculationId: string | null;
  /** Tax added on top of the charge base (exclusive). */
  taxAmount: Prisma.Decimal;
  /** Grand total (charge base + tax) to actually charge the customer. */
  amountTotal: Prisma.Decimal;
}

/**
 * Calculates tax for a rental charge using the Stripe Tax API. Stripe Tax
 * only returns tax in jurisdictions where the account has an active tax
 * registration (zero otherwise), so a missing registration degrades to a
 * zero-tax charge rather than an error.
 *
 * The deposit is deliberately excluded from the taxable base: it's a
 * refundable hold, not a charge. `base` is therefore (subtotal + serviceFee).
 */
export const calculateOrderTax = async (
  base: Prisma.Decimal,
  currency: string,
  address: BillingAddressInput,
): Promise<TaxBreakdown> => {
  let calculation: Stripe.Tax.Calculation;
  try {
    calculation = await stripe.tax.calculations.create({
      currency,
      line_items: [{ amount: toMinorUnits(base), reference: 'rental_charge' }],
      customer_details: {
        address: {
          line1: address.line1,
          line2: address.line2,
          city: address.city,
          state: address.state,
          postal_code: address.postalCode,
          country: address.country,
        },
        address_source: 'billing',
      },
    });
  } catch (err) {
    throw new AppError(
      `Unable to calculate tax for the provided billing address: ${(err as Error).message}`,
      400,
    );
  }

  return {
    calculationId: calculation.id,
    taxAmount: fromMinorUnits(calculation.tax_amount_exclusive),
    amountTotal: fromMinorUnits(calculation.amount_total),
  };
};
