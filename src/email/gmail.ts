import { google } from 'googleapis';

function envOrGoogle(key: string, fallbackKey: string) {
  return process.env[key] || process.env[fallbackKey] || '';
}

export function gmailAvailable(): boolean {
  const hasClient = !!envOrGoogle('GMAIL_CLIENT_ID', 'GOOGLE_CLIENT_ID');
  const hasSecret = !!envOrGoogle('GMAIL_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET');
  const hasRedirect = !!envOrGoogle('GMAIL_REDIRECT_URI', 'GOOGLE_REDIRECT_URI');
  const hasRefresh = !!process.env.GMAIL_REFRESH_TOKEN;
  return hasClient && hasSecret && hasRedirect && hasRefresh;
}

function createOAuth2ClientFromEnv() {
  const clientId = envOrGoogle('GMAIL_CLIENT_ID', 'GOOGLE_CLIENT_ID');
  const clientSecret = envOrGoogle('GMAIL_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET');
  const redirectUri = envOrGoogle('GMAIL_REDIRECT_URI', 'GOOGLE_REDIRECT_URI');
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN as string;
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  return oAuth2Client;
}

function encodeHeaderWord(value: string) {
  return `=?UTF-8?B?${Buffer.from(String(value) || '', 'utf8').toString('base64')}?=`;
}

function makeRawMessage({ from, to, subject, html }: { from: string; to: string; subject: string; html: string; }) {
  const encodedSubject = encodeHeaderWord(subject || '');
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
  ];
  const msg = headers.join('\n') + `\n\n${html}`;
  return Buffer.from(msg, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sendViaGmail({ to, html, subject = 'Funding Application — Next Steps', fromName = 'Fundly Bot', fromEmail }: { to: string; html: string; subject?: string; fromName?: string; fromEmail?: string; }) {
  if (!gmailAvailable()) throw new Error('Gmail env credentials incomplete');
  const auth = createOAuth2ClientFromEnv();
  const gmail = google.gmail({ version: 'v1', auth });
  const effectiveFromEmail = fromEmail || process.env.GMAIL_USER_EMAIL || process.env.SMTP_USER || 'me';
  const from = `${fromName} <${effectiveFromEmail}>`;
  const raw = makeRawMessage({ from, to, subject, html });
  const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  const id = res.data.id as string;
  return { id };
}

