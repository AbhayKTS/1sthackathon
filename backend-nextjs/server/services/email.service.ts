/**
 * Email Service — server-side only.
 *
 * Provider: Resend (primary). If RESEND_API_KEY is not set, OTPs are
 * printed to the server console in development mode — never in production.
 *
 * Phase 1 implements the OTP template.
 * Phase 11 will implement all remaining templates (invitation, approved, etc.)
 *
 * All sends are logged to the `emailLogs` Firestore collection (Phase 11).
 * For Phase 1, logging is omitted to keep scope focused.
 *
 * @module server/services/email.service
 */

import { Resend } from 'resend';
import { env } from '@/lib/env';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmailTemplate =
  | 'invitation'
  | 'otp'
  | 'verified'
  | 'approved'
  | 'rejected'
  | 'needChanges'
  | 'reminder';

export interface SendEmailOptions {
  to: string;
  template: EmailTemplate;
  variables: Record<string, string | number>;
}

export interface SendEmailResult {
  success: boolean;
  messageId: string | null;
  error: string | null;
  devMode: boolean;
}

// ─── Template Renderers ───────────────────────────────────────────────────────

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function renderOtpEmail(vars: Record<string, string | number>): RenderedEmail {
  const { otp, expiryMinutes, teamName } = vars as {
    otp: string;
    expiryMinutes: string | number;
    teamName?: string;
  };

  const greeting = teamName ? `Congratulations, Team <strong>${teamName}</strong>!` : 'Hello!';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RevengersHack — OTP Verification</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:40px auto;">
    <tr>
      <td style="background:#111;border:1px solid #2a2a2a;border-radius:4px;padding:40px;">
        <!-- Header -->
        <div style="border-left:3px solid #e50914;padding-left:16px;margin-bottom:32px;">
          <h1 style="margin:0;color:#e50914;font-size:22px;letter-spacing:4px;text-transform:uppercase;">
            REVENGERS<span style="color:#fff;">HACK</span>
          </h1>
          <p style="margin:4px 0 0;color:#666;font-size:11px;letter-spacing:2px;">VERIFICATION SYSTEM</p>
        </div>

        <!-- Body -->
        <p style="color:#ccc;font-size:14px;line-height:1.6;">${greeting}</p>
        <p style="color:#ccc;font-size:14px;line-height:1.6;">
          Use the code below to complete your verification. This code expires in
          <strong style="color:#fff;">${expiryMinutes} minutes</strong>.
        </p>

        <!-- OTP Box -->
        <div style="background:#1a1a1a;border:1px solid #e50914;border-radius:4px;padding:24px;text-align:center;margin:32px 0;">
          <p style="margin:0 0 8px;color:#666;font-size:11px;letter-spacing:3px;text-transform:uppercase;">
            Your OTP Code
          </p>
          <div style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#e50914;font-family:monospace;">
            ${otp}
          </div>
        </div>

        <!-- Warning -->
        <p style="color:#555;font-size:12px;line-height:1.6;border-top:1px solid #1f1f1f;padding-top:20px;margin-top:20px;">
          ⚠️ Never share this code with anyone. If you didn't request this,
          please ignore this email — your account has not been affected.
        </p>

        <!-- Footer -->
        <p style="color:#333;font-size:11px;margin-top:32px;">
          — Team RevengersHack &nbsp;|&nbsp; This is an automated message. Do not reply.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    'REVENGERSHACK — VERIFICATION',
    '',
    teamName ? `Congratulations, Team ${teamName}!` : 'Hello!',
    '',
    `Your OTP verification code is: ${otp}`,
    `This code expires in ${expiryMinutes} minutes.`,
    '',
    'Never share this code with anyone.',
    'If you did not request this, please ignore this email.',
    '',
    '— Team RevengersHack',
  ].join('\n');

  return {
    subject: `[${otp}] Your RevengersHack Verification Code`,
    html,
    text,
  };
}

// ─── Template Router ─────────────────────────────────────────────────────────

function renderTemplate(
  template: EmailTemplate,
  variables: Record<string, string | number>,
): RenderedEmail {
  switch (template) {
    case 'otp':
      return renderOtpEmail(variables);

    // TODO Phase 11: implement remaining templates
    case 'invitation':
    case 'verified':
    case 'approved':
    case 'rejected':
    case 'needChanges':
    case 'reminder':
      throw new Error(`Email template "${template}" not yet implemented (Phase 11).`);
  }
}

// ─── Send Function ────────────────────────────────────────────────────────────

let _resend: Resend | null = null;

function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

/**
 * Sends a templated email.
 *
 * - If RESEND_API_KEY is set: sends via Resend API
 * - If not set + NODE_ENV=development: logs OTP to console (DEV MODE)
 * - If not set + NODE_ENV=production: throws an error
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, template, variables } = options;
  const rendered = renderTemplate(template, variables);
  const resend = getResend();

  // ─── Dev mode fallback ──────────────────────────────────────────────────
  if (!resend) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'RESEND_API_KEY is not set in production. Cannot send emails.',
      );
    }

    // Development: log to console so developers can test without a real email
    // eslint-disable-next-line no-console -- intentional: dev-only feedback
    console.log(
      [
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  📧  DEV MODE EMAIL (RESEND_API_KEY not set)',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `  To:       ${to}`,
        `  Template: ${template}`,
        `  Subject:  ${rendered.subject}`,
        '',
        '  ─── Email Body (plain text) ───',
        rendered.text,
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '',
      ].join('\n'),
    );

    return { success: true, messageId: null, error: null, devMode: true };
  }

  // ─── Production: send via Resend ────────────────────────────────────────
  try {
    const result = await resend.emails.send({
      from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    if (result.error) {
      return {
        success: false,
        messageId: null,
        error: result.error.message,
        devMode: false,
      };
    }

    return {
      success: true,
      messageId: result.data?.id ?? null,
      error: null,
      devMode: false,
    };
  } catch (err) {
    return {
      success: false,
      messageId: null,
      error: err instanceof Error ? err.message : 'Unknown error',
      devMode: false,
    };
  }
}
