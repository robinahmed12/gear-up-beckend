import { getRedisClient } from '../config/redis';

/**
 * Minimal key/value contract with TTL, so the OTP store can run on Redis in
 * any environment that configures it, and on an in-memory map (dev/tests)
 * otherwise — no behavioural difference for callers.
 */
export interface KvStore {
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<void>;
  /** Remaining time-to-live in seconds; -1 when the key has no expiry, -2 when missing. */
  ttl(key: string): Promise<number>;
}

class MemoryKvStore implements KvStore {
  private readonly map = new Map<string, { value: string; expiresAt: number }>();

  private read(key: string): { value: string; expiresAt: number } | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return entry;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.map.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async get(key: string): Promise<string | null> {
    return this.read(key)?.value ?? null;
  }

  async del(key: string): Promise<void> {
    this.map.delete(key);
  }

  async ttl(key: string): Promise<number> {
    const entry = this.read(key);
    if (!entry) return -2;
    return Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000));
  }
}

class RedisKvStore implements KvStore {
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await getRedisClient()!.set(key, value, { EX: ttlSeconds });
  }

  async get(key: string): Promise<string | null> {
    return getRedisClient()!.get(key);
  }

  async del(key: string): Promise<void> {
    await getRedisClient()!.del(key);
  }

  async ttl(key: string): Promise<number> {
    return getRedisClient()!.ttl(key);
  }
}

const memoryStore = new MemoryKvStore();
const redisStore = new RedisKvStore();

export const getKvStore = (): KvStore => (getRedisClient() ? redisStore : memoryStore);
