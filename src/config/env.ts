import dotenv from 'dotenv';
import { z } from 'zod';
import { booleanish } from '../utils/booleanSchema.js';

dotenv.config();

/**
 * Every environment variable the app depends on is declared and validated
 * here, once, at startup. If something required is missing or malformed,
 * the process fails fast with a clear message instead of crashing later
 * deep inside a request handler.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000,http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(10, 'JWT_SECRET must be at least 10 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(30),
  REQUIRE_EMAIL_VERIFICATION: booleanish.default(false),

  BCRYPT_SALT_ROUNDS: z.coerce.number().default(12),

  // Pricing & money. Percentages are whole numbers (10 == 10%), matched by
  // the pricing util. CURRENCY is an ISO-4217 code, normalized to uppercase
  // so downstream (Prisma snapshots, Stripe) always sees a canonical value.
  CURRENCY: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/, 'CURRENCY must be a 3-letter ISO-4217 code')
    .default('USD')
    .transform((value) => value.toUpperCase()),
  PLATFORM_FEE_PERCENT: z.coerce.number().min(0).max(100).default(10),
  DEPOSIT_PERCENT: z.coerce.number().min(0).max(100).default(0),

  // Cancellation policy: cancelling at least `CANCELLATION_FULL_REFUND_HOURS`
  // before the start date refunds the whole rental charge; inside that window
  // (but before the start date) `CANCELLATION_PARTIAL_REFUND_PERCENT`% is
  // refunded; once the rental has started there is no refund. The deposit
  // hold is always released regardless of tier.
  CANCELLATION_FULL_REFUND_HOURS: z.coerce.number().nonnegative().default(48),
  CANCELLATION_PARTIAL_REFUND_PERCENT: z.coerce.number().min(0).max(100).default(50),

  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),

  // Optional (not required at boot) — SSLCommerz is a secondary payment
  // method. If these are unset, the app still starts fine; only the
  // SSLCommerz branch of the Payments module refuses requests, with a
  // clear error, until they're configured.
  SSLCOMMERZ_STORE_ID: z.string().optional(),
  SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),
  SSLCOMMERZ_IS_LIVE: booleanish.default(false),
  APP_BASE_URL: z.string().default('http://localhost:5000'),
  // Public URL of the web client. Used to build the links inside outgoing
  // emails (verify-email, reset-password) so they open the frontend, not the
  // API server.
  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Optional — when SMTP_HOST is unset the mailer uses a JSON transport
  // that captures messages in the logs instead of sending them, so local
  // dev and tests never require a real mail server.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_SECURE: booleanish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('GearUp <no-reply@gearup.local>'),

  // Optional — when set, rate limiting uses a Redis store so limits are
  // shared across instances; otherwise an in-memory store is used.
  REDIS_URL: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables. Check .env against .env.example.');
}

export const env = parsed.data;
