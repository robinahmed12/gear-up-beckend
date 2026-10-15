import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { env } from '../config/env';
import { getRedisClient } from '../config/redis';

/**
 * Rate limiters share the app-wide Redis client from config/redis, but every
 * limiter gets its own RedisStore instance with a distinct key prefix.
 * Reusing one store object across limiters triggers express-rate-limit's
 * ERR_ERL_STORE_REUSE validation error, so stores are created per-limiter.
 * When Redis isn't configured, no store is passed and express-rate-limit
 * falls back to its in-memory store.
 */
const buildStore = (prefix: string): RedisStore | undefined => {
  const client = getRedisClient();
  if (!client) return undefined;

  return new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => client.sendCommand(args),
  });
};

export const createRateLimiter = (max: number, prefix: string) =>
  rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    store: buildStore(prefix),
    message: {
      success: false,
      message: 'Too many requests, please try again later.',
      errorDetails: null,
    },
  });

export const generalRateLimiter = createRateLimiter(env.RATE_LIMIT_MAX, 'rl:general:');
export const authRateLimiter = createRateLimiter(env.AUTH_RATE_LIMIT_MAX, 'rl:auth:');
