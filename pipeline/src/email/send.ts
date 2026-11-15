import { Resend } from "resend";

export type EmailMessage = { subject: string; html: string; text: string };

export type SendEmail = (message: EmailMessage, options?: { idempotencyKey?: string }) => Promise<{ id: string }>;

type ResendClient = Pick<Resend, "emails">;

export type ResendSenderConfig = { apiKey: string; from: string; to: string };

export function createResendSender(
  config: ResendSenderConfig,
  client: ResendClient = new Resend(config.apiKey),
): SendEmail {
  return async (message, options = {}) => {
    const { data, error } = await client.emails.send(
      { from: config.from, to: config.to, subject: message.subject, html: message.html, text: message.text },
      options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
    );
    if (error) {
      const status = error.statusCode ? ` (HTTP ${error.statusCode})` : "";
      throw new Error(`Resend refused the email${status}: ${error.name}: ${error.message}`);
    }
    return { id: data.id };
  };
}
