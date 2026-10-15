import nodemailer, { Transporter } from 'nodemailer';
import { env } from './env';
import { logger } from '../utils/logger';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Which delivery mechanism is active. Preference order:
 *   1. Resend HTTP API — works over HTTPS (443), which matters because many
 *      hosts/ISPs (and most CI/sandbox networks) block outbound SMTP ports.
 *   2. SMTP via nodemailer — used when RESEND_API_KEY is unset but SMTP_HOST is.
 *   3. JSON capture — dev/test fallback when neither is configured; messages
 *      are logged instead of sent.
 */
export type MailTransportName = 'resend' | 'smtp' | 'json';

const transportName: MailTransportName = env.RESEND_API_KEY
  ? 'resend'
  : env.SMTP_HOST
    ? 'smtp'
    : 'json';

export const activeMailTransport = transportName;

// --- SMTP transport (lazy: only built when actually selected) ---
let smtpTransporter: Transporter | null = null;

const getSmtpTransporter = (): Transporter => {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
    });
  }
  return smtpTransporter;
};

// --- Resend HTTP transport ---
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const sendViaResend = async (message: MailMessage): Promise<void> => {
  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Resend API responded ${response.status} ${response.statusText}${
        body ? `: ${body.slice(0, 500)}` : ''
      }`,
    );
  }
};

/**
 * Best-effort send. A mail outage (blocked SMTP egress, bad API key, provider
 * downtime) must never fail the request that triggered it — otherwise
 * registration would 500 after the account row was already created. Failures
 * are logged with the full cause and reported via the boolean return.
 *
 * Exposed as an object so tests can `vi.spyOn(mailer, 'sendMail')` without
 * module mocking.
 */
export const mailer = {
  async sendMail(message: MailMessage): Promise<boolean> {
    try {
      if (transportName === 'resend') {
        await sendViaResend(message);
      } else if (transportName === 'smtp') {
        await getSmtpTransporter().sendMail({
          from: env.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
        });
      } else {
        // JSON capture — no real delivery, but keep the message inspectable.
        const info = await nodemailer
          .createTransport({ jsonTransport: true })
          .sendMail({
            from: env.MAIL_FROM,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
          });
        logger.info(
          `[mailer] no transport configured; captured "${message.subject}" to ${message.to}`,
          { preview: typeof info.message === 'string' ? info.message.slice(0, 200) : undefined },
        );
        return true;
      }

      logger.info(`[mailer:${transportName}] sent "${message.subject}" to ${message.to}`);
      return true;
    } catch (error) {
      const err = error as { message?: string; code?: string; cause?: unknown };
      logger.error(
        `[mailer:${transportName}] failed to send "${message.subject}" to ${message.to}`,
        {
          error: err?.message || String(error) || 'unknown error',
          code: err?.code,
          cause: err?.cause instanceof Error ? err.cause.message : undefined,
        },
      );
      return false;
    }
  },
};

export const sendMail = (message: MailMessage): Promise<boolean> => mailer.sendMail(message);
