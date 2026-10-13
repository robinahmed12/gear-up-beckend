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
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../modules/auth/auth.validation';

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
  summary: 'Register as a customer or provider',
  request: { body: jsonBody(registerSchema) },
  responses: {
    201: jsonResponse(successResponse, 'Account created'),
    ...errorResponses,
    409: jsonResponse(errorResponse, 'Email already registered'),
  },
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
  path: '/api/auth/resend-verification',
  tags: ['Auth'],
  summary: 'Re-send the email verification message',
  security: [{ bearerAuth: [] }],
  responses: { 200: jsonResponse(successResponse, 'Verification email sent'), ...errorResponses },
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
