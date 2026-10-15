import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import type { Application } from 'express';
import type { PrismaClient } from '../../../generated/prisma/client.js';
import { startTestDatabase, stopTestDatabase } from '../../../test/db';

/**
 * Integration coverage for tax + emailed receipts (2F) against a real
 * Postgres, with Stripe and the mailer mocked. Exercises the Stripe Tax
 * calculation on the rental charge (deposit excluded), tax persisted as a
 * TAX line item + order totals, and the receipt emailed on payment success.
 */
const RUN = process.env.RUN_INTEGRATION_TESTS === 'true';
const suite = RUN ? describe : describe.skip;

const DAY = 24 * 60 * 60 * 1000;

suite('tax & receipts (integration)', () => {
  let app: Application;
  let prisma: PrismaClient;
  let stripe: any;

  let providerToken = '';
  let customerToken = '';
  let customerEmail = '';
  let categoryId = '';
  let gearId = '';

  let constructEventMock: any;
  let windowOffset = 0;

  const http = () => request(app);

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

  const createOrder = async () => {
    const order = await http()
      .post('/api/rentals')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ gearId, quantity: 1, ...nextWindow() });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id as string;
    expect((await confirmOrder(orderId)).status).toBe(200);
    return orderId;
  };

  const createPayment = async (orderId: string, billingAddress?: unknown) =>
    http()
      .post('/api/payments/create')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ rentalOrderId: orderId, ...(billingAddress ? { billingAddress } : {}) });

  const address = {
    line1: '920 5th Ave',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'US',
  };

  beforeAll(async () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = 'false';
    // No deposit for these tests — the charge is the plain rental + fee base.
    process.env.DEPOSIT_PERCENT = '0';

    const url = await startTestDatabase();
    if (!url) throw new Error('Postgres test container failed to start');
    process.env.DATABASE_URL = url;

    const appModule = await import('../../../app.js');
    const prismaModule = await import('../../../config/prisma.js');
    const stripeModule = await import('../../../config/stripe.js');
    const mailerModule = await import('../../../config/mailer.js');
    app = appModule.app;
    prisma = prismaModule.prisma;
    stripe = stripeModule.stripe;

    let piCounterValue = 0;
    vi.spyOn(stripe.paymentIntents, 'create').mockImplementation(async (params: any) => {
      piCounterValue += 1;
      return {
        id: `pi_${piCounterValue}`,
        object: 'payment_intent',
        client_secret: `cs_${piCounterValue}`,
        status: 'requires_payment_method',
        amount: params.amount,
      };
    });

    // Fake a flat 8% tax so assertions are deterministic without a real
    // Stripe Tax registration. `line_items[0].amount` is the taxable base.
    let taxCounterValue = 0;
    vi.spyOn(stripe.tax.calculations, 'create').mockImplementation(async (params: any) => {
      taxCounterValue += 1;
      const base = params.line_items[0].amount as number;
      const tax = Math.round(base * 0.08);
      return {
        id: `taxcalc_${taxCounterValue}`,
        object: 'tax.calculation',
        amount_total: base + tax,
        tax_amount_exclusive: tax,
        tax_amount_inclusive: 0,
        currency: params.currency,
        customer_details: params.customer_details,
        line_items: params.line_items,
      };
    });

    constructEventMock = vi.spyOn(stripe.webhooks, 'constructEvent').mockImplementation(() => ({}));
    vi.spyOn(mailerModule.mailer, 'sendMail').mockResolvedValue(true);

    const category = await prisma.category.create({ data: { name: `Tax ${Date.now()}` } });
    categoryId = category.id;
    const suffix = Date.now();

    providerToken = (
      await http()
        .post('/api/auth/register')
        .send({
          name: 'Provider',
          email: `tp_${suffix}@example.com`,
          password: 'Password123!',
          role: 'PROVIDER',
        })
    ).body.data.token;

    customerEmail = `tc_${suffix}@example.com`;
    customerToken = (
      await http()
        .post('/api/auth/register')
        .send({
          name: 'Customer',
          email: customerEmail,
          password: 'Password123!',
          role: 'CUSTOMER',
        })
    ).body.data.token;

    const gear = await http()
      .post('/api/provider/gear')
      .set('Authorization', `Bearer ${providerToken}`)
      .send({
        title: 'Taxed Kayak',
        description: 'A kayak for tax tests',
        pricePerDay: 30,
        stock: 1,
        categoryId,
      });
    expect(gear.status).toBe(201);
    gearId = gear.body.data.id as string;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await stopTestDatabase();
    vi.restoreAllMocks();
  });

  it('calculates tax, persists it as a line item, and updates the order total', async () => {
    const orderId = await createOrder();

    const res = await createPayment(orderId, address);
    expect(res.status).toBe(201);

    // 30/day * 2 days = 60 subtotal; 10% fee = 6 → base 66; 8% tax = 5.28;
    // charged 71.28 (deposit excluded; none here).
    expect(Number(res.body.data.payment.amount)).toBe(71.28);

    const order = await prisma.rentalOrder.findUnique({ where: { id: orderId } });
    expect(Number(order!.subtotal)).toBe(60);
    expect(Number(order!.serviceFee)).toBe(6);
    expect(Number(order!.taxAmount)).toBe(5.28);
    expect(Number(order!.totalAmount)).toBe(71.28);

    const taxLine = await prisma.orderLineItem.findFirst({
      where: { rentalOrderId: orderId, type: 'TAX' },
    });
    expect(taxLine).not.toBeNull();
    expect(Number(taxLine!.amount)).toBe(5.28);
  });

  it('emails an itemized receipt once payment succeeds', async () => {
    const orderId = await createOrder();
    const created = await createPayment(orderId, address);
    const chargePiId = created.body.data.payment.transactionId as string;

    expect(
      (
        await postWebhook({
          type: 'payment_intent.succeeded',
          data: { object: { id: chargePiId, status: 'succeeded', amount: 7128 } },
        })
      ).status,
    ).toBe(200);

    const sendMailMock = (await import('../../../config/mailer.js')).mailer.sendMail as any;
    const receiptCall = sendMailMock.mock.calls.find(
      (call: any[]) => typeof call[0]?.subject === 'string' && /receipt/i.test(call[0].subject),
    );
    expect(receiptCall).toBeTruthy();
    expect(receiptCall[0].to).toBe(customerEmail);
    expect(receiptCall[0].html).toContain('5.28');
  });

  it('leaves the charge tax-free when no billing address is supplied', async () => {
    const orderId = await createOrder();

    const res = await createPayment(orderId);
    expect(res.status).toBe(201);
    expect(Number(res.body.data.payment.amount)).toBe(66);

    const order = await prisma.rentalOrder.findUnique({ where: { id: orderId } });
    expect(Number(order!.taxAmount)).toBe(0);
    expect(Number(order!.totalAmount)).toBe(66);

    const taxLines = await prisma.orderLineItem.count({
      where: { rentalOrderId: orderId, type: 'TAX' },
    });
    expect(taxLines).toBe(0);
  });

  it('does not duplicate the TAX line item when payment is re-initiated', async () => {
    const orderId = await createOrder();

    expect((await createPayment(orderId, address)).status).toBe(201);
    expect((await createPayment(orderId, address)).status).toBe(201);

    const taxLines = await prisma.orderLineItem.findMany({
      where: { rentalOrderId: orderId, type: 'TAX' },
    });
    expect(taxLines).toHaveLength(1);
    expect(Number(taxLines[0].amount)).toBe(5.28);

    const order = await prisma.rentalOrder.findUnique({ where: { id: orderId } });
    expect(Number(order!.totalAmount)).toBe(71.28);
  });
});
