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
  const url = `${env.APP_BASE_URL}/verify-email?token=${token}`;
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

export const passwordResetTemplate = (
  name: string,
  token: string,
): { subject: string; html: string; text: string } => {
  const url = `${env.APP_BASE_URL}/reset-password?token=${token}`;
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
