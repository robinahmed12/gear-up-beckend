import { z } from 'zod';
import { RentalStatus, PROVIDER_SETTABLE_STATUSES } from '../../constants/orderStatus.js';

const uuid = z.string().uuid('Must be a valid UUID');

export const createRentalSchema = z
  .object({
    gearId: uuid,
    quantity: z.coerce
      .number()
      .int('quantity must be a whole number')
      .positive('quantity must be at least 1')
      .default(1),
    startDate: z.coerce.date({
      required_error: 'startDate is required',
      invalid_type_error: 'startDate must be a valid date',
    }),
    endDate: z.coerce.date({
      required_error: 'endDate is required',
      invalid_type_error: 'endDate must be a valid date',
    }),
  })
  .refine((data) => data.endDate > data.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  })
  .refine((data) => data.startDate >= new Date(new Date().toDateString()), {
    message: 'startDate cannot be in the past',
    path: ['startDate'],
  });

export const rentalIdParamSchema = z.object({
  id: uuid,
});

// Only these three are provider-driven per the assignment brief — PAID is
// set by the Payments module (via Stripe webhook), and CANCELLED is
// customer-driven through a separate endpoint, not this one.
//
// Built from z.nativeEnum(RentalStatus) + .refine() (rather than
// z.enum([...] as const)) specifically so the inferred TS type is the
// real `RentalStatus` enum, not a bare string-literal union — the
// service layer's assertValidTransition() takes a RentalStatus, and a
// literal union isn't assignable to it even though the values line up.
export const updateRentalStatusSchema = z.object({
  status: z.nativeEnum(RentalStatus).refine((value) => PROVIDER_SETTABLE_STATUSES.includes(value), {
    message: `status must be one of: ${PROVIDER_SETTABLE_STATUSES.join(', ')}`,
  }),
});

// Admin override accepts any status (the transition graph is bypassed), so
// unlike updateRentalStatusSchema it has no whitelist refine.
export const adminUpdateRentalStatusSchema = z.object({
  status: z.nativeEnum(RentalStatus),
});

export const rentalQuerySchema = z.object({
  status: z.nativeEnum(RentalStatus).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

// Admin oversight can additionally slice by customer or provider, which
// customer/provider self-service views never need since those are
// already scoped to "me" via the authenticated user.
export const adminRentalQuerySchema = rentalQuerySchema.extend({
  customerId: uuid.optional(),
  providerId: uuid.optional(),
});

export type CreateRentalInput = z.infer<typeof createRentalSchema>;
export type UpdateRentalStatusInput = z.infer<typeof updateRentalStatusSchema>;
export type AdminUpdateRentalStatusInput = z.infer<typeof adminUpdateRentalStatusSchema>;
export type RentalQueryInput = z.infer<typeof rentalQuerySchema>;
export type AdminRentalQueryInput = z.infer<typeof adminRentalQuerySchema>;
