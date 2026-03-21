import { CampaignModel } from '../models/campaign.model';
import { CampaignEmailTrackingModel } from '../models/tracking.model';
import { EmailModel } from '../models/email.model';
import { LiveSendingModel } from '../models/live-sending.model';
import { createTransporter, SmtpConfig } from './mailer.util';
import * as nodemailer from 'nodemailer';

export interface CampaignOptions {
  campaignId: string;
  batchSize: number;
  delay: number;
  smtpConfig: SmtpConfig;
  from: string;
  fromName: string;
  subject: string;
  emailTemplate: string;
  offerId: string;
  selectedIp: string;
  /**
   * All IPs for round-robin sending: ["domain - mainIp", "domain - subIp1", ...]
   * When provided with more than one entry, each email is sent from the next IP in sequence.
   */
  allIps?: string[];
}

export class CampaignService {
  private runningCampaigns = new Map<string, Promise<void>>();

  async startCampaign(options: CampaignOptions): Promise<{ success: boolean; message: string }> {
    const { campaignId } = options;

    if (this.runningCampaigns.has(campaignId)) {
      return {
        success: true,
        message: `Campaign ${campaignId} is already running on this mailer`,
      };
    }

    const promise = this.runCampaignInBackground(options)
      .catch((err) => {
        console.error(`❌ Error in campaign loop for ${campaignId}:`, err);
      })
      .finally(() => {
        this.runningCampaigns.delete(campaignId);
      });

    this.runningCampaigns.set(campaignId, promise);

    return {
      success: true,
      message: `Campaign ${campaignId} sending started`,
    };
  }

  getRunningCampaigns(): string[] {
    return Array.from(this.runningCampaigns.keys());
  }

  private buildTransporters(
    allIps: string[],
    smtpConfig: SmtpConfig,
  ): Array<{ ip: string; domain: string; transporter: nodemailer.Transporter }> {
    return allIps.map((entry) => {
      const domain = entry.split('-')[0]?.trim();
      const ip = entry.split('-')[1]?.trim();
      const hostConfig: SmtpConfig = {
        host: `mail.${domain}`,
        user: `admin@${domain}`,
        port: smtpConfig.port || 587,
      };
      return { ip, domain, transporter: createTransporter(hostConfig) };
    });
  }

