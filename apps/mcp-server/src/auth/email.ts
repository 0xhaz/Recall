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
