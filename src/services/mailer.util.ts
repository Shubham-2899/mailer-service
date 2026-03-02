import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  user: string;
  port?: number;
}

export function createTransporter(smtpConfig: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port || 587,
    pool: true,
    secure: false,
    tls: {
      rejectUnauthorized: false,
    },
    auth: {
      user: smtpConfig.user,
      pass: process.env.ROOT_MAIL_USER_PASSWORD || '',
    },
    logger: true,
    maxConnections: 5,
    maxMessages: 100,
    rateLimit: 10,
    connectionTimeout: 2 * 60 * 1000,
    greetingTimeout: 30 * 1000,
    socketTimeout: 5 * 60 * 1000,
  });
}
