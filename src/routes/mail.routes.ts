import { Router, Request, Response } from 'express';
import { CampaignService, CampaignOptions } from '../services/campaign.service';
import { authenticateMailerRequest } from '../middleware/auth.middleware';
import { SmtpConfig, createTransporter } from '../services/mailer.util';
import { EmailModel } from '../models/email.model';

const router = Router();
const campaignService = new CampaignService();

interface StartCampaignRequest {
  campaignId: string;
  batchSize: number;
  delay: number;
  smtpConfig?: SmtpConfig;
  from: string;
  fromName: string;
  subject: string;
  emailTemplate: string;
  offerId: string;
  selectedIp: string;
}

// POST /mail/campaign/start - Start or resume a campaign
router.post('/campaign/start', authenticateMailerRequest, async (req: Request, res: Response) => {
  try {
    const body: StartCampaignRequest = req.body;

    // Validate required fields
    const requiredFields = [
      'campaignId',
      'batchSize',
      'delay',
      'from',
      'fromName',
      'subject',
      'emailTemplate',
      'offerId',
      'selectedIp',
    ];

    for (const field of requiredFields) {
      if (!body[field as keyof StartCampaignRequest]) {
        return res.status(400).json({
          success: false,
          message: `Missing required field: ${field}`,
        });
      }
    }

    // Use provided SMTP config or fall back to environment variables
    const smtpConfig: SmtpConfig = body.smtpConfig || {
      host: process.env.SMTP_HOST || '',
      user: process.env.SMTP_USER || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
    };

    if (!smtpConfig.host || !smtpConfig.user) {
      return res.status(400).json({
        success: false,
        message: 'SMTP configuration is required (either in request body or environment variables)',
      });
    }

    const options: CampaignOptions = {
      campaignId: body.campaignId,
      batchSize: body.batchSize,
      delay: body.delay,
      smtpConfig,
      from: body.from,
      fromName: body.fromName,
      subject: body.subject,
      emailTemplate: body.emailTemplate,
      offerId: body.offerId,
      selectedIp: body.selectedIp,
    };

    const result = await campaignService.startCampaign(options);

    res.json(result);
  } catch (error: any) {
    console.error('Error starting campaign:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

// GET /mail/health - Health check endpoint
router.get('/health', (req: Request, res: Response) => {
  const runningCampaigns = campaignService.getRunningCampaigns();
  res.json({
    status: 'ok',
    mailerId: process.env.MAILER_ID || 'unknown',
    activeCampaigns: runningCampaigns,
    timestamp: new Date().toISOString(),
  });
});

// GET /mail/queue - Queue status (optional, for monitoring)
router.get('/queue', authenticateMailerRequest, (req: Request, res: Response) => {
  const runningCampaigns = campaignService.getRunningCampaigns();
  res.json({
    success: true,
    runningCampaigns: runningCampaigns.length,
    campaignIds: runningCampaigns,
  });
});

interface TestEmailRequest {
  from: string;
  fromName: string;
  subject: string;
  emailTemplate: string;
  offerId: string;
  campaignId: string;
  to: string[];
  selectedIp: string;
  smtpConfig?: SmtpConfig;
}

// POST /mail/test - Send test emails
router.post('/test', authenticateMailerRequest, async (req: Request, res: Response) => {
  console.log('[/mail/test] Request received');
  
  try {
    const body: TestEmailRequest = req.body;

    // Validate required fields
    const requiredFields = [
      'from',
      'fromName',
      'subject',
      'emailTemplate',
      'offerId',
      'campaignId',
      'to',
      'selectedIp',
    ];

    for (const field of requiredFields) {
      if (!body[field as keyof TestEmailRequest]) {
        console.log('[/mail/test] Missing required field:', field);
        return res.status(400).json({
          success: false,
          message: `Missing required field: ${field}`,
        });
      }
    }

    if (!Array.isArray(body.to) || body.to.length === 0) {
      console.log('[/mail/test] No recipients provided');
      return res.status(400).json({
        success: false,
        message: 'No recipients found, Please add recipients',
      });
    }

    // Use provided SMTP config or fall back to environment variables
    const smtpConfig: SmtpConfig = body.smtpConfig || {
      host: process.env.SMTP_HOST || '',
      user: process.env.SMTP_USER || '',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
    };

    if (!smtpConfig.host || !smtpConfig.user) {
      console.log('[/mail/test] SMTP configuration missing');
      return res.status(400).json({
        success: false,
        message: 'SMTP configuration is required (either in request body or environment variables)',
      });
    }

    const { from, fromName, subject, emailTemplate, offerId, campaignId, to, selectedIp } = body;

    console.log('[/mail/test] Starting to send emails to', to.length, 'recipients');
    console.log('[/mail/test] SMTP Config:', { host: smtpConfig.host, user: smtpConfig.user, port: smtpConfig.port });

    const decodedTemplate = decodeURIComponent(emailTemplate);
    const ip = selectedIp?.split('-')[1]?.trim();
    const domain = selectedIp?.split('-')[0]?.trim();
    const headers = { 'X-Outgoing-IP': ip };
    const transporter = createTransporter(smtpConfig);

    const failed: string[] = [];
    const sent: string[] = [];

    for (const email of to) {
      try {
        const info = await transporter.sendMail({
          from: `${fromName} <${from}>`,
          to: email,
          subject,
          html: decodedTemplate,
          headers,
          envelope: {
            from: `bounces@${domain}`,
            to: email,
          },
        });

        // Save to emails collection for reports
        await EmailModel.create({
          from,
          to: email,
          offerId,
          campaignId,
          sentAt: new Date(),
          response: info.response,
          mode: 'test',
          domainUsed: domain,
          ipUsed: ip,
        });

        sent.push(email);
      } catch (err: any) {
        console.error('[/mail/test] Failed to send email to:', email, 'Error:', err.message);
        
        // Save to emails collection for reports
        await EmailModel.create({
          from,
          to: email,
          offerId,
          campaignId,
          sentAt: new Date(),
          response: err.message,
          mode: 'test',
          domainUsed: domain,
          ipUsed: ip,
        });

        failed.push(email);
      }
    }

    console.log('[/mail/test] Completed. Sent:', sent.length, 'Failed:', failed.length);

    res.json({
      message:
        failed.length > 0
          ? 'Some emails failed'
          : 'All emails sent successfully',
      success: failed.length === 0,
      sent,
      failed,
      emailSent: sent.length,
      emailFailed: failed.length,
    });
  } catch (error: any) {
    console.error('[/mail/test] Error sending test emails:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message,
    });
  }
});

export default router;
