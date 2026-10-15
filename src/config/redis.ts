import { createClient, type RedisClientType } from 'redis';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Single shared Redis connection for the whole app (rate-limit counters and
 * the registration OTP store). Returns `null` when REDIS_URL is not
 * configured, so callers can fall back to an in-memory implementation and
 * local dev/tests never require a running Redis.
 */
let redisClient: RedisClientType | null = null;

export const isRedisEnabled = (): boolean => Boolean(env.REDIS_URL);

export const getRedisClient = (): RedisClientType | null => {
  if (!env.REDIS_URL) return null;

  if (!redisClient) {
    const client: RedisClientType = createClient({ url: env.REDIS_URL });
    client.on('error', (error) =>
      logger.error('Redis client error', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    // node-redis queues commands until the connection is ready, so callers
    // don't need to await this.
    client.connect().catch((error) =>
      logger.error('Failed to connect to Redis', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    redisClient = client;
  }

  return redisClient;
};
