import { Role, VerificationTokenType } from '../../generated/prisma/client.js';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { hashPassword, comparePassword } from '../../utils/password';
import { signToken } from '../../utils/jwt';
import { generateOpaqueToken, hashToken } from '../../utils/tokens';
import { sendMail } from '../../config/mailer';
import { verifyOtpTemplate, passwordResetTemplate } from '../../utils/emailTemplates';
import {
  deletePendingRegistration,
  generateOtp,
  getPendingRegistration,
  getResendCooldown,
  savePendingRegistration,
  setResendCooldown,
} from '../../utils/registrationOtp';
import { ConflictError } from '../../errors/ConflictError';
import { TooManyRequestsError } from '../../errors/TooManyRequestsError';
import { UnauthorizedError } from '../../errors/UnauthorizedError';
import { NotFoundError } from '../../errors/NotFoundError';
import { recordAudit } from '../../utils/auditLog';
import { logger } from '../../utils/logger';
import {
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  ChangePasswordInput,
} from './auth.validation';

// Fields safe to return to the client — password hash is never included.
const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  phone: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

const createSession = async (userId: string, meta: SessionMeta): Promise<string> => {
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.JWT_REFRESH_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: meta.userAgent,
      ip: meta.ip,
    },
  });

  return refreshToken;
};

const issueAuthTokens = async (
  user: { id: string; role: Role },
  meta: SessionMeta,
): Promise<{ token: string; refreshToken: string }> => {
  const token = signToken({ id: user.id, role: user.role });
  const refreshToken = await createSession(user.id, meta);
  return { token, refreshToken };
};

/**
 * Step 1 of registration: validate the details, stash them (password already
 * hashed) under the email, and email a one-time code. No `User` row is created
 * until the code is confirmed, so unverified accounts can never exist.
 */
export const requestRegistrationOtp = async (input: RegisterInput) => {
  const email = input.email.toLowerCase();

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const otp = generateOtp();

  await savePendingRegistration(email, {
    name: input.name,
    email,
    passwordHash,
    role: input.role,
    phone: input.phone,
    otpHash: hashToken(otp),
    attempts: 0,
  });

  const { subject, html, text } = verifyOtpTemplate(input.name, otp);
  const delivered = await sendMail({ to: email, subject, html, text });

  if (!delivered && env.NODE_ENV !== 'production') {
    // Mail transport may be blocked/unconfigured locally, so surface the code
    // in the logs instead of leaving the registration unfinishable.
    logger.warn(`[auth] Verification OTP email not delivered. Code for ${email}: ${otp}`);
  }

  await setResendCooldown(email);

  return { email, devOtp: env.NODE_ENV !== 'production' ? otp : undefined };
};

