import fs from 'fs';
import path from 'path';
import nodemailer from 'nodemailer';
import { gmailAvailable, sendViaGmail } from './gmail.js';

function getTransporter() {
  const host = process.env.SMTP_HOST || '';
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function buildEmailHtml() {
  const tplPath = path.resolve(process.cwd(), 'src/email/general-template.html');
  let body = '';
  try {
    body = fs.readFileSync(tplPath, 'utf8');
  } catch {
    body = 'Thank you for reaching out regarding funding opportunities.';
  }
  const greeting = `<p>Hi there,</p>`;
  return greeting + body;
}

export async function sendLeadEmail({ to }: { to: string }) {
  const html = buildEmailHtml();
  const subject = process.env.EMAIL_SUBJECT || 'Funding Application — Next Steps';
  const fromName = process.env.FROM_NAME || 'Fundly Bot';
  const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || process.env.GMAIL_USER_EMAIL;

  if (gmailAvailable()) {
    try {
      const res = await sendViaGmail({ to, html, subject, fromName, fromEmail });
      return { gmailId: res.id };
    } catch (e) {
      console.warn(`Gmail send failed; falling back to SMTP: ${(e as Error).message}`);
    }
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.warn('SMTP not configured; skipping email send.');
    return { skipped: true } as const;
  }
  const info = await transporter.sendMail({
    from: `${fromName}${fromEmail ? ` <${fromEmail}>` : ''}`,
    to,
    subject,
    html,
  });
  return { messageId: info.messageId };
}

