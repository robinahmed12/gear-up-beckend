import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { startTestDatabase, stopTestDatabase } from '../../../test/db';

/**
 * Integration coverage for the 2E cancellation policy against a real Postgres,
 * with Stripe mocked. Verifies:
 *  - tiered customer refunds (full >=48h, 50% inside 48h, none after start),
 *  - the deposit hold always being released on cancel,
 *  - provider cancellation always refunding in full,
 *  - ownership enforcement and the admin status override.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = RUN ? describe : describe.skip;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

suite('cancellation policy (integration)', () => {
  let app: Application;
  let prisma: PrismaClient;
  let stripe: any;

  let providerToken = '';
  let customerToken = '';
  let otherCustomerToken = '';
  let adminToken = '';
  let gearId = '';

  let refundCreateMock: any;
  let cancelIntentMock: any;
  let constructEventMock: any;

  let refundSeq = 0;
  let piSeq = 0;

  const http = () => request(app);

  const postWebhook = async (event: unknown) => {
    constructEventMock.mockReturnValue(event);
    return http()
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
  };

  /**
   * Creates a CONFIRMED order starting `startOffsetHours` from now, pays it
   * (charge succeeds via webhook) and authorizes its deposit hold. Windows are
   * supplied by each test and kept disjoint so the stock=1 gear never rejects
   * a booking.
   */
  const createPaidOrder = async (
    startOffsetHours: number,
    startOverride?: Date,
    durationHours = 48,
  ) => {
    const start = startOverride ?? new Date(Date.now() + startOffsetHours * HOUR);
    const end = new Date(start.getTime() + durationHours * HOUR);

    const order = await http()
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        gearId,
        quantity: 1,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id as string;

    const confirmed = await http()
      .patch(`/api/provider/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: 'CONFIRMED' });
    expect(confirmed.status).toBe(200);

    const pay = await http()
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rentalOrderId: orderId });
    expect(pay.status).toBe(201);
    const paymentId = pay.body.data.payment.id as string;
    const chargePiId = pay.body.data.payment.transactionId as string;

    await postWebhook({
      type: 'payment_intent.succeeded',
      data: { object: { id: chargePiId, status: 'succeeded', amount: 6600 } },
    });

    const deposit = await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } });
    if (deposit?.stripePaymentIntentId) {
      await postWebhook({
        type: 'payment_intent.amount_capturable_updated',
        data: {
          object: { id: deposit.stripePaymentIntentId, status: 'requires_capture', amount: 1200 },
        },
      });
    }

    return { orderId, paymentId, chargePiId };
  };

  const cancel = (orderId: string, token = customerToken) =>
    http().patch(`/api/rentals/${orderId}/cancel`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    process.env.DEPOSIT_PERCENT = '20';
    process.env.CANCELLATION_FULL_REFUND_HOURS = '48';
    process.env.CANCELLATION_PARTIAL_REFUND_PERCENT = '50';

    const url = await startTestDatabase();
    if (!url) throw new Error('Postgres test container failed to start');
    process.env.DATABASE_URL = url;

    const appModule = await import('../../../app.js');
    const prismaModule = await import('../../../config/prisma.js');
    const stripeModule = await import('../../../config/stripe.js');
    app = appModule.app;
    prisma = prismaModule.prisma;
    stripe = stripeModule.stripe;

    vi.spyOn(stripe.paymentIntents, 'create').mockImplementation(async (params: any) => {
      const id = params?.metadata?.kind === 'security_deposit'
        ? `pi_deposit_${(piSeq += 1)}`
        : `pi_charge_${(piSeq += 1)}`;
      return {
        id,
        object: 'payment_intent',
        client_secret: `${id}_secret`,
        status: params?.capture_method === 'manual' ? 'requires_capture' : 'requires_payment_method',
        amount: params.amount,
      };
    });
    cancelIntentMock = vi
      .spyOn(stripe.paymentIntents, 'cancel')
      .mockImplementation(async (id: any) => ({ id, status: 'canceled' }));
    refundCreateMock = vi.spyOn(stripe.refunds, 'create').mockImplementation(async (params: any) => ({
      id: `re_${(refundSeq += 1)}`,
      object: 'refund',
      amount: params.amount,
      currency: 'usd',
      status: 'succeeded',
      reason: null,
    }));
    constructEventMock = vi.spyOn(stripe.webhooks, 'constructEvent').mockImplementation(() => ({}));

    const category = await prisma.category.create({ data: { name: `Cancel ${Date.now()}` } });
    const suffix = Date.now();

    providerToken = (
      await http()
        .post('/api/auth/register')
        .send({ name: 'Provider', email: `p_${suffix}@example.com`, password: 'Password123!', role: 'PROVIDER' })
    ).body.data.token;

    customerToken = (
      await http()
        .post('/api/auth/register')
        .send({ name: 'Customer', email: `c_${suffix}@example.com`, password: 'Password123!', role: 'CUSTOMER' })
    ).body.data.token;

    otherCustomerToken = (
      await http()
        .post('/api/auth/register')
        .send({ name: 'Other', email: `o_${suffix}@example.com`, password: 'Password123!', role: 'CUSTOMER' })
    ).body.data.token;

    const adminEmail = `admin_${suffix}@example.com`;
    await http().post('/api/auth/register').send({
      name: 'Admin',
      email: adminEmail,
      password: 'Password123!',
      role: 'CUSTOMER',
    });
    await prisma.user.update({ where: { email: adminEmail }, data: { role: 'ADMIN' } });
    adminToken = (
      await http().post('/api/auth/login').send({ email: adminEmail, password: 'Password123!' })
    ).body.data.token;

    const gear = await http()
      .post('/api/provider/gear')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        title: 'Cancellable kayak',
        description: 'A kayak for cancellation testing',
        pricePerDay: 30,
        stock: 1,
        categoryId: category.id,
      });
    expect(gear.status).toBe(201);
    gearId = gear.body.data.id;
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma?.$disconnect();
    await stopTestDatabase();
  });

  it('refunds the full charge and releases the deposit beyond the full window', async () => {
    const { orderId, paymentId } = await createPaidOrder(240);

    const res = await cancel(orderId);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.cancellation.tier).toBe('FULL');
    expect(Number(res.body.data.cancellation.refundableAmount)).toBe(66);
    expect(res.body.data.cancellation.depositReleased).toBe(true);

    expect((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status).toBe('REFUNDED');
    expect((await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } }))!.status).toBe(
      'RELEASED',
    );
    expect(cancelIntentMock).toHaveBeenCalled();
    expect(refundCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 6600 }),
    );
  });

  it('refunds half the charge inside the partial window', async () => {
    const { orderId, paymentId } = await createPaidOrder(24);

    const res = await cancel(orderId);
    expect(res.status).toBe(200);
    expect(res.body.data.cancellation.tier).toBe('PARTIAL');
    expect(Number(res.body.data.cancellation.refundableAmount)).toBe(33);

    expect((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status).toBe(
      'PARTIALLY_REFUNDED',
    );
    expect(refundCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 3300 }),
    );
  });

  it('refunds nothing once the rental has started but still releases the deposit', async () => {
    // Start at today's midnight: valid per validation, but already in the
    // past by the time the request runs -> zero-refund tier.
    const { orderId, paymentId } = await createPaidOrder(0, new Date(new Date().toDateString()), 8);
    const callsBefore = refundCreateMock.mock.calls.length;

    const res = await cancel(orderId);
    expect(res.status).toBe(200);
    expect(res.body.data.cancellation.tier).toBe('NONE');
    expect(Number(res.body.data.cancellation.refundableAmount)).toBe(0);

    expect(refundCreateMock.mock.calls.length).toBe(callsBefore);
    expect((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status).toBe('COMPLETED');
    expect((await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } }))!.status).toBe(
      'RELEASED',
    );
  });

  it('lets a provider cancel and always refunds in full', async () => {
    const { orderId, paymentId } = await createPaidOrder(50);

    const res = await http()
      .patch(`/api/provider/orders/${orderId}/cancel`)
      .set('Authorization', `Bearer ${providerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cancellation.tier).toBe('FULL');

    expect((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status).toBe('REFUNDED');
  });

  it('rejects a customer cancelling an order they do not own', async () => {
    const start = new Date(Date.now() + 150 * HOUR);
    const order = await http()
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        gearId,
        quantity: 1,
        startDate: start.toISOString(),
        endDate: new Date(start.getTime() + 48 * HOUR).toISOString(),
      });
    expect(order.status).toBe(201);

    const res = await cancel(order.body.data.id, otherCustomerToken);
    expect(res.status).toBe(403);
  });

  it('lets an admin override any status and releases the deposit', async () => {
    const { orderId } = await createPaidOrder(300);

    const res = await http()
      .patch(`/api/admin/rentals/${orderId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'RETURNED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RETURNED');
    expect((await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } }))!.status).toBe(
      'RELEASED',
    );
  });
});
