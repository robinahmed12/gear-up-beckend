import crypto from 'node:crypto';
import type { Role } from '../generated/prisma/client.js';
import { env } from '../config/env';
import { getKvStore } from './kvStore';

const REG_PREFIX = 'otp:register:';
const COOLDOWN_PREFIX = 'otp:register:cooldown:';

/**
 * A registration that's been submitted but not yet confirmed. Held in Redis
 * (or memory in dev) under the email until the OTP is verified, so no `User`
 * row exists until the address is proven. The password is stored already
 * hashed and the OTP is stored only as a hash.
 */
export interface PendingRegistration {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  phone?: string;
  otpHash: string;
  attempts: number;
}

/** Cryptographically-random 6-digit code, zero-padded (e.g. "004213"). */
export const generateOtp = (): string => crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

const normalize = (email: string) => email.trim().toLowerCase();

export const savePendingRegistration = async (
  email: string,
  pending: PendingRegistration,
): Promise<void> => {
  await getKvStore().set(
    REG_PREFIX + email.toLowerCase(),
    JSON.stringify(pending),
    env.OTP_TTL_SECONDS,
  );
};

export const getPendingRegistration = async (
  email: string,
): Promise<PendingRegistration | null> => {
  const raw = await getKvStore().get(REG_PREFIX + normalize(email));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PendingRegistration;
  } catch {
    return null;
  }
};

export const deletePendingRegistration = async (email: string): Promise<void> => {
  await getKvStore().del(REG_PREFIX + normalize(email));
};

export const setResendCooldown = async (email: string): Promise<void> => {
  await getKvStore().set(COOLDOWN_PREFIX + normalize(email), '1', env.OTP_RESEND_COOLDOWN_SECONDS);
};

/** Seconds left before another code may be requested; 0 when allowed. */
export const getResendCooldown = async (email: string): Promise<number> => {
  const remaining = await getKvStore().ttl(COOLDOWN_PREFIX + normalize(email));
  return remaining > 0 ? remaining : 0;
};
