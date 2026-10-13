import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient, type RedisClientType } from 'redis';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * A single Redis client is shared across all rate limiters, but every limiter
 * gets its own RedisStore instance with a distinct key prefix. Reusing one
 * store object across limiters triggers express-rate-limit's
 * ERR_ERL_STORE_REUSE validation error, so stores are created per-limiter.
 */
let redisClient: RedisClientType | null = null;

const getRedisClient = (): RedisClientType | null => {
  if (!env.REDIS_URL) return null;

  if (!redisClient) {
    const client: RedisClientType = createClient({ url: env.REDIS_URL });
    client.on('error', (error) => logger.error('Redis rate-limit client error', { error }));
    client
      .connect()
      .catch((error) => logger.error('Failed to connect Redis for rate limiting', { error }));
    redisClient = client;
  }

  return redisClient;
};

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
