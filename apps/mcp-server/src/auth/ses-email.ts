import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { Logger } from '@nestjs/common';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { EmailMessage, EmailSender } from './email.js';

/**
 * Sends the sign-in link for real, through SES.
 *
 * Worth knowing about the sandbox: until SES is granted production access it will only deliver to
 * addresses that have been verified, and refuses everything else. A refusal is logged here and
 * swallowed by the caller, because telling the browser that one address failed and another
 * succeeded would turn the sign-in form into a way of asking which people exist.
 */
export class SesEmailSender implements EmailSender {
  private readonly logger = new Logger('email');
  private readonly client: SESv2Client;

  constructor(
    private readonly from: string,
    region: string,
  ) {
    this.client = new SESv2Client({
      region,
      maxAttempts: 2,
      // Sending is not on the critical path of the reply: the caller answers the same way whether
      // the mail went or not. Without a bound, an unreachable SES leaves the request hanging until
      // the load balancer gives up, which is a minute of nothing for the person signing in.
      requestHandler: new NodeHttpHandler({ connectionTimeout: 3_000, requestTimeout: 6_000 }),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: message.text, Charset: 'UTF-8' },
              Html: { Data: html(message), Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    // The link itself is never logged in production: a log reader should not be able to sign in.
    this.logger.log(`sign-in link sent to ${message.to}`);
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Plain and short. A sign-in mail that looks like marketing gets treated like marketing. */
function html(message: EmailMessage): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0b1220;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#e2e8f0">
  <div style="max-width:480px;margin:0 auto">
    <p style="font-size:18px;font-weight:600;color:#22d3ee;letter-spacing:.08em;margin:0 0 20px">RECALL</p>
    <p style="margin:0 0 18px;line-height:1.6">${esc(message.text.split(':')[0] ?? 'Sign in to Recall')}:</p>
    <p style="margin:0 0 22px"><a href="${esc(message.url)}" style="display:inline-block;background:#0891b2;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px">Sign in to Recall</a></p>
    <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6">The link works once and expires in 15 minutes. If you did not ask to sign in, ignore this — nothing has changed.</p>
  </div></body></html>`;
}
