import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { startTestDatabase, stopTestDatabase } from '../../../test/db';

/**
 * Availability + booking correctness against a real Postgres
 * (Testcontainers). Covers the date-scoped reservation model that replaced
 * the global stock counter: public availability lookups, provider blackout
 * blocks, and the advisory-lock guard that stops two concurrent bookings
 * from overselling the last unit.
 *
 * Gated behind RUN_INTEGRATION_TESTS like the auth suite.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = RUN ? describe : describe.skip;

const iso = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();

suite('availability & booking (integration)', () => {
  let app: Application;
  let prisma: PrismaClient;

  let providerToken = '';
  let customerToken = '';
  let gearId = '';

  const http = () => request(app);
  const windows = {
    base: { startDate: iso(10), endDate: iso(13) },
    adjacent: { startDate: iso(13), endDate: iso(15) },
    overlap: { startDate: iso(11), endDate: iso(12) },
  };

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    const url = await startTestDatabase();
    if (!url) throw new Error('Postgres test container failed to start');
    process.env.DATABASE_URL = url;

    const appModule = await import('../../../app.js');
    const prismaModule = await import('../../../config/prisma.js');
    app = appModule.app;
    prisma = prismaModule.prisma;

    const category = await prisma.category.create({ data: { name: `Tents ${Date.now()}` } });

    const suffix = Date.now();
    const provider = await http()
      .post('/api/auth/register')
      .send({ name: 'Provider', email: `provider_${suffix}@example.com`, password: 'Password123!', role: 'PROVIDER' });
    providerToken = provider.body.data.token;

    const customer = await http()
      .post('/api/auth/register')
      .send({ name: 'Customer', email: `customer_${suffix}@example.com`, password: 'Password123!', role: 'CUSTOMER' });
    customerToken = customer.body.data.token;

    const gear = await http()
      .post('/api/provider/gear')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        title: 'Four person tent',
        description: 'A roomy four person tent for weekend trips',
        pricePerDay: 20,
        stock: 1,
        categoryId: category.id,
      });
    expect(gear.status).toBe(201);
    gearId = gear.body.data.id;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestDatabase();
  });

  const book = (window: { startDate: string; endDate: string }) =>
    http()
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ gearId, quantity: 1, ...window });

  it('reports a free window as available', async () => {
    const res = await http()
      .get(`/api/gear/${gearId}/availability`)
      .query(windows.base);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.stock).toBe(1);
    expect(res.body.data.reserved).toBe(0);
  });

  it('rejects a request with an inverted date range (400)', async () => {
    const res = await http()
      .get(`/api/gear/${gearId}/availability`)
      .query({ startDate: iso(13), endDate: iso(10) });

    expect(res.status).toBe(400);
  });

  it('lets exactly one of two concurrent bookings win the last unit', async () => {
    const [a, b] = await Promise.all([book(windows.base), book(windows.base)]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('now reports the booked window as fully reserved', async () => {
    const res = await http()
      .get(`/api/gear/${gearId}/availability`)
      .query(windows.base);

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.reserved).toBe(1);
  });

  it('allows a back-to-back booking in the adjacent half-open window', async () => {
    const res = await book(windows.adjacent);
    expect(res.status).toBe(201);
  });

  it('rejects a booking that overlaps an existing reservation', async () => {
    const res = await book(windows.overlap);
    expect(res.status).toBe(409);
  });

  it('surfaces a provider blackout in the availability result', async () => {
    const block = await http()
      .post(`/api/provider/gear/${gearId}/blocks`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ startDate: iso(20), endDate: iso(25), reason: 'Maintenance' });
    expect(block.status).toBe(201);

    const res = await http()
      .get(`/api/gear/${gearId}/availability`)
      .query({ startDate: iso(21), endDate: iso(22) });

    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(false);
    expect(res.body.data.blocked).toBe(true);

    const booking = await book({ startDate: iso(21), endDate: iso(22) });
    expect(booking.status).toBe(409);

    const del = await http()
      .delete(`/api/provider/gear/${gearId}/blocks/${block.body.data.id}`)
      .set('Authorization', `Bearer ${providerToken}`);
    expect(del.status).toBe(200);

    const after = await http()
      .get(`/api/gear/${gearId}/availability`)
      .query({ startDate: iso(21), endDate: iso(22) });
    expect(after.body.data.available).toBe(true);
  });

  it('forbids a non-owner from managing availability blocks', async () => {
    const res = await http()
      .post(`/api/provider/gear/${gearId}/blocks`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ startDate: iso(30), endDate: iso(31) });

    expect(res.status).toBe(403);
  });

  it('404s a block deletion for an unknown id', async () => {
    const res = await http()
      .delete(`/api/provider/gear/${gearId}/blocks/00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${providerToken}`);

    expect(res.status).toBe(404);
  });
});
