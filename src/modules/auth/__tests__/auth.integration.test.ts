import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { startTestDatabase, stopTestDatabase } from '../../../test/db';

/**
 * Full auth-lifecycle coverage against a real Postgres (Testcontainers).
 * Gated behind RUN_INTEGRATION_TESTS so the default `npm test` stays fast
 * and Docker-free; CI sets it to true.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = RUN ? describe : describe.skip;

suite('auth lifecycle (integration)', () => {
  let app: Application;
  let prisma: PrismaClient;
  let hashToken: (token: string) => string;
  const sentMails: Array<{ to: string; subject: string; text?: string }> = [];

  const email = `user_${Date.now()}@example.com`;
  const password = 'Password123!';
  const newPassword = 'NewPassword123!';

  const http = () => request(app);

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'true';
    const url = await startTestDatabase();
    if (!url) throw new Error('Postgres test container failed to start');
    process.env.DATABASE_URL = url;

    const appModule = await import('../../../app.js');
    const prismaModule = await import('../../../config/prisma.js');
    const tokenModule = await import('../../../utils/tokens.js');
    const mailerModule = await import('../../../config/mailer.js');

    vi.spyOn(mailerModule.mailer, 'sendMail').mockImplementation(async (message) => {
      sentMails.push({ to: message.to, subject: message.subject, text: message.text });
      return true;
    });

    app = appModule.app;
    prisma = prismaModule.prisma;
    hashToken = tokenModule.hashToken;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestDatabase();
  });

  it('sends a registration code, then creates and verifies the account on OTP', async () => {
    const res = await http().post('/api/auth/register').send({
      name: 'Test User',
      email,
      password,
      role: 'CUSTOMER',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe(email);
    expect(res.body.data.token).toBeUndefined();
    expect(sentMails.some((mail) => mail.to === email)).toBe(true);

    // No user row exists until the code is verified.
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();

    const otp = res.body.data.devOtp;
    expect(otp).toMatch(/^\d{6}$/);

    const verify = await http().post('/api/auth/register/verify-otp').send({ email, otp });
    expect(verify.status).toBe(201);
    expect(verify.body.data.user.emailVerifiedAt).not.toBeNull();
    expect(verify.body.data.token).toBeTruthy();
    expect(verify.body.data.refreshToken).toBeTruthy();

    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).toBeTruthy();
    expect(dbUser?.password).not.toBe(password);
  });

  it('rejects an incorrect registration code', async () => {
    const otherEmail = `bad_otp_${Date.now()}@example.com`;
    await http()
      .post('/api/auth/register')
      .send({ name: 'Bad OTP', email: otherEmail, password, role: 'CUSTOMER' });

    const res = await http()
      .post('/api/auth/register/verify-otp')
      .send({ email: otherEmail, otp: '000000' });

    expect(res.status).toBe(401);
    expect(await prisma.user.findUnique({ where: { email: otherEmail } })).toBeNull();
  });

  it('rejects a duplicate registration with 409', async () => {
    const res = await http()
      .post('/api/auth/register')
      .send({ name: 'Other', email, password: 'AnotherPass123!', role: 'CUSTOMER' });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('blocks an unverified user from a verified-only action with 403', async () => {
    const unverifiedEmail = `unverified_${Date.now()}@example.com`;
    const { hashPassword } = await import('../../../utils/password.js');
    await prisma.user.create({
      data: {
        name: 'Unverified',
        email: unverifiedEmail,
        password: await hashPassword(password),
        role: 'CUSTOMER',
      },
    });

    const login = await http().post('/api/auth/login').send({ email: unverifiedEmail, password });
    expect(login.status).toBe(200);

    const res = await http()
      .post('/api/rentals')
      .set('Authorization', `Bearer ${login.body.data.token}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('rejects login with a wrong password', async () => {
    const res = await http().post('/api/auth/login').send({ email, password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('returns the current user for /me', async () => {
    const login = await http().post('/api/auth/login').send({ email, password });
    const res = await http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.data.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
  });

  it('rotates refresh tokens and rejects reuse of the old one', async () => {
    const login = await http().post('/api/auth/login').send({ email, password });
    const firstRefresh = login.body.data.refreshToken;

    const rotated = await http().post('/api/auth/refresh').send({ refreshToken: firstRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(firstRefresh);

    const reused = await http().post('/api/auth/refresh').send({ refreshToken: firstRefresh });
    expect(reused.status).toBe(401);
  });

  it('verifies an email address then rejects token reuse', async () => {
    const user = await prisma.user.findUnique({ where: { email } });
    const rawToken = `verify-${Date.now()}`;

    await prisma.verificationToken.create({
      data: {
        userId: user!.id,
        type: 'EMAIL_VERIFY',
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const verify = await http().post('/api/auth/verify-email').send({ token: rawToken });
    expect(verify.status).toBe(200);

    const updated = await prisma.user.findUnique({ where: { email } });
    expect(updated?.emailVerifiedAt).not.toBeNull();

    const reuse = await http().post('/api/auth/verify-email').send({ token: rawToken });
    expect(reuse.status).toBe(401);
  });

  it('resets a password and invalidates the old one', async () => {
    const forgot = await http().post('/api/auth/forgot-password').send({ email });
    expect(forgot.status).toBe(200);

    const user = await prisma.user.findUnique({ where: { email } });
    const rawToken = `reset-${Date.now()}`;

    await prisma.verificationToken.create({
      data: {
        userId: user!.id,
        type: 'PASSWORD_RESET',
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const reset = await http()
      .post('/api/auth/reset-password')
      .send({ token: rawToken, newPassword });
    expect(reset.status).toBe(200);

    const oldLogin = await http().post('/api/auth/login').send({ email, password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await http().post('/api/auth/login').send({ email, password: newPassword });
    expect(newLogin.status).toBe(200);
  });

  it('logs out a single session and revokes its refresh token', async () => {
    const login = await http().post('/api/auth/login').send({ email, password: newPassword });
    const refreshToken = login.body.data.refreshToken;

    const logout = await http().post('/api/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(200);

    const reuse = await http().post('/api/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);
  });

  it('logs out every session for the user', async () => {
    const login = await http().post('/api/auth/login').send({ email, password: newPassword });
    const { token, refreshToken } = login.body.data;

    const logoutAll = await http()
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${token}`);
    expect(logoutAll.status).toBe(200);

    const reuse = await http().post('/api/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);
  });
});
