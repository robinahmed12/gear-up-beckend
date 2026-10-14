import { prisma } from '../../config/prisma.js';
import { sendMail } from '../../config/mailer.js';
import { logger } from '../../utils/logger.js';
import { paymentReceiptTemplate } from '../../utils/emailTemplates.js';

/**
 * Emails an itemized receipt for a paid rental order. Called from the
 * `payment_intent.succeeded` webhook handler (itself idempotent), so a
 * redelivered event never sends a second receipt.
 *
 * Delivery is best-effort: failures are logged, not thrown, so a transient
 * mail outage can't turn a successful payment into a failed webhook.
 */
export const sendPaymentReceipt = async (rentalOrderId: string): Promise<void> => {
  try {
    const order = await prisma.rentalOrder.findUnique({
      where: { id: rentalOrderId },
      select: {
        id: true,
        currency: true,
        subtotal: true,
        serviceFee: true,
        taxAmount: true,
        depositAmount: true,
        totalAmount: true,
        customer: { select: { name: true, email: true } },
        gear: { select: { title: true } },
        payment: { select: { amount: true, paidAt: true } },
      },
    });

    if (!order || !order.payment) {
      return;
    }

    const receipt = paymentReceiptTemplate({
      customerName: order.customer.name,
      gearTitle: order.gear.title,
      orderId: order.id,
      currency: order.currency,
      subtotal: order.subtotal.toString(),
      serviceFee: order.serviceFee.toString(),
      taxAmount: order.taxAmount.toString(),
      depositAmount: order.depositAmount.toString(),
      totalAmount: order.totalAmount.toString(),
      amountCharged: order.payment.amount.toString(),
      paidAt: order.payment.paidAt ?? new Date(),
    });

    await sendMail({ to: order.customer.email, ...receipt });
  } catch (err) {
    logger.error(
      `Failed to send payment receipt for order ${rentalOrderId}: ${(err as Error).message}`,
    );
  }
};
