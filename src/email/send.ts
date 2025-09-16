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

function buildEmailHtml(templateKey?: string) {
  // Load the base general template first
  let general = '';
  try {
    general = fs.readFileSync(path.resolve(process.cwd(), 'src/email/general-template.html'), 'utf8');
  } catch {}
  if (!general) general = 'Thank you for reaching out regarding funding opportunities.';

  // If a program template is provided, inject it into {{PROGRAM_FIT}} placeholder
  if (templateKey) {
    try {
      const programBlock = fs.readFileSync(path.resolve(process.cwd(), `src/email/templates/${templateKey}.html`), 'utf8');
      if (general.includes('{{PROGRAM_FIT}}')) {
        general = general.replace('{{PROGRAM_FIT}}', programBlock);
      } else {
        // Fallback: append program fit at the top if placeholder missing
        general = programBlock + general;
      }
    } catch {
      // If program template missing, strip placeholder
      general = general.replace('{{PROGRAM_FIT}}', '');
    }
  } else {
    general = general.replace('{{PROGRAM_FIT}}', '');
  }
  return general;
}

export async function sendLeadEmail({ to, programKey }: { to: string; programKey?: string }) {
  const html = buildEmailHtml(programKey);
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
