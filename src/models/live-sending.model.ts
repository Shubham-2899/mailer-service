import mongoose, { Schema, Document } from 'mongoose';

export interface ILiveSending extends Document {
  campaignId: string;
  to: string;
  ipUsed: string;
  domain: string;
  status: 'sent' | 'failed';
  errorMessage?: string;
  sentAt: Date;
}

const LiveSendingSchema = new Schema<ILiveSending>(
  {
    campaignId: { type: String, required: true, index: true },
    to: { type: String, required: true },
    ipUsed: { type: String, required: true },
    domain: { type: String, required: true },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    errorMessage: String,
    sentAt: { type: Date, required: true },
  },
  { collection: 'live_sending', timestamps: false },
);

// TTL index: auto-delete records older than 24 hours to keep collection lean
LiveSendingSchema.index({ sentAt: 1 }, { expireAfterSeconds: 86400 });

export const LiveSendingModel = mongoose.model<ILiveSending>('LiveSending', LiveSendingSchema);
