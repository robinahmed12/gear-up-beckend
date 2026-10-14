import { NextFunction, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../config/prisma.js';
import { catchAsync } from '../utils/catchAsync.js';
import { AppError } from '../errors/AppError.js';
import { ConflictError } from '../errors/ConflictError.js';
import { UnauthorizedError } from '../errors/UnauthorizedError.js';
import { hashToken } from '../utils/tokens.js';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 255;

/**
 * Deterministic JSON serialization: object keys are sorted so two logically
 * equal bodies hash identically regardless of the order the client sent the
 * keys in. Without this, a retry with reordered keys would look like a
 * different request and be wrongly rejected.
 *
 * Dates are serialized explicitly: body validation coerces date fields into
 * `Date` instances, and a naive `Object.keys()` walk would turn every Date
 * into `{}` — making different date windows hash identically.
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${entries.join(',')}}`;
};

/**
 * Idempotency guard for unsafe (POST) money/booking endpoints.
 *
 * Opt-in via the `Idempotency-Key` request header: requests without it behave
 * exactly as before, so existing clients aren't broken. When present:
 *
 *  - First use   -> the key is claimed (unique per user), then the handler's
 *                   response is captured and stored against the key.
 *  - Retry       -> the stored response is replayed verbatim (with an
 *                   `Idempotency-Replayed: true` header). No side effects run.
 *  - Reused key with a different body -> 409, so a client bug can't silently
 *                   receive the wrong order's response.
 *  - Concurrent duplicate while the first is still running -> 409 (in flight).
 *  - Handler failed with 5xx -> the claim is removed so the request is
 *                   retryable.
 *
 * Must run AFTER validation, so `req.body` is the normalized (coerced) shape
 * and the hash is stable across retries.
 */
export const idempotency = () =>
  catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = req.header('Idempotency-Key');
    if (!rawKey) {
      return next();
    }

    if (!req.user) {
      throw new UnauthorizedError();
    }

    const key = rawKey.trim();
    if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
      throw new AppError(
        `Idempotency-Key must be between ${MIN_KEY_LENGTH} and ${MAX_KEY_LENGTH} characters`,
        400,
      );
    }

    const userId = req.user.id;
    const scope = `${req.method} ${req.baseUrl}${req.path}`;
    const requestHash = hashToken(stableStringify(req.body));

    try {
      // Atomic claim: the unique (userId, key) constraint means exactly one
      // concurrent request can insert; the rest fall into the catch below.
      await prisma.idempotencyKey.create({
        data: { userId, key, scope, requestHash },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await prisma.idempotencyKey.findUnique({
          where: { userId_key: { userId, key } },
        });

        if (existing && existing.requestHash !== requestHash) {
          throw new ConflictError(
            'This Idempotency-Key was already used with a different request body',
          );
        }

        if (existing && existing.statusCode !== null) {
          res.setHeader('Idempotency-Replayed', 'true');
          res.status(existing.statusCode).json(existing.responseBody);
          return;
        }

        throw new ConflictError('A request with this Idempotency-Key is already being processed');
      }
      throw error;
    }

    // We own the key. Wrap res.json so the outcome is persisted before the
    // response leaves the server (a client that got a response can rely on
    // the key being recorded for its next retry).
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      const statusCode = res.statusCode;
      const persist =
        statusCode >= 500
          ? // Server errors are transient: release the key so it can retry.
            prisma.idempotencyKey.delete({ where: { userId_key: { userId, key } } })
          : prisma.idempotencyKey.update({
              where: { userId_key: { userId, key } },
              data: { statusCode, responseBody: body as Prisma.InputJsonValue },
            });

      persist
        .catch(() => undefined)
        .finally(() => {
          originalJson(body);
        });

      return res;
    }) as typeof res.json;

    next();
  });
