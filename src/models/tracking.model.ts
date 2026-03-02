import mongoose, { Schema, Document } from 'mongoose';

export interface ICampaignEmailTracking extends Document {
  to_email: string;
  campaignId: string;
  status: 'pending' | 'sent' | 'failed';
  isProcessed: boolean;
  sentAt?: Date;
  errorMessage?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const CampaignEmailTrackingSchema = new Schema<ICampaignEmailTracking>(
  {
    to_email: {
      type: String,
      required: true,
      match: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    },
    campaignId: { type: String, required: true },
    status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
    isProcessed: { type: Boolean, default: false },
    sentAt: Date,
    errorMessage: String,
  },
  { collection: 'campaign_email_tracking', timestamps: true }
);

export const CampaignEmailTrackingModel = mongoose.model<ICampaignEmailTracking>(
  'CampaignEmailTracking',
  CampaignEmailTrackingSchema
);
