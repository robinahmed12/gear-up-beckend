import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { startTestDatabase, stopTestDatabase } from '../../../test/db';

/**
 * Integration coverage for security deposits + refunds (2D) against a real
 * Postgres, with Stripe mocked (no live key). Exercises the manual-capture
 * deposit hold (authorize -> release / capture), partial + full refunds, and
 * idempotent `charge.refunded` reconciliation.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = RUN ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

suite('deposits & refunds (integration)', () => {
  let app: Application;
  let prisma: PrismaClient;
  let stripe: any;

  let providerToken = '';
  let customerToken = '';
  let adminToken = '';
  let categoryId = '';
  let gearId = '';

  let createIntentMock: any;
  let cancelIntentMock: any;
  let captureIntentMock: any;
  let refundCreateMock: any;
  let constructEventMock: any;

  let piCounter = 0;
  let refundCounter = 0;
  let windowOffset = 0;

  const http = () => request(app);

  // Distinct 2-day windows per order so stock=1 never trips availability.
  const nextWindow = () => {
    const start = new Date(Date.now() + (10 + windowOffset) * DAY);
    windowOffset += 10;
    return {
      startDate: start.toISOString(),
      endDate: new Date(start.getTime() + 2 * DAY).toISOString(),
    };
  };

  const postWebhook = async (event: unknown) => {
    constructEventMock.mockReturnValue(event);
    return http()
      .post('/api/payments/webhook/stripe')
      .set('stripe-signature', 'sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event));
  };

  const confirmOrder = async (orderId: string) =>
    http()
      .patch(`/api/provider/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: 'CONFIRMED' });

  /**
   * Creates a CONFIRMED order, pays it (charge succeeds via webhook), and
   * authorizes its deposit hold — the common starting point for deposit and
   * refund scenarios. Returns the ids a test needs to assert against.
   */
  const setupPaidOrder = async () => {
    const order = await http()
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ gearId, quantity: 1, ...nextWindow() });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id as string;

    expect((await confirmOrder(orderId)).status).toBe(200);

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
    let depositPiId: string | null = null;
    if (deposit?.stripePaymentIntentId) {
      depositPiId = deposit.stripePaymentIntentId;
      await postWebhook({
        type: 'payment_intent.amount_capturable_updated',
        data: { object: { id: depositPiId, status: 'requires_capture', amount: 1200 } },
      });
    }

    return { orderId, paymentId, chargePiId, depositPiId };
  };

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    // Deposit = 20% of subtotal so the hold is non-zero for these tests.
    process.env.DEPOSIT_PERCENT = '20';

    const url = await startTestDatabase();
    if (!url) throw new Error('Postgres test container failed to start');
    process.env.DATABASE_URL = url;

    const appModule = await import('../../../app.js');
    const prismaModule = await import('../../../config/prisma.js');
    const stripeModule = await import('../../../config/stripe.js');
    app = appModule.app;
    prisma = prismaModule.prisma;
    stripe = stripeModule.stripe;

    createIntentMock = vi.spyOn(stripe.paymentIntents, 'create').mockImplementation(async (params: any) => {
      piCounter += 1;
      if (params?.metadata?.kind === 'security_deposit') {
        return {
          id: `pi_dep_${piCounter}`,
          object: 'payment_intent',
          client_secret: `cs_dep_${piCounter}`,
          status: 'requires_capture',
          amount: params.amount,
          capture_method: 'manual',
        };
      }
      return {
        id: `pi_charge_${piCounter}`,
        object: 'payment_intent',
        client_secret: `cs_charge_${piCounter}`,
        status: 'requires_payment_method',
        amount: params.amount,
      };
    });
    cancelIntentMock = vi
      .spyOn(stripe.paymentIntents, 'cancel')
      .mockImplementation(async (id: any) => ({ id, status: 'canceled' }));
    captureIntentMock = vi
      .spyOn(stripe.paymentIntents, 'capture')
      .mockImplementation(async (id: any, params: any) => ({
        id,
        status: 'succeeded',
        amount: params?.amount_to_capture,
      }));
    refundCreateMock = vi.spyOn(stripe.refunds, 'create').mockImplementation(async (params: any) => ({
      id: `re_${(refundCounter += 1)}`,
      object: 'refund',
      amount: params.amount,
      currency: 'usd',
      status: 'succeeded',
      reason: null,
    }));
    constructEventMock = vi.spyOn(stripe.webhooks, 'constructEvent').mockImplementation(() => ({}));

    const category = await prisma.category.create({ data: { name: `Payments ${Date.now()}` } });
    categoryId = category.id;
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
        title: 'Rental kayak',
        description: 'A sturdy kayak for the weekend',
        pricePerDay: 30,
        stock: 1,
        categoryId,
      });
    expect(gear.status).toBe(201);
    gearId = gear.body.data.id;
  }, 180_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    await prisma?.$disconnect();
    await stopTestDatabase();
  });

  it('holds the deposit separately from the rental charge', async () => {
    const { orderId } = await setupPaidOrder();

    // 30/day * 2 days = 60 subtotal; 10% fee = 6; 20% deposit = 12; total 78.
    const payment = await prisma.payment.findUnique({ where: { rentalOrderId: orderId } });
    expect(Number(payment!.amount)).toBe(66); // total - deposit

    const deposit = await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } });
    expect(Number(deposit!.amount)).toBe(12);
    expect(deposit!.status).toBe('AUTHORIZED');

    const depositCall = createIntentMock.mock.calls.find(
      (call: any[]) => call[0]?.metadata?.kind === 'security_deposit',
    );
    expect(depositCall?.[0].capture_method).toBe('manual');
    expect(depositCall?.[0].amount).toBe(1200);
  });

  it('releases the deposit on a clean return', async () => {
    const { orderId, depositPiId } = await setupPaidOrder();

    await http()
      .patch(`/api/provider/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: 'PICKED_UP' });
    const returned = await http()
      .patch(`/api/provider/orders/${orderId}/status`)
      .set('Authorization', `Bearer ${providerToken}`)
      .send({ status: 'RETURNED' });
    expect(returned.status).toBe(200);

    const deposit = await prisma.deposit.findUnique({ where: { rentalOrderId: orderId } });
    expect(deposit!.status).toBe('RELEASED');
    expect(cancelIntentMock).toHaveBeenCalledWith(depositPiId);
  });

  it('captures part of the deposit for damage and records a DAMAGE_FEE line item', async () => {
    const { orderId } = await setupPaidOrder();

    const res = await http()
      .post('/api/payments/deposit/capture')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rentalOrderId: orderId, amount: 5, reason: 'Scratched hull' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CAPTURED');
    expect(Number(res.body.data.capturedAmount)).toBe(5);

    const line = await prisma.orderLineItem.findFirst({
      where: { rentalOrderId: orderId, type: 'DAMAGE_FEE' },
    });
    expect(line).not.toBeNull();
    expect(Number(line!.amount)).toBe(5);
  });

  it('issues partial then full refunds, moving the payment to REFUNDED', async () => {
    const { paymentId } = await setupPaidOrder();

    const partial = await http()
      .post('/api/payments/refund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentId, amount: 10, reason: 'Goodwill' });
    expect(partial.status).toBe(201);
    expect((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status).toBe(
      'PARTIALLY_REFUNDED',
    );

    const full = await http()
      .post('/api/payments/refund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentId, amount: 56 });
    expect(full.status).toBe(201);
    expect((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status).toBe(
      'REFUNDED',
    );

    // Nothing left to refund.
    const over = await http()
      .post('/api/payments/refund')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ paymentId, amount: 1 });
    expect(over.status).toBe(409);
    expect(refundCreateMock).toHaveBeenCalled();
  });

  it('reconciles the charge.refunded webhook idempotently', async () => {
    const { paymentId, chargePiId } = await setupPaidOrder();
    const stripeRefundId = 're_webhook_fixed';

    const event = {
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_fixed',
          payment_intent: chargePiId,
          amount_refunded: 6600,
          refunds: {
            data: [
              { id: stripeRefundId, amount: 6600, currency: 'usd', status: 'succeeded', reason: 'requested_by_customer' },
            ],
          },
        },
      },
    };

    // Deliver the same event twice — Stripe retries on any non-2xx.
    expect((await postWebhook(event)).status).toBe(200);
    expect((await postWebhook(event)).status).toBe(200);

    const refunds = await prisma.refund.findMany({ where: { paymentId } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0].stripeRefundId).toBe(stripeRefundId);
    expect((await prisma.payment.findUnique({ where: { id: paymentId } }))!.status).toBe('REFUNDED');
  });
});
