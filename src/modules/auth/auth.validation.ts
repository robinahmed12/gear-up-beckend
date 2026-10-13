import { z } from 'zod';
import { Role } from '../../constants/roles.js';

/**
 * Registration only allows CUSTOMER or PROVIDER — ADMIN accounts are never
 * self-registered through the public API. Admins are created via the seed
 * script or promoted directly in the DB by an existing admin.
 */
export const registerSchema = z.object({
  name: z
    .string({ required_error: 'Name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be under 100 characters'),
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Must be a valid email address'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be under 72 characters'),
  role: z.enum([Role.CUSTOMER, Role.PROVIDER], {
    errorMap: () => ({ message: 'Role must be either CUSTOMER or PROVIDER' }),
  }),
  phone: z.string().trim().min(6).max(20).optional(),
});

export const loginSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Must be a valid email address'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

// Deliberately excludes email and role — email is the login identifier
// (changing it here would need re-verification, out of scope for now)
// and role is fixed at registration. Only name/phone are self-editable.
export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100).optional(),
    phone: z.string().trim().min(6).max(20).optional(),
  })
  .refine((data) => data.name !== undefined || data.phone !== undefined, {
    message: 'Provide at least one field to update (name or phone)',
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'currentPassword is required' }).min(1),
    newPassword: z
      .string({ required_error: 'newPassword is required' })
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be under 72 characters'),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'newPassword must be different from currentPassword',
    path: ['newPassword'],
  });

// schema validation
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const refreshTokenSchema = z.object({
  refreshToken: z.string({ required_error: 'refreshToken is required' }).min(1),
});

export const tokenSchema = z.object({
  token: z.string({ required_error: 'token is required' }).min(1),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .trim()
    .toLowerCase()
    .email('Must be a valid email address'),
});

export const resetPasswordSchema = z.object({
  token: z.string({ required_error: 'token is required' }).min(1),
  newPassword: z
    .string({ required_error: 'newPassword is required' })
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be under 72 characters'),
});

export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type TokenInput = z.infer<typeof tokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
