import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { startTestDatabase, stopTestDatabase } from '../../../test/db';

/**
 * Idempotency coverage against a real Postgres. The key behaviour under test:
 * retrying a booking with the same Idempotency-Key must replay the original
 * response without creating a second order, while reusing a key with a
 * different body must be rejected.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = RUN ? describe : describe.skip;

suite('idempotency (integration)', () => {
  let app: Application;
  let prisma: PrismaClient;
  let customerToken = '';
  let gearId = '';

  const http = () => request(app);

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    const url = await startTestDatabase();
    if (!url) throw new Error('Postgres test container failed to start');
    process.env.DATABASE_URL = url;

    const appModule = await import('../../../app.js');
    const prismaModule = await import('../../../config/prisma.js');
    app = appModule.app;
    prisma = prismaModule.prisma;

    const category = await prisma.category.create({ data: { name: `Idem ${Date.now()}` } });

    const suffix = Date.now();
    const provider = await http()
      .post('/api/auth/register')
      .send({ name: 'Provider', email: `p_${suffix}@example.com`, password: 'Password123!', role: 'PROVIDER' });

    const customer = await http()
      .post('/api/auth/register')
      .send({ name: 'Customer', email: `c_${suffix}@example.com`, password: 'Password123!', role: 'CUSTOMER' });
    customerToken = customer.body.data.token;

    const gear = await http()
      .post('/api/provider/gear')
      .set('Authorization', `Bearer ${provider.body.data.token}`)
      .send({
        title: 'Idempotent kayak',
        description: 'A stable two-person kayak for calm water',
        pricePerDay: 30,
        stock: 5,
        categoryId: category.id,
      });
    expect(gear.status).toBe(201);
    gearId = gear.body.data.id;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestDatabase();
  });

  const d = (days: number) => {
    const start = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return {
      startDate: start.toISOString(),
      endDate: new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    };
  };

  it('replays the identical response on retry and creates only one order', async () => {
    const key = `idem-replay-${Date.now()}`;
    const window = d(30);
    const body = { gearId, quantity: 1, ...window };

    const first = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status).toBe(201);

    const retry = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', key)
      .send(body);

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotency-replayed']).toBe('true');
    expect(retry.body.data.id).toBe(first.body.data.id);

    const count = await prisma.rentalOrder.count({ where: { gearId, startDate: new Date(window.startDate) } });
    expect(count).toBe(1);
  });

  it('rejects reusing the same key with a different body (409)', async () => {
    const key = `idem-mismatch-${Date.now()}`;
    const first = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', key)
      .send({ gearId, quantity: 1, ...d(40) });
    expect(first.status).toBe(201);

    const conflict = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', key)
      .send({ gearId, quantity: 1, ...d(45) });

    expect(conflict.status).toBe(409);
    expect(conflict.body.message).toContain('Idempotency-Key');
  });

  it('behaves normally (two orders) when no key is supplied', async () => {
    const body = { gearId, quantity: 1, ...d(50) };

    const a = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(body);
    const b = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(body);

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
  });

  it('rejects a too-short idempotency key (400)', async () => {
    const res = await request(app)
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Idempotency-Key', 'short')
      .send({ gearId, quantity: 1, ...d(60) });

    expect(res.status).toBe(400);
  });

  it('creates exactly one order for concurrent requests sharing a key', async () => {
    const key = `idem-concurrent-${Date.now()}`;
    const window = d(70);
    const body = { gearId, quantity: 1, ...window };

    const send = () =>
      request(app)
        .post('/api/rentals')
        .set('Authorization', `Bearer ${customerToken}`)
        .set('Idempotency-Key', key)
        .send(body);

    const [a, b] = await Promise.all([send(), send()]);

    // One request wins; the other either replays it or gets an in-flight 409.
    expect([a.status, b.status].filter((s) => s === 201).length).toBeGreaterThanOrEqual(1);
    for (const status of [a.status, b.status]) {
      expect([201, 409]).toContain(status);
    }

    const count = await prisma.rentalOrder.count({
      where: { gearId, startDate: new Date(window.startDate) },
    });
    expect(count).toBe(1);
  });
});
