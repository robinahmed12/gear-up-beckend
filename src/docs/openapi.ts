import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { env } from '../config/env';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  tokenSchema,
  verifyRegistrationOtpSchema,
  resendRegistrationOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../modules/auth/auth.validation';
import {
  gearAvailabilityParamSchema,
  availabilityQuerySchema,
} from '../modules/availability/availability.validation';
import {
  rentalIdParamSchema,
  adminUpdateRentalStatusSchema,
} from '../modules/rentals/rental.validation';
import {
  refundSchema,
  depositOrderSchema,
  captureDepositSchema,
} from '../modules/payments/payment.validation';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

const successResponse = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.any().nullable(),
});

const errorResponse = z.object({
  success: z.literal(false),
  message: z.string(),
  errorDetails: z.any().nullable(),
});

const jsonBody = (schema: z.ZodTypeAny) => ({
  content: { 'application/json': { schema } },
});

const jsonResponse = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const errorResponses = {
  400: jsonResponse(errorResponse, 'Validation failed'),
  401: jsonResponse(errorResponse, 'Authentication required'),
};

registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['Health'],
  summary: 'Liveness probe',
  responses: { 200: jsonResponse(successResponse, 'Service is up') },
});

registry.registerPath({
  method: 'get',
  path: '/api/health/ready',
  tags: ['Health'],
  summary: 'Readiness probe (checks the database)',
  responses: {
    200: jsonResponse(successResponse, 'Service is ready'),
    503: jsonResponse(errorResponse, 'Service is not ready'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/register',
  tags: ['Auth'],
  summary: 'Request an email verification code to register as a customer or provider',
  request: { body: jsonBody(registerSchema) },
  responses: {
    201: jsonResponse(successResponse, 'Verification code sent'),
    ...errorResponses,
    409: jsonResponse(errorResponse, 'Email already registered'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/register/verify-otp',
  tags: ['Auth'],
  summary: 'Verify the registration code, create the account, and return tokens',
  request: { body: jsonBody(verifyRegistrationOtpSchema) },
  responses: {
    201: jsonResponse(successResponse, 'Account created and email verified'),
    ...errorResponses,
    409: jsonResponse(errorResponse, 'Email already registered'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/register/resend-otp',
  tags: ['Auth'],
  summary: 'Re-send the registration verification code',
  request: { body: jsonBody(resendRegistrationOtpSchema) },
  responses: { 200: jsonResponse(successResponse, 'New code sent'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  summary: 'Log in and receive access + refresh tokens',
  request: { body: jsonBody(loginSchema) },
  responses: { 200: jsonResponse(successResponse, 'Logged in'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  tags: ['Auth'],
  summary: 'Rotate a refresh token for a new token pair',
  request: { body: jsonBody(refreshTokenSchema) },
  responses: { 200: jsonResponse(successResponse, 'Tokens refreshed'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  tags: ['Auth'],
  summary: 'Revoke a refresh token',
  request: { body: jsonBody(refreshTokenSchema) },
  responses: { 200: jsonResponse(successResponse, 'Logged out'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/logout-all',
  tags: ['Auth'],
  summary: 'Revoke every session for the current user',
  security: [{ bearerAuth: [] }],
  responses: { 200: jsonResponse(successResponse, 'Logged out everywhere'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/verify-email',
  tags: ['Auth'],
  summary: 'Verify an email address with a token',
  request: { body: jsonBody(tokenSchema) },
  responses: { 200: jsonResponse(successResponse, 'Email verified'), ...errorResponses },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/forgot-password',
  tags: ['Auth'],
  summary: 'Request a password reset email',
  request: { body: jsonBody(forgotPasswordSchema) },
  responses: { 200: jsonResponse(successResponse, 'Reset email sent if account exists') },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/reset-password',
  tags: ['Auth'],
  summary: 'Reset a password with a reset token',
  request: { body: jsonBody(resetPasswordSchema) },
  responses: { 200: jsonResponse(successResponse, 'Password reset'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'Get the current authenticated user',
  security: [{ bearerAuth: [] }],
  responses: { 200: jsonResponse(successResponse, 'Current user'), ...errorResponses },
});

registry.registerPath({
  method: 'get',
  path: '/api/gear/{id}/availability',
  tags: ['Availability'],
  summary: 'Check whether a gear item is free for a date window',
  request: {
    params: gearAvailabilityParamSchema,
    query: availabilityQuerySchema,
  },
  responses: {
    200: jsonResponse(successResponse, 'Availability for the requested window'),
    ...errorResponses,
    404: jsonResponse(errorResponse, 'Gear item not found'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/rentals/{id}/breakdown',
  tags: ['Rentals'],
  summary: 'Get the pricing breakdown and line items for an order',
  security: [{ bearerAuth: [] }],
  request: { params: rentalIdParamSchema },
  responses: {
    200: jsonResponse(successResponse, 'Order pricing breakdown'),
    ...errorResponses,
    403: jsonResponse(errorResponse, 'Not your order'),
    404: jsonResponse(errorResponse, 'Rental order not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/payments/refund',
  tags: ['Payments'],
  summary: 'Issue a full or partial refund against a captured payment (admin)',
  security: [{ bearerAuth: [] }],
  request: { body: jsonBody(refundSchema) },
  responses: {
    201: jsonResponse(successResponse, 'Refund issued'),
    ...errorResponses,
    403: jsonResponse(errorResponse, 'Admin role required'),
    404: jsonResponse(errorResponse, 'Payment not found'),
    409: jsonResponse(errorResponse, 'Payment is not in a refundable state'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/payments/deposit/capture',
  tags: ['Payments'],
  summary: 'Capture (part of) a held security deposit for damage/late fees (admin)',
  security: [{ bearerAuth: [] }],
  request: { body: jsonBody(captureDepositSchema) },
  responses: {
    200: jsonResponse(successResponse, 'Deposit captured'),
    ...errorResponses,
    403: jsonResponse(errorResponse, 'Admin role required'),
    404: jsonResponse(errorResponse, 'No security deposit for this order'),
    409: jsonResponse(errorResponse, 'Deposit is not capturable'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/rentals/{id}/breakdown',
  tags: ['Rentals'],
  summary: 'Get the pricing breakdown and line items for an order',
  security: [{ bearerAuth: [] }],
  request: { params: rentalIdParamSchema },
  responses: {
    200: jsonResponse(successResponse, 'Order pricing breakdown'),
    ...errorResponses,
    403: jsonResponse(errorResponse, 'Not your order'),
    404: jsonResponse(errorResponse, 'Order not found'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/rentals/{id}/cancel',
  tags: ['Rentals'],
  summary: 'Cancel your own rental order (refund per cancellation policy)',
  security: [{ bearerAuth: [] }],
  request: { params: rentalIdParamSchema },
  responses: {
    200: jsonResponse(successResponse, 'Order cancelled'),
    ...errorResponses,
    403: jsonResponse(errorResponse, 'Not your order'),
    404: jsonResponse(errorResponse, 'Order not found'),
    409: jsonResponse(errorResponse, 'Order is not cancellable from its current status'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/provider/orders/{id}/cancel',
  tags: ['Rentals'],
  summary: 'Cancel an order on gear you own (full refund)',
  security: [{ bearerAuth: [] }],
  request: { params: rentalIdParamSchema },
  responses: {
    200: jsonResponse(successResponse, 'Order cancelled'),
    ...errorResponses,
    403: jsonResponse(errorResponse, 'Not your gear'),
    404: jsonResponse(errorResponse, 'Order not found'),
    409: jsonResponse(errorResponse, 'Order is not cancellable from its current status'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/admin/rentals/{id}/status',
  tags: ['Rentals'],
  summary: 'Admin override: force any order status',
  security: [{ bearerAuth: [] }],
  request: { params: rentalIdParamSchema, body: jsonBody(adminUpdateRentalStatusSchema) },
  responses: {
    200: jsonResponse(successResponse, 'Order status overridden'),
    ...errorResponses,
    403: jsonResponse(errorResponse, 'Admin role required'),
    404: jsonResponse(errorResponse, 'Order not found'),
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);

export const openApiDocument = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'GearUp API',
    version: '1.0.0',
    description: 'Sports & Outdoor Gear Rental Marketplace API',
  },
  servers: [{ url: env.APP_BASE_URL }],
});
