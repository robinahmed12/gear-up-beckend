import { describe, expect, it } from 'vitest';
import { env } from '../env.js';

describe('env', () => {
  it('parses CORS_ORIGIN into an allowlist array', () => {
    expect(Array.isArray(env.CORS_ORIGIN)).toBe(true);
    expect(env.CORS_ORIGIN).toContain('http://localhost:3000');
    expect(env.CORS_ORIGIN).toContain('http://localhost:5173');
  });

  it('parses SSLCOMMERZ_IS_LIVE as a real boolean, defaulting to false', () => {
    expect(env.SSLCOMMERZ_IS_LIVE).toBe(false);
  });
});
