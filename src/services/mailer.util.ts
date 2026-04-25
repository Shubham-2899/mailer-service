import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

export interface SmtpConfig {
  host?: string;  // kept for interface compatibility but ignored — always uses localhost MTA
  user: string;
  port?: number;
}

/**
 * Creates a Nodemailer transporter that submits mail to the local Exim4 MTA.
 *
 * Architecture: mailer-service runs on the same VPS as Exim4.
 * Nodemailer → localhost:587 (STARTTLS) → Exim4 → outbound delivery.
 *
 * Exim4 EHLO capabilities on this server:
 *   STARTTLS — offered, Nodemailer upgrades automatically (secure: false + port 587)
 *   AUTH PLAIN LOGIN — required, credentials passed via auth config
 *
 * Deliverability is unaffected: DKIM signing, SPF, PTR records are all handled
 * by Exim4 on the outbound path, not by how Nodemailer connects to it locally.
 */
export function createTransporter(smtpConfig: SmtpConfig): Transporter {
  // SNI hostname for TLS handshake with Exim4 on localhost:587.
  // Exim4 uses SNI to select the correct TLS certificate for this domain.
  // Must be mail.domain.com — if omitted, Nodemailer defaults to 'localhost',
  // causing Exim4 to present the wrong certificate.
  // Note: Exim4's outbound HELO/EHLO to Gmail/Yahoo is controlled separately
  // by primary_hostname and helo_data in the Exim4 config, not by SNI.
  const mailHostname = smtpConfig.host || `mail.${smtpConfig.user.split('@')[1]}`;

  return nodemailer.createTransport({
    host: 'localhost', // Loopback connection to Exim4 on same VPS (no network overhead vs. connecting to public IP)
    port: 587,
    secure: false,       // false = STARTTLS on port 587 (not implicit TLS on 465)
    ignoreTLS: false,    // allow STARTTLS upgrade when Exim4 offers it
    tls: {
      rejectUnauthorized: false,  // Exim4 uses self-signed cert on localhost
      servername: mailHostname,   // SNI: tell Exim4 which certificate to present
    },
    auth: {
      user: smtpConfig.user,
      pass: process.env.ROOT_MAIL_USER_PASSWORD || '',
    },
    pool: true,
    logger: true,
    maxConnections: 5,
    maxMessages: 100,
    rateLimit: 10,
    connectionTimeout: 2 * 60 * 1000,  // 2 minutes
    greetingTimeout: 30 * 1000,        // 30 seconds
    socketTimeout: 5 * 60 * 1000,      // 5 minutes
  });
}
