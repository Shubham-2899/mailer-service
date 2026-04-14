import mongoose, { Schema } from 'mongoose';

const TestAccountSchema = new Schema(
  {
    email: { type: String, required: true, unique: true },
    appPassword: { type: String, required: true },
    provider: { type: String, default: 'yahoo' },
    active: { type: Boolean, default: true },
  },
  { collection: 'test_accounts', timestamps: true },
);

export const TestAccountModel = mongoose.model('TestAccount', TestAccountSchema);
