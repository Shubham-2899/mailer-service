import { ImapFlow } from 'imapflow';
import { TestAccountModel } from '../models/test-account.model';
import { CampaignModel } from '../models/campaign.model';
import { SmtpConfig } from './mailer.util';
import * as nodemailer from 'nodemailer';

export interface CheckpointOptions {
  campaignId: string;
  from: string;
  fromName: string;
  subject: string;
  decodedTemplate: string;
  offerId: string;
  smtpConfig: SmtpConfig;
  /** Current IP pool entry to use for sending test emails */
  currentIp: string;
  currentDomain: string;
  currentTransporter: nodemailer.Transporter;
}

export class CheckpointService {
  private readonly waitSeconds: number;

  constructor() {
    this.waitSeconds = parseInt(process.env.CHECKPOINT_WAIT_SECONDS || '120', 10);
  }

  /**
   * Run a full deliverability checkpoint:
   * 1. Send test emails to all active test accounts
   * 2. Wait for delivery
   * 3. Poll each inbox via IMAP
   * 4. Return 'inbox' if all landed in inbox, 'spam' otherwise
   */
  async runCheckpoint(options: CheckpointOptions): Promise<'inbox' | 'spam'> {
    const accounts = await TestAccountModel.find({ active: true }).lean();

    if (!accounts.length) {
      console.warn(`[Checkpoint] No active test accounts found — skipping checkpoint for ${options.campaignId}`);
      return 'inbox';
    }

    console.log(`[Checkpoint] Starting deliverability check for campaign ${options.campaignId} — ${accounts.length} test account(s)`);

    // Update checkpoint status in DB
    await CampaignModel.updateOne({ campaignId: options.campaignId }, { checkpointStatus: 'checking' });

    const sentAt = new Date();

    // Send test emails
    await this.sendTestEmails(accounts, options);

    // Wait for delivery
    console.log(`[Checkpoint] Waiting ${this.waitSeconds}s for delivery...`);
    await new Promise((res) => setTimeout(res, this.waitSeconds * 1000));

    // Poll each account
    const results = await Promise.all(
      accounts.map((account) => this.pollAccount(account, options.subject, sentAt)),
    );

    const anySpam = results.some((r) => r !== 'inbox');

    if (anySpam) {
      const spamAccounts = accounts.filter((_, i) => results[i] !== 'inbox').map((a) => a.email);
      console.warn(`[Checkpoint] Spam detected in: ${spamAccounts.join(', ')}`);
      return 'spam';
    }

    console.log(`[Checkpoint] All test accounts received in inbox — resuming campaign ${options.campaignId}`);
    return 'inbox';
  }

  private async sendTestEmails(accounts: any[], options: CheckpointOptions): Promise<void> {
    const { from, fromName, subject, decodedTemplate, currentIp, currentDomain, currentTransporter } = options;

    for (const account of accounts) {
      try {
        await currentTransporter.sendMail({
          from: `${fromName} <${from}>`,
          to: account.email,
          subject,
          html: decodedTemplate,
          headers: { 'X-Outgoing-IP': currentIp },
          envelope: {
            from: `bounces@${currentDomain}`,
            to: account.email,
          },
        });
        console.log(`[Checkpoint] Test email sent to ${account.email}`);
      } catch (err: any) {
        console.error(`[Checkpoint] Failed to send test email to ${account.email}: ${err.message}`);
      }
    }
  }

  /**
   * Connect to a Yahoo IMAP inbox and check if the test email landed in INBOX or Bulk Mail.
   */
  private async pollAccount(
    account: any,
    subject: string,
    sentAfter: Date,
  ): Promise<'inbox' | 'spam' | 'not_found'> {
    const client = new ImapFlow({
      host: 'imap.mail.yahoo.com',
      port: 993,
      secure: true,
      auth: { user: account.email, pass: account.appPassword },
      logger: false,
      tls: { rejectUnauthorized: false },
    });

    try {
      await client.connect();

      // Check INBOX first
      const inboxResult = await this.searchFolder(client, 'INBOX', subject, sentAfter);
      if (inboxResult) {
        await client.logout();
        return 'inbox';
      }

      // Check Bulk Mail (Yahoo's spam folder)
      const spamResult = await this.searchFolder(client, 'Bulk Mail', subject, sentAfter);
      if (spamResult) {
        await client.logout();
        return 'spam';
      }

      await client.logout();
      return 'not_found';
    } catch (err: any) {
      console.error(`[Checkpoint] IMAP error for ${account.email}: ${err.message}`);
      try { await client.logout(); } catch (_) {}
      // Treat connection errors as spam (conservative)
      return 'not_found';
    }
  }

  private async searchFolder(
    client: ImapFlow,
    folder: string,
    subject: string,
    sentAfter: Date,
  ): Promise<boolean> {
    try {
      const lock = await client.getMailboxLock(folder);
      try {
        const messages: any[] = [];
        for await (const msg of client.fetch(
          { since: sentAfter, subject },
          { envelope: true },
        )) {
          messages.push(msg);
        }
        return messages.length > 0;
      } finally {
        lock.release();
      }
    } catch {
      // Folder may not exist on this account — not an error
      return false;
    }
  }
}
