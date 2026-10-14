import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { startTestDatabase, stopTestDatabase } from '../../../test/db';

/**
 * Integration coverage for the order pricing breakdown (2B) against a real
 * Postgres: the create path freezes subtotal/fee/deposit/total + currency and
 * writes itemized line items, and GET /rentals/:id/breakdown is scoped to the
 * owning customer/provider/admin.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = RUN ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

suite('order pricing breakdown (integration)', () => {
  let app: Application;
  let prisma: PrismaClient;

  let providerToken = '';
  let customerToken = '';
  let otherCustomerToken = '';
  let gearId = '';
  let orderId = '';

  const http = () => request(app);

  // End is computed from start so the window is exactly 2 days — avoids the
  // ±ms skew that could push calculateTotalDays to 3.
  const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const startDate = start.toISOString();
  const endDate = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    const url = await startTestDatabase();
    if (!url) throw new Error('Postgres test container failed to start');
    process.env.DATABASE_URL = url;

    const appModule = await import('../../../app.js');
    const prismaModule = await import('../../../config/prisma.js');
    app = appModule.app;
    prisma = prismaModule.prisma;

    const category = await prisma.category.create({ data: { name: `Camping ${Date.now()}` } });
    const suffix = Date.now();

    providerToken = (
      await http().post('/api/auth/register').send({
        name: 'Provider',
        email: `prov_${suffix}@example.com`,
        password: 'Password123!',
        role: 'PROVIDER',
      })
    ).body.data.token;

    customerToken = (
      await http()
        .post('/api/auth/register')
        .send({ name: 'Customer', email: `cust_${suffix}@example.com`, password: 'Password123!', role: 'CUSTOMER' })
    ).body.data.token;

    otherCustomerToken = (
      await http()
        .post('/api/auth/register')
        .send({ name: 'Other', email: `other_${suffix}@example.com`, password: 'Password123!', role: 'CUSTOMER' })
    ).body.data.token;

    const gear = await http()
      .post('/api/provider/gear')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        title: 'Camping stove',
        description: 'A reliable two-burner camping stove for trips',
        pricePerDay: 20,
        stock: 2,
        categoryId: category.id,
      });
    expect(gear.status).toBe(201);
    gearId = gear.body.data.id;

    const order = await http()
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ gearId, quantity: 1, startDate, endDate });
    expect(order.status).toBe(201);
    orderId = order.body.data.id;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestDatabase();
  });

  it('snapshots the breakdown onto the created order', async () => {
    const res = await http()
      .get(`/api/rentals/${orderId}/breakdown`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    const data = res.body.data;
    // 20/day * 1 * 2 days = 40 subtotal; 10% platform fee = 4; no deposit.
    expect(Number(data.subtotal)).toBe(40);
    expect(Number(data.serviceFee)).toBe(4);
    expect(Number(data.depositAmount)).toBe(0);
    expect(Number(data.taxAmount)).toBe(0);
    expect(Number(data.totalAmount)).toBe(44);
    expect(data.currency).toBe('USD');
  });

  it('persists itemized line items that sum to the total', async () => {
    const res = await http()
      .get(`/api/rentals/${orderId}/breakdown`)
      .set('Authorization', `Bearer ${customerToken}`);

    const items = res.body.data.lineItems as Array<{ type: string; amount: string }>;
    const byType = Object.fromEntries(items.map((i) => [i.type, Number(i.amount)]));

    expect(byType.RENTAL).toBe(40);
    expect(byType.SERVICE_FEE).toBe(4);
    expect(byType.DEPOSIT).toBeUndefined();

    const sum = items.reduce((acc, i) => acc + Number(i.amount), 0);
    expect(sum).toBe(Number(res.body.data.totalAmount));

    const persisted = await prisma.orderLineItem.count({ where: { rentalOrderId: orderId } });
    expect(persisted).toBe(items.length);
  });

  it('lets the owning provider view the breakdown', async () => {
    const res = await http()
      .get(`/api/rentals/${orderId}/breakdown`)
      .set('Authorization', `Bearer ${providerToken}`);

    expect(res.status).toBe(200);
  });

  it('forbids an unrelated customer from viewing the breakdown', async () => {
    const res = await http()
      .get(`/api/rentals/${orderId}/breakdown`)
      .set('Authorization', `Bearer ${otherCustomerToken}`);

    expect(res.status).toBe(403);
  });

  it('404s a breakdown request for an unknown order', async () => {
    const res = await http()
      .get('/api/rentals/00000000-0000-0000-0000-000000000000/breakdown')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(res.status).toBe(404);
  });
});