  private async runCampaignInBackground(options: CampaignOptions): Promise<void> {
    const {
      campaignId,
      batchSize,
      delay,
      smtpConfig,
      from,
      fromName,
      subject,
      emailTemplate,
      offerId,
      selectedIp,
      allIps,
    } = options;

    console.log(`🚀 Starting campaign loop for ${campaignId}`);

    const decodedTemplate = decodeURIComponent(emailTemplate);
    const delayBetweenEmailsMs = 100;

    // Build transporter pool — one per IP for round-robin
    const ipPool = this.buildTransporters(
      allIps && allIps.length > 0 ? allIps : [selectedIp],
      smtpConfig,
    );
    const isRoundRobin = ipPool.length > 1;

    console.log(
      `📡 IP pool for campaign ${campaignId}: [${ipPool.map((p) => p.ip).join(', ')}]${isRoundRobin ? ' (round-robin)' : ''}`,
    );

    // Track global email index for round-robin rotation
    let globalEmailIndex = 0;
    let campaignCompleted = false;

    while (true) {
      const campaign = await CampaignModel.findOne({ campaignId }).lean();
      if (!campaign || campaign.status !== 'running') {
        console.log(`⏹️ Campaign ${campaignId} is not running, stopping processor.`);
        break;
      }

      const recipients = await CampaignEmailTrackingModel.find({
        campaignId,
        status: 'pending',
        isProcessed: false,
      })
        .limit(batchSize)
        .lean();

      if (!recipients.length) {
        console.log(`✅ No more pending emails for campaign ${campaignId}`);
        campaignCompleted = true;
        break;
      }

      console.log(`📧 Processing ${recipients.length} emails for campaign ${campaignId}`);

      const emailRecords: any[] = [];
      const trackingUpdates: any[] = [];
      const liveSendingRecords: any[] = [];
      let count = 0;

      for (const recipient of recipients) {
        if (count % 3 === 0) {
          const statusCheck = await CampaignModel.findOne({ campaignId }).lean();
          if (!statusCheck || statusCheck.status !== 'running') {
            console.log('⏹️ Paused mid-batch, flushing partial results and stopping early.');
            if (emailRecords.length > 0) {
              await Promise.all([
                EmailModel.insertMany(emailRecords),
                CampaignEmailTrackingModel.bulkWrite(trackingUpdates),
                LiveSendingModel.insertMany(liveSendingRecords),
              ]);
            }
            return;
          }
        }

        // Round-robin: pick IP by global index
        const poolEntry = ipPool[globalEmailIndex % ipPool.length];
        const { ip, domain, transporter } = poolEntry;
        const headers = { 'X-Outgoing-IP': ip };

        try {
          const info = await transporter.sendMail({
            from: `${fromName} <${from}>`,
            to: recipient.to_email,
            subject,
            html: decodedTemplate,
            headers,
            envelope: {
              from: `bounces@${domain}`,
              to: recipient.to_email,
            },
          });

          emailRecords.push({
            from,
            to: recipient.to_email,
            offerId,
            campaignId,
            sentAt: new Date(),
            response: info.response,
            mode: 'bulk',
            domainUsed: domain,
            ipUsed: ip,
          });

          trackingUpdates.push({
            updateOne: {
              filter: { _id: recipient._id },
              update: { $set: { status: 'sent', sentAt: new Date(), isProcessed: true } },
            },
          });

          liveSendingRecords.push({
            campaignId,
            to: recipient.to_email,
            ipUsed: ip,
            domain,
            status: 'sent',
            sentAt: new Date(),
          });

          console.log(`✅ [${ip}] Sent to ${recipient.to_email}`);
        } catch (err: any) {
          emailRecords.push({
            from,
            to: recipient.to_email,
            offerId,
            campaignId,
            sentAt: new Date(),
            response: err.message,
            mode: 'bulk',
            domainUsed: domain,
            ipUsed: ip,
          });

          trackingUpdates.push({
            updateOne: {
              filter: { _id: recipient._id },
              update: {
                $set: {
                  status: 'failed',
                  sentAt: new Date(),
                  errorMessage: err.message,
                  isProcessed: true,
                },
              },
            },
          });

          liveSendingRecords.push({
            campaignId,
            to: recipient.to_email,
            ipUsed: ip,
            domain,
            status: 'failed',
            errorMessage: err.message,
            sentAt: new Date(),
          });

          console.warn(`❌ [${ip}] Failed to send to ${recipient.to_email}: ${err.message}`);
        }

        count++;
        globalEmailIndex++;
        await new Promise((res) => setTimeout(res, delayBetweenEmailsMs));
      }

      const operations: Promise<any>[] = [];
      if (emailRecords.length > 0) operations.push(EmailModel.insertMany(emailRecords));
      if (trackingUpdates.length > 0) operations.push(CampaignEmailTrackingModel.bulkWrite(trackingUpdates));
      if (liveSendingRecords.length > 0) operations.push(LiveSendingModel.insertMany(liveSendingRecords));
      if (operations.length > 0) await Promise.all(operations);

      console.log(`⏳ Waiting ${delay} seconds before next batch...`);
      await new Promise((res) => setTimeout(res, delay * 1000));
    }

    if (campaignCompleted) {
      await CampaignModel.updateOne(
        { campaignId },
        { status: 'completed', completedAt: new Date(), pendingEmails: 0 },
      );
      await this.cleanupCampaignData(campaignId);
      console.log(`✅ Campaign ${campaignId} completed.`);
    } else {
      console.log(`⏸️ Campaign ${campaignId} was paused.`);
    }
  }

  private async cleanupCampaignData(campaignId: string): Promise<void> {
    try {
      const [sent, failed, pending] = await Promise.all([
        CampaignEmailTrackingModel.countDocuments({ campaignId, status: 'sent' }),
        CampaignEmailTrackingModel.countDocuments({ campaignId, status: 'failed' }),
        CampaignEmailTrackingModel.countDocuments({ campaignId, status: 'pending' }),
      ]);

      await CampaignModel.updateOne(
        { campaignId },
        { sentEmails: sent, failedEmails: failed, totalEmails: sent + failed + pending, pendingEmails: pending },
      );

      await CampaignEmailTrackingModel.deleteMany({
        campaignId,
        status: { $in: ['sent', 'failed'] },
      });

      console.log(`🧹 Cleaned up tracking data for campaign ${campaignId}`);
    } catch (error: any) {
      console.error(`❌ Error cleaning up campaign data: ${error.message}`);
    }
  }
}
