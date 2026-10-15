import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';
import { logger } from '../utils/logger';

const isSmtpConfigured = Boolean(env.SMTP_HOST);

export const mailTransport: Transporter = isSmtpConfigured
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export const sendMail = async (message: MailMessage): Promise<boolean> => {
  try {
    const info = await mailTransport.sendMail({ from: env.MAIL_FROM, ...message });

    if (isSmtpConfigured) {
      logger.info(`[mailer] sent "${message.subject}" to ${message.to}`);
    } else {
      logger.info(`[mailer] SMTP not configured; captured "${message.subject}" to ${message.to}`, {
        preview: typeof info.message === 'string' ? info.message.slice(0, 200) : undefined,
      });
    }

    return true;
  } catch (error) {
    // Email delivery is best-effort on purpose: a mail outage (or blocked
    // SMTP egress in dev) must never fail the request that triggered it —
    // otherwise registration would 500 after the account row was created.
    logger.error(`[mailer] failed to send "${message.subject}" to ${message.to}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};
