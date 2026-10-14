import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { stripe } from '../../config/stripe.js';
import { env } from '../../config/env.js';
import { catchAsync } from '../../utils/catchAsync.js';
import { logger } from '../../utils/logger.js';
import * as paymentService from './payment.service.js';
import * as depositService from './deposit.service.js';
import * as refundService from './refund.service.js';

const router = Router();

/**
 * Stripe Webhook Route
 * --------------------
 * Handles incoming webhook events from Stripe.
 *
 * Key points:
 * - Stripe confirms PaymentIntent outcomes client-side (via Stripe.js),
 *   but the webhook is the only trusted server-side source of truth.
 * - Webhook requests are signed by Stripe; signature verification ensures
 *   authenticity and prevents spoofing.
 * - Must be mounted in `app.ts` with `express.raw({ type: 'application/json' })`
 *   BEFORE global `express.json()` middleware, since verification requires
 *   the raw request body.
 */
router.post(
  '/stripe',
  catchAsync(async (req: Request, res: Response) => {
    const signature = req.headers['stripe-signature'];

    // Ensure the signature header is present
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ success: false, message: 'Missing Stripe-Signature header' });
      return;
    }

    let event: Stripe.Event;
    try {
      // Verify the event using Stripe's SDK and the webhook secret
      event = stripe.webhooks.constructEvent(req.body, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn(`Stripe webhook signature verification failed: ${(err as Error).message}`);
      res.status(400).json({ success: false, message: 'Invalid webhook signature' });
      return;
    }

    // Handle relevant event types
    switch (event.type) {
      case 'payment_intent.succeeded':
        await paymentService.handleStripePaymentSucceeded(
          event.data.object as Stripe.PaymentIntent,
        );
        break;
      case 'payment_intent.payment_failed':
        await paymentService.handleStripePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      // A manual-capture deposit hold becomes capturable once the customer's
      // card is authorized (funds held, not charged).
      case 'payment_intent.amount_capturable_updated':
        await depositService.markDepositAuthorized(event.data.object as Stripe.PaymentIntent);
        break;
      // Reconcile refunds (ours or dashboard-issued); idempotent by refund id.
      case 'charge.refunded':
        await refundService.handleChargeRefunded(event.data.object as Stripe.Charge);
        break;
      default:
        // Unhandled events are acknowledged but logged for visibility
        logger.info(`Unhandled Stripe webhook event: ${event.type}`);
    }

    // Respond with 200 to acknowledge receipt; Stripe retries on non-2xx
    res.status(200).json({ received: true });
  }),
);

export default router;

