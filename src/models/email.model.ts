import mongoose, { Schema, Document } from 'mongoose';

export interface IEmail extends Document {
  from: string;
  to: string;
  offerId: string;
  campaignId: string;
  sentAt: Date;
  response: string;
  mode: string;
  domainUsed?: string;
  ipUsed?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const EmailSchema = new Schema<IEmail>(
  {
    from: { type: String, required: true },
    to: { type: String, required: true },
    offerId: { type: String, required: true },
    campaignId: { type: String, required: true },
    sentAt: { type: Date, default: Date.now },
    response: { type: String, required: true },
    mode: { type: String, default: 'bulk' },
    domainUsed: String,
    ipUsed: String,
  },
  { timestamps: true }
);

export const EmailModel = mongoose.model<IEmail>('Email', EmailSchema);
