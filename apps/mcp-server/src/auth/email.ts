import { Logger } from '@nestjs/common';

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  url: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development sender: logs the magic link instead of emailing it, and keeps sent messages
 * for tests. Swap for a real provider (SES) before anyone outside the team signs in.
 */
export class ConsoleEmailSender implements EmailSender {
  readonly sent: EmailMessage[] = [];
  private readonly logger = new Logger('email');

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    this.logger.log(`to=${message.to} ${message.url}`);
  }
}

/**
 * Which mailer the server uses. Development logs the link; anything reachable from outside the
 * team should be sending it, so EMAIL_PROVIDER=ses is what a deployment sets.
 */
export async function createEmailSender(env: NodeJS.ProcessEnv = process.env): Promise<EmailSender> {
  if ((env.EMAIL_PROVIDER ?? 'console') !== 'ses') return new ConsoleEmailSender();
  const from = env.EMAIL_FROM;
  if (!from) throw new Error('EMAIL_PROVIDER=ses needs EMAIL_FROM (a verified SES identity)');
  const { SesEmailSender } = await import('./ses-email.js');
  return new SesEmailSender(from, env.AWS_REGION ?? 'us-east-1');
}
