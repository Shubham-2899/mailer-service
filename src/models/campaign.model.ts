import mongoose, { Schema, Document } from 'mongoose';

export interface ICampaign extends Document {
  campaignId: string;
  status: 'draft' | 'ready' | 'running' | 'paused' | 'completed' | 'ended';
  from?: string;
  fromName?: string;
  subject?: string;
  templateType?: string;
  emailTemplate?: string;
  offerId?: string;
  selectedIp?: string;
  batchSize?: number;
  delay?: number;
  jobId?: string;
  startedAt?: Date;
  completedAt?: Date;
  pendingEmails?: number;
  totalEmails?: number;
  sentEmails?: number;
  failedEmails?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const CampaignSchema = new Schema<ICampaign>(
  {
    campaignId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['draft', 'ready', 'running', 'paused', 'completed', 'ended'],
      default: 'draft',
    },
    from: String,
    fromName: String,
    subject: String,
    templateType: String,
    emailTemplate: String,
    offerId: String,
    selectedIp: String,
    batchSize: Number,
    delay: Number,
    jobId: String,
    startedAt: Date,
    completedAt: Date,
    pendingEmails: { type: Number, default: 0 },
    totalEmails: Number,
    sentEmails: Number,
    failedEmails: Number,
  },
  { collection: 'campaigns', timestamps: true }
);

export const CampaignModel = mongoose.model<ICampaign>('Campaign', CampaignSchema);
