import { env } from '../config/env';

const layout = (title: string, body: string): string => `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
    <h2 style="color: #1f2937;">${title}</h2>
    ${body}
    <p style="color: #6b7280; font-size: 12px;">GearUp — Sports &amp; Outdoor Gear Rental</p>
  </div>
`;

export const verifyEmailTemplate = (
  name: string,
  token: string,
): { subject: string; html: string; text: string } => {
  const url = `${env.FRONTEND_URL}/verify-email?token=${token}`;
  return {
    subject: 'Verify your GearUp email',
    html: layout(
      'Confirm your email',
      `<p>Hi ${name},</p>
       <p>Thanks for signing up. Confirm your email to unlock renting and listing gear.</p>
       <p><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Verify email</a></p>
       <p>Or paste this token into the app: <code>${token}</code></p>
       <p>This link expires in 24 hours.</p>`,
    ),
    text: `Hi ${name}, verify your GearUp email using this token: ${token} (expires in 24 hours).`,
  };
};

export const verifyOtpTemplate = (
  name: string,
  otp: string,
): { subject: string; html: string; text: string } => {
  const minutes = Math.round(env.OTP_TTL_SECONDS / 60);
  return {
    subject: 'Your GearUp verification code',
    html: layout(
      'Confirm your email',
      `<p>Hi ${name},</p>
       <p>Use the code below to finish creating your GearUp account.</p>
       <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0;">${otp}</p>
       <p>This code expires in ${minutes} minutes. If you didn't try to create an account, you can ignore this email.</p>`,
    ),
    text: `Hi ${name}, your GearUp verification code is ${otp} (expires in ${minutes} minutes).`,
  };
};

export const passwordResetTemplate = (
  name: string,
  token: string,
): { subject: string; html: string; text: string } => {
  const url = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  return {
    subject: 'Reset your GearUp password',
    html: layout(
      'Reset your password',
      `<p>Hi ${name},</p>
       <p>We received a request to reset your password. If this was you, use the link below.</p>
       <p><a href="${url}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">Reset password</a></p>
       <p>Or paste this token into the app: <code>${token}</code></p>
       <p>This link expires in 1 hour. If you didn't request it, you can ignore this email.</p>`,
    ),
    text: `Hi ${name}, reset your GearUp password using this token: ${token} (expires in 1 hour).`,
  };
};

const formatMoney = (amount: string | number, currency: string): string =>
  `${currency} ${Number(amount).toFixed(2)}`;

export interface ReceiptData {
  customerName: string;
  gearTitle: string;
  orderId: string;
  currency: string;
  /** Rental charge only (excludes the refundable deposit). */
  subtotal: string | number;
  serviceFee: string | number;
  taxAmount: string | number;
  depositAmount: string | number;
  amountCharged: string | number;
  totalAmount: string | number;
  paidAt: Date;
}

/**
 * Itemized money receipt emailed when a rental payment succeeds. There is no
 * PDF — the breakdown mirrors the persisted order line items so the customer
 * sees exactly what was charged (rental + fee + tax) versus held (deposit).
 */
export const paymentReceiptTemplate = (
  data: ReceiptData,
): { subject: string; html: string; text: string } => {
  const money = (v: string | number) => formatMoney(v, data.currency);
  const rows: Array<[string, string]> = [
    ['Rental cost', money(data.subtotal)],
    ['Platform service fee', money(data.serviceFee)],
    ['Sales tax', money(data.taxAmount)],
    ['Total charged', money(data.amountCharged)],
  ];
  const table = rows
    .map(
      ([label, value], index) =>
        `<tr style="${index === rows.length - 1 ? 'border-top:1px solid #e5e7eb;font-weight:600;' : ''}">
           <td style="padding:6px 0;color:#374151;">${label}</td>
           <td style="padding:6px 0;text-align:right;">${value}</td>
         </tr>`,
    )
    .join('');

  const depositEligible = Number(data.depositAmount) > 0;
  const depositNote = depositEligible
    ? `<p>A refundable security deposit of <strong>${money(
        data.depositAmount,
      )}</strong> is held separately on your card and isn't charged; it's released after the gear is returned in good condition.</p>`
    : '';

  return {
    subject: `Your GearUp receipt — ${data.gearTitle}`,
    html: layout(
      'Payment receipt',
      `<p>Hi ${data.customerName},</p>
       <p>Thanks for your payment for <strong>${data.gearTitle}</strong>. Here's your receipt:</p>
       <table style="width:100%;border-collapse:collapse;margin:12px 0;">${table}</table>
       ${depositNote}
       <p style="color:#6b7280;font-size:12px;">Order ${data.orderId} · paid ${data.paidAt.toUTCString()}</p>`,
    ),
    text: `Hi ${data.customerName}, thanks for your payment for ${data.gearTitle}.
Receipt (order ${data.orderId}):
Rental cost: ${money(data.subtotal)}
Platform service fee: ${money(data.serviceFee)}
Sales tax: ${money(data.taxAmount)}
Total charged: ${money(data.amountCharged)}${
      depositEligible ? `\nRefundable deposit held separately: ${money(data.depositAmount)}` : ''
    }`,
  };
};
