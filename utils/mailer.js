/**
 * Nodemailer wrapper.
 * If SMTP_HOST / SMTP_USER are not set in .env the send function just
 * logs to console so the rest of the app still works during development.
 */
import nodemailer from 'nodemailer';

const configured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

let _transport = null;
function getTransport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transport;
}

/**
 * Send an email.
 * @param {{ to: string, subject: string, html: string, text?: string }} opts
 */
export async function sendMail({ to, subject, html, text }) {
  if (!configured) {
    console.log(`[mailer] SMTP not configured — would have sent to ${to}: ${subject}`);
    return;
  }
  await getTransport().sendMail({
    from: process.env.SMTP_FROM || 'Multicare Hospital <noreply@multicare.co.ke>',
    to,
    subject,
    text: text || subject,
    html,
  });
}

/**
 * Send the password-changed notification email.
 */
export async function sendPasswordChangedEmail({ toEmail, fullName }) {
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <div style="background:#1e3a5f;padding:20px 24px">
        <h2 style="color:#fff;margin:0;font-size:18px">Multicare Hospital Health Services</h2>
        <p style="color:#93c5fd;margin:4px 0 0;font-size:12px">Staff Portal — Security Notice</p>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 12px">Dear <strong>${fullName}</strong>,</p>
        <p style="margin:0 0 12px">
          This is to notify you that the password for your Multicare Hospital staff account
          (<strong>${toEmail}</strong>) was just reset.
        </p>
        <div style="background:#fef9c3;border:1px solid #fde047;border-radius:6px;padding:12px 16px;margin:16px 0">
          <strong style="color:#854d0e">⚠ If you did NOT request this change</strong>,
          please contact your system administrator immediately so they can secure your account.
        </div>
        <p style="margin:0 0 12px">
          You can now log in with your new password at the staff portal.
        </p>
        <p style="margin:24px 0 0;font-size:12px;color:#64748b">
          This is an automated message from the Multicare Hospital Management System.
          Please do not reply to this email.
        </p>
      </div>
    </div>
  `;
  await sendMail({
    to: toEmail,
    subject: 'Your Multicare Hospital staff password has been changed',
    html,
    text: `Dear ${fullName}, your Multicare Hospital staff account password was just reset. If you did not request this change, contact your administrator immediately.`,
  });
}