export const verifyRegistrationOtp = async (
  emailInput: string,
  otp: string,
  meta: SessionMeta = {},
) => {
  const email = emailInput.toLowerCase();
  const pending = await getPendingRegistration(email);

  if (!pending) {
    throw new UnauthorizedError('Verification code expired or not found. Please register again.');
  }

  if (pending.attempts >= env.OTP_MAX_ATTEMPTS) {
    await deletePendingRegistration(email);
    throw new UnauthorizedError('Too many incorrect attempts. Please register again.');
  }

  if (pending.otpHash !== hashToken(otp)) {
    await savePendingRegistration(email, { ...pending, attempts: pending.attempts + 1 });
    throw new UnauthorizedError('Incorrect verification code');
  }

  let user;
  try {
    user = await prisma.user.create({
      data: {
        name: pending.name,
        email: pending.email,
        password: pending.passwordHash,
        role: pending.role,
        phone: pending.phone,
        emailVerifiedAt: new Date(),
      },
      select: publicUserSelect,
    });
  } catch (error) {
    await deletePendingRegistration(email);
    // A concurrent verify for the same email can win the unique constraint.
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      throw new ConflictError('An account with this email already exists');
    }
    throw error;
  }

  await deletePendingRegistration(email);

  const { token, refreshToken } = await issueAuthTokens(user, meta);

  await recordAudit({
    actorId: user.id,
    action: 'auth.register',
    entity: 'user',
    entityId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { user, token, refreshToken };
};

export const resendRegistrationOtp = async (emailInput: string) => {
  const email = emailInput.toLowerCase();
  const pending = await getPendingRegistration(email);

  if (!pending) {
    throw new NotFoundError('Verification code expired or not found. Please register again.');
  }

  const cooldown = await getResendCooldown(email);
  if (cooldown > 0) {
    throw new TooManyRequestsError(`Please wait ${cooldown}s before requesting another code`);
  }

  const otp = generateOtp();
  await savePendingRegistration(email, { ...pending, otpHash: hashToken(otp), attempts: 0 });

  const { subject, html, text } = verifyOtpTemplate(pending.name, otp);
  const delivered = await sendMail({ to: email, subject, html, text });

  if (!delivered && env.NODE_ENV !== 'production') {
    logger.warn(`[auth] Verification OTP email not delivered. Code for ${email}: ${otp}`);
  }

  await setResendCooldown(email);

  return { email, devOtp: env.NODE_ENV !== 'production' ? otp : undefined };
};

export const loginUser = async (input: LoginInput, meta: SessionMeta = {}) => {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  // Deliberately identical message whether the email doesn't exist or the
  // password is wrong — avoids leaking which emails are registered.
  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const isPasswordValid = await comparePassword(input.password, user.password);
  if (!isPasswordValid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (user.status === 'SUSPENDED') {
    throw new UnauthorizedError('Your account has been suspended. Contact support.');
  }

  const { token, refreshToken } = await issueAuthTokens(user, meta);

  const { password: _password, ...safeUser } = user;

  await recordAudit({
    actorId: user.id,
    action: 'auth.login',
    entity: 'user',
    entityId: user.id,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });

  return { user: safeUser, token, refreshToken };
};

export const refreshSession = async (rawRefreshToken: string, meta: SessionMeta = {}) => {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawRefreshToken) },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: publicUserSelect,
  });

  if (!user) {
    throw new UnauthorizedError('User belonging to this session no longer exists');
  }

  if (user.status === 'SUSPENDED') {
    throw new UnauthorizedError('Your account has been suspended. Contact support.');
  }

  // Rotation: the presented refresh token is revoked before a new one is
  // issued, so a stolen token can be used at most once.
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });

  const { token, refreshToken } = await issueAuthTokens(user, meta);

  return { user, token, refreshToken };
};

export const logout = async (refreshToken: string): Promise<void> => {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

export const logoutAll = async (userId: string): Promise<void> => {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

export const getCurrentUser = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: publicUserSelect,
  });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  return user;
};

export const updateProfile = async (userId: string, input: UpdateProfileInput) => {
  // Existence is implicitly guaranteed here — the caller is always an
  // authenticated request, and verifyTokenMiddleware already re-fetches
  // the user from the DB on every request, so a stale/deleted id can't
  // reach this function. update() still throws Prisma's P2025 (mapped to
  // a 404 by the global error handler) as a fallback if that ever changes.
  return prisma.user.update({
    where: { id: userId },
    data: input,
    select: publicUserSelect,
  });
};

export const changePassword = async (userId: string, input: ChangePasswordInput): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError('User not found');
  }

  const isCurrentPasswordValid = await comparePassword(input.currentPassword, user.password);
  if (!isCurrentPasswordValid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const hashedPassword = await hashPassword(input.newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashedPassword },
  });
};

export const verifyEmail = async (token: string): Promise<void> => {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (
    !record ||
    record.type !== VerificationTokenType.EMAIL_VERIFY ||
    record.usedAt ||
    record.expiresAt < new Date()
  ) {
    throw new UnauthorizedError('Invalid or expired verification token');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);
};

export const requestPasswordReset = async (email: string): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { email } });

  // Always resolve successfully to avoid leaking which emails are registered.
  if (!user) return;

  const token = generateOpaqueToken();

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      type: VerificationTokenType.PASSWORD_RESET,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
    },
  });

  const { subject, html, text } = passwordResetTemplate(user.name, token);
  const delivered = await sendMail({ to: user.email, subject, html, text });

  if (!delivered && env.NODE_ENV !== 'production') {
    logger.warn(
      `[auth] Password reset email not delivered. Reset ${user.email} via: ` +
        `${env.FRONTEND_URL}/reset-password?token=${token}`,
    );
  }
};

export const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (
    !record ||
    record.type !== VerificationTokenType.PASSWORD_RESET ||
    record.usedAt ||
    record.expiresAt < new Date()
  ) {
    throw new UnauthorizedError('Invalid or expired reset token');
  }

  const hashedPassword = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { password: hashedPassword },
    }),
    prisma.verificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    // Reset invalidates every active session — a compromised account
    // should be logged out everywhere once the owner regains control.
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await recordAudit({
    actorId: record.userId,
    action: 'auth.password_reset',
    entity: 'user',
    entityId: record.userId,
  });
};
