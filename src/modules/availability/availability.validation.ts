import { z } from 'zod';

const uuid = z.string().uuid('Must be a valid UUID');

const endAfterStart = (data: { startDate: Date; endDate: Date }) =>
  data.startDate.getTime() < data.endDate.getTime();

export const gearAvailabilityParamSchema = z.object({
  id: uuid,
});

// Query for the public availability check: which window does the customer
// want, and for how many units.
export const availabilityQuerySchema = z
  .object({
    startDate: z.coerce.date({ required_error: 'startDate is required' }),
    endDate: z.coerce.date({ required_error: 'endDate is required' }),
    quantity: z.coerce.number().int().positive().default(1),
  })
  .refine(endAfterStart, { message: 'endDate must be after startDate', path: ['endDate'] });

export const createBlockSchema = z
  .object({
    startDate: z.coerce.date({ required_error: 'startDate is required' }),
    endDate: z.coerce.date({ required_error: 'endDate is required' }),
    reason: z.string().trim().max(300).optional(),
  })
  .refine(endAfterStart, { message: 'endDate must be after startDate', path: ['endDate'] })
  .refine((data) => data.startDate.getTime() >= new Date(new Date().toDateString()).getTime(), {
    message: 'startDate cannot be in the past',
    path: ['startDate'],
  });

// Nested provider route params: `/provider/gear/:id/blocks/:blockId`.
export const blockParamSchema = z.object({
  id: uuid,
  blockId: uuid,
});

export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;
export type CreateBlockInput = z.infer<typeof createBlockSchema>;
