import { CampaignModel, ICampaign } from '../models/campaign.model';
import { CampaignEmailTrackingModel } from '../models/tracking.model';
import { EmailModel } from '../models/email.model';
import { createTransporter, SmtpConfig } from './mailer.util';

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
}

export class CampaignService {
  private runningCampaigns = new Map<string, Promise<void>>();

  async startCampaign(options: CampaignOptions): Promise<{ success: boolean; message: string }> {
    const { campaignId } = options;

    // Check if campaign is already running
    if (this.runningCampaigns.has(campaignId)) {
      return {
        success: true,
        message: `Campaign ${campaignId} is already running on this mailer`,
      };
    }

    // Start background loop (fire-and-forget)
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
    } = options;

    console.log(`🚀 Starting campaign loop for ${campaignId}`);

    const transporter = createTransporter(smtpConfig);
    const decodedTemplate = decodeURIComponent(emailTemplate);
    const ip = selectedIp?.split('-')[1]?.trim();
    const domain = selectedIp?.split('-')[0]?.trim();
    const headers = { 'X-Outgoing-IP': ip };
    const delayBetweenEmailsMs = 100;

    let campaignCompleted = false;

    while (true) {
      // Check campaign status before processing
      const campaign = await CampaignModel.findOne({ campaignId }).lean();
      if (!campaign || campaign.status !== 'running') {
        console.log(`⏹️ Campaign ${campaignId} is not running, stopping processor.`);
        break;
      }

      // Get pending emails for this campaign
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

      // Prepare bulk operations for better performance
      const emailRecords: any[] = [];
      const trackingUpdates: any[] = [];
      let count = 0;

      for (const recipient of recipients) {
        // Hybrid pause check - check status every 3 emails
        if (count % 3 === 0) {
          const statusCheck = await CampaignModel.findOne({ campaignId }).lean();
          if (!statusCheck || statusCheck.status !== 'running') {
            console.log(
              '⏹️ Paused mid-batch (hybrid check), flushing partial results and stopping early.'
            );

            // Flush partial batch results
            if (emailRecords.length > 0) {
              await Promise.all([
                EmailModel.insertMany(emailRecords),
                CampaignEmailTrackingModel.bulkWrite(trackingUpdates),
              ]);
            }

            return;
          }
        }

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

          // Prepare email record for bulk insert
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

          // Prepare tracking update for bulk operation
          trackingUpdates.push({
            updateOne: {
              filter: { _id: recipient._id },
              update: {
                $set: {
                  status: 'sent',
                  sentAt: new Date(),
                  isProcessed: true,
                },
              },
            },
          });

          console.log(`✅ Sent to ${recipient.to_email}`);
        } catch (err: any) {
          // Prepare email record for bulk insert (failed)
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

          // Prepare tracking update for bulk operation (failed)
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

          console.warn(`❌ Failed to send to ${recipient.to_email}: ${err.message}`);
        }

        count++;
        // Small delay between individual emails to prevent rate limiting
        await new Promise((res) => setTimeout(res, delayBetweenEmailsMs));
      }

      // Bulk operations - only 2 queries instead of 5 per email
      const operations: Promise<any>[] = [];

      if (emailRecords.length > 0) {
        operations.push(EmailModel.insertMany(emailRecords));
      }

      if (trackingUpdates.length > 0) {
        operations.push(CampaignEmailTrackingModel.bulkWrite(trackingUpdates));
      }

      if (operations.length > 0) {
        await Promise.all(operations);
      }

      console.log(`⏳ Waiting ${delay} seconds before next batch...`);
      await new Promise((res) => setTimeout(res, delay * 1000));
    }

    // Only mark as completed if campaign actually finished all emails
    if (campaignCompleted) {
      // Mark campaign as completed
      await CampaignModel.updateOne(
        { campaignId },
        {
          status: 'completed',
          completedAt: new Date(),
          pendingEmails: 0,
        }
      );

      // Clean up campaign tracking data after completion
      await this.cleanupCampaignData(campaignId);

      console.log(`✅ Campaign ${campaignId} email sending completed.`);
    } else {
      console.log(`⏸️ Campaign ${campaignId} was paused, not marking as completed.`);
    }
  }

  private async cleanupCampaignData(campaignId: string): Promise<void> {
    try {
      // Persist stats in the campaign document
      const [sent, failed, pending] = await Promise.all([
        CampaignEmailTrackingModel.countDocuments({ campaignId, status: 'sent' }),
        CampaignEmailTrackingModel.countDocuments({
          campaignId,
          status: 'failed',
        }),
        CampaignEmailTrackingModel.countDocuments({
          campaignId,
          status: 'pending',
        }),
      ]);
      const total = sent + failed + pending;

      // Persist stats in the campaign document
      await CampaignModel.updateOne(
        { campaignId },
        {
          sentEmails: sent,
          failedEmails: failed,
          totalEmails: total,
          pendingEmails: pending,
        }
      );

      // Delete tracking data for sent/failed emails (keep pending for potential reactivation)
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
