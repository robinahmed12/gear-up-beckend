import { z } from 'zod';
import { booleanish } from '../../utils/booleanSchema.js';

const uuid = z.string().uuid('Must be a valid UUID');

export const createGearSchema = z.object({
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(150),
  description: z.string().trim().min(10, 'Description must be at least 10 characters').max(2000),
  brand: z.string().trim().max(100).optional(),
  pricePerDay: z.coerce
    .number({ invalid_type_error: 'pricePerDay must be a number' })
    .positive('pricePerDay must be greater than 0'),
  stock: z.coerce
    .number()
    .int('stock must be a whole number')
    .nonnegative('stock cannot be negative')
    .default(1),
  isAvailable: booleanish.default(true),
  images: z.array(z.string().url('Each image must be a valid URL')).max(10).optional().default([]),
  categoryId: uuid,
});

// All fields optional for update — partial() alone would still require
// categoryId's uuid check to run only when present, which .partial() does
// correctly since it makes every key optional.
export const updateGearSchema = createGearSchema.partial();

export const gearIdParamSchema = z.object({
  id: uuid,
});

// Extracted as a plain object (pre-.refine()) so the admin query schema
// below can .extend() it — ZodEffects (what .refine() returns) doesn't
// support .extend(), only ZodObject does.
const gearQueryBaseSchema = z.object({
  search: z.string().trim().min(1).optional(),
  categoryId: uuid.optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  isAvailable: booleanish.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  sortBy: z.enum(['price', 'rating', 'newest']).default('newest'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// const priceRangeRefinement = {
//   check: (data: { minPrice?: number; maxPrice?: number }) =>
//     data.minPrice === undefined || data.maxPrice === undefined || data.minPrice <= data.maxPrice,
//   options: { message: 'minPrice cannot be greater than maxPrice', path: ['minPrice'] as const },
// };

export const gearQuerySchema = gearQueryBaseSchema.refine(
  (data) =>
    data.minPrice === undefined || data.maxPrice === undefined || data.minPrice <= data.maxPrice,
  {
    message: 'minPrice cannot be greater than maxPrice',
    path: ['minPrice'],
  },
);

// Admin oversight can additionally slice by provider, which the public
// listing never needs since browsing gear has no concept of "mine".
export const adminGearQuerySchema = gearQueryBaseSchema
  .extend({
    providerId: uuid.optional(),
  })
  .refine(
    (data) =>
      data.minPrice === undefined || data.maxPrice === undefined || data.minPrice <= data.maxPrice,
    {
      message: 'minPrice cannot be greater than maxPrice',
      path: ['minPrice'],
    },
  );

export type CreateGearInput = z.infer<typeof createGearSchema>;
export type UpdateGearInput = z.infer<typeof updateGearSchema>;
export type GearQueryInput = z.infer<typeof gearQuerySchema>;
export type AdminGearQueryInput = z.infer<typeof adminGearQuerySchema>;
