import { z } from 'zod';
import { PaymentStatus, PaymentMethod } from '../../generated/prisma/client.js';

const uuid = z.string().uuid('Must be a valid UUID');

export { PaymentStatus, PaymentMethod };

export const paymentIdParamSchema = z.object({
  id: uuid,
});

export const paymentQuerySchema = z.object({
  status: z.nativeEnum(PaymentStatus).optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

// Stripe is the only method wired up in this phase — the enum still
// a clear "not yet supported" error rather than pretending to process it.
export const createPaymentSchema = z.object({
  rentalOrderId: uuid,
  method: z.nativeEnum(PaymentMethod).default(PaymentMethod.STRIPE),
});

// Admin: full or partial refund against a captured payment. `amount` is
// optional — omit it to refund the remaining balance.
export const refundSchema = z.object({
  paymentId: uuid,
  amount: z.coerce.number().positive('amount must be greater than 0').optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

// Deposit management is keyed by the order it belongs to.
export const depositOrderSchema = z.object({
  rentalOrderId: uuid,
});

export const captureDepositSchema = depositOrderSchema.extend({
  amount: z.coerce.number().positive().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type PaymentQueryInput = z.infer<typeof paymentQuerySchema>;
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type RefundInput = z.infer<typeof refundSchema>;
export type DepositOrderInput = z.infer<typeof depositOrderSchema>;
export type CaptureDepositInput = z.infer<typeof captureDepositSchema>;

