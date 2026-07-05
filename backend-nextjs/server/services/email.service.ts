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
import { FieldValue } from 'firebase-admin/firestore';
import { env } from '@/lib/env';
import { getAdminDb } from '@/lib/firebase-admin';

// ─── Types ───────────────────────────────────────────────────────────────────

export type EmailTemplate =
  | 'invitation'
  | 'otp'
  | 'verified'
  | 'approved'
  | 'rejected'
  | 'needChanges'
  | 'reminder'
  | 'admin_invite';

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

function renderStandardEmail(subject: string, title: string, subtitle: string, bodyHtml: string, textBody: string): RenderedEmail {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RevengersHack</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Segoe UI',Arial,sans-serif;color:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:40px auto;">
    <tr>
      <td style="background:#111;border:1px solid #2a2a2a;border-radius:4px;padding:40px;">
        <div style="border-left:3px solid #e50914;padding-left:16px;margin-bottom:32px;">
          <h1 style="margin:0;color:#e50914;font-size:22px;letter-spacing:4px;text-transform:uppercase;">
            REVENGERS<span style="color:#fff;">HACK</span>
          </h1>
          <p style="margin:4px 0 0;color:#666;font-size:11px;letter-spacing:2px;text-transform:uppercase;">${subtitle}</p>
        </div>
        ${bodyHtml}
        <p style="color:#333;font-size:11px;margin-top:32px;border-top:1px solid #1f1f1f;padding-top:20px;">
          — Team RevengersHack &nbsp;|&nbsp; This is an automated message.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `REVENGERSHACK — ${subtitle}`,
    '',
    textBody,
    '',
    '— Team RevengersHack',
  ].join('\n');

  return { subject, html, text };
}

function renderInvitationEmail(vars: Record<string, string | number>): RenderedEmail {
  const teamName = vars.teamName as string;
  const loginUrl = vars.loginUrl as string;
  return renderStandardEmail(
    `[REVENGERSHACK] You've been recruited.`,
    `You've been recruited.`,
    `INITIATION PROTOCOL`,
    `<p style="color:#ccc;font-size:14px;line-height:1.6;">Team <strong>${teamName}</strong>,</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">You have been officially recruited for RevengersHack. The underground awaits your arrival.</p>
     <div style="margin:32px 0;">
       <a href="${loginUrl}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;letter-spacing:2px;font-weight:bold;display:inline-block;">ACCESS PORTAL</a>
     </div>
     <p style="color:#555;font-size:12px;line-height:1.6;">If the button doesn't work, copy and paste this link: <br/> <a href="${loginUrl}" style="color:#e50914;">${loginUrl}</a></p>`,
    `Team ${teamName},\n\nYou have been officially recruited for RevengersHack. The underground awaits your arrival.\n\nAccess the portal here: ${loginUrl}`
  );
}

function renderVerifiedEmail(vars: Record<string, string | number>): RenderedEmail {
  const loginUrl = vars.loginUrl as string;
  return renderStandardEmail(
    `[REVENGERSHACK] Clearance level upgraded.`,
    `Clearance level upgraded.`,
    `VERIFICATION SUCCESS`,
    `<p style="color:#ccc;font-size:14px;line-height:1.6;">Your email has been verified.</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">To proceed, you must now lock in your team details. Proceed to the dashboard to complete your squad profile.</p>
     <div style="margin:32px 0;">
       <a href="${loginUrl}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;letter-spacing:2px;font-weight:bold;display:inline-block;">COMPLETE PROFILE</a>
     </div>`,
    `Your email has been verified.\n\nTo proceed, you must now lock in your team details. Access the dashboard to complete your squad profile: ${loginUrl}`
  );
}

function renderApprovedEmail(vars: Record<string, string | number>): RenderedEmail {
  const teamName = vars.teamName as string;
  const loginUrl = vars.loginUrl as string;
  return renderStandardEmail(
    `[REVENGERSHACK] Clearance granted.`,
    `Clearance granted.`,
    `APPLICATION APPROVED`,
    `<p style="color:#ccc;font-size:14px;line-height:1.6;">Team <strong>${teamName}</strong>,</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">Your team profile has been approved by central command. The dashboard is now fully unlocked.</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">Stand by for the first round to begin.</p>
     <div style="margin:32px 0;">
       <a href="${loginUrl}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;letter-spacing:2px;font-weight:bold;display:inline-block;">ENTER DASHBOARD</a>
     </div>`,
    `Team ${teamName},\n\nYour team profile has been approved by central command. The dashboard is now fully unlocked.\n\nEnter Dashboard: ${loginUrl}`
  );
}

function renderRejectedEmail(vars: Record<string, string | number>): RenderedEmail {
  const teamName = vars.teamName as string;
  return renderStandardEmail(
    `[REVENGERSHACK] Clearance denied.`,
    `Clearance denied.`,
    `APPLICATION REJECTED`,
    `<p style="color:#ccc;font-size:14px;line-height:1.6;">Team <strong>${teamName}</strong>,</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">We regret to inform you that your application has been rejected by central command.</p>
     <p style="color:#555;font-size:12px;line-height:1.6;border-top:1px solid #1f1f1f;padding-top:20px;margin-top:20px;">
       Decisions are final. We thank you for your interest.
     </p>`,
    `Team ${teamName},\n\nWe regret to inform you that your application has been rejected by central command.\n\nDecisions are final. We thank you for your interest.`
  );
}

function renderNeedChangesEmail(vars: Record<string, string | number>): RenderedEmail {
  const teamName = vars.teamName as string;
  const notes = vars.notes as string;
  const loginUrl = vars.loginUrl as string;
  return renderStandardEmail(
    `[REVENGERSHACK] Intel required.`,
    `Intel required.`,
    `APPLICATION INCOMPLETE`,
    `<p style="color:#ccc;font-size:14px;line-height:1.6;">Team <strong>${teamName}</strong>,</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">Admin has requested changes to your team profile before it can be approved.</p>
     <div style="background:#1a1a1a;border-left:3px solid #f59e0b;padding:16px;margin:24px 0;">
       <p style="margin:0;color:#ccc;font-size:13px;line-height:1.5;"><em>"${notes}"</em></p>
     </div>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">Please log in to address these issues and resubmit.</p>
     <div style="margin:32px 0;">
       <a href="${loginUrl}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;letter-spacing:2px;font-weight:bold;display:inline-block;">UPDATE PROFILE</a>
     </div>`,
    `Team ${teamName},\n\nAdmin has requested changes to your team profile before it can be approved:\n\n"${notes}"\n\nPlease log in to address these issues and resubmit: ${loginUrl}`
  );
}

function renderReminderEmail(vars: Record<string, string | number>): RenderedEmail {
  const teamName = vars.teamName as string;
  const hoursLeft = vars.hoursLeft as string | number;
  const loginUrl = vars.loginUrl as string;
  return renderStandardEmail(
    `[REVENGERSHACK] Tick tock. ${hoursLeft} hours remain.`,
    `Time is running out.`,
    `SUBMISSION DEADLINE`,
    `<p style="color:#ccc;font-size:14px;line-height:1.6;">Team <strong>${teamName}</strong>,</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">Tick tock. You only have <strong style="color:#fff;">${hoursLeft} hours</strong> remaining to transmit your payload.</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">Lock in your code, defend your turf, or perish.</p>
     <div style="margin:32px 0;">
       <a href="${loginUrl}" style="background:#e50914;color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;letter-spacing:2px;font-weight:bold;display:inline-block;">SUBMIT NOW</a>
     </div>`,
    `Team ${teamName},\n\nTick tock. You only have ${hoursLeft} hours remaining to transmit your payload.\n\nLock in your code, defend your turf, or perish.\n\nSubmit now: ${loginUrl}`
  );
}

function renderAdminInviteEmail(vars: Record<string, string | number>): RenderedEmail {
  const loginUrl = vars.loginUrl as string;
  return renderStandardEmail(
    `[REVENGERSHACK] Admin Access Granted`,
    `Admin Access Granted`,
    `SYSTEM ADMINISTRATION`,
    `<p style="color:#ccc;font-size:14px;line-height:1.6;">Hello,</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">You have been granted Administrator access to the RevengersHack portal.</p>
     <p style="color:#ccc;font-size:14px;line-height:1.6;">You can now log in using this email address to access the command center and manage teams.</p>
     <div style="margin:32px 0;">
       <a href="${loginUrl}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;letter-spacing:2px;font-weight:bold;display:inline-block;">ACCESS COMMAND CENTER</a>
     </div>`,
    `Hello,\n\nYou have been granted Administrator access to the RevengersHack portal.\nYou can now log in using this email address to access the command center and manage teams.\n\nAccess Command Center: ${loginUrl}`
  );
}

function renderTemplate(
  template: EmailTemplate,
  variables: Record<string, string | number>,
): RenderedEmail {
  switch (template) {
    case 'otp':
      return renderOtpEmail(variables);
    case 'invitation':
      return renderInvitationEmail(variables);
    case 'verified':
      return renderVerifiedEmail(variables);
    case 'approved':
      return renderApprovedEmail(variables);
    case 'rejected':
      return renderRejectedEmail(variables);
    case 'needChanges':
      return renderNeedChangesEmail(variables);
    case 'reminder':
      return renderReminderEmail(variables);
    case 'admin_invite':
      return renderAdminInviteEmail(variables);
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
 * Direct call to Postmark's HTTP Send API.
 * Avoids adding an extra npm package dependency.
 */
async function sendPostmarkEmail(
  to: string,
  subject: string,
  html: string,
  text: string,
): Promise<{ success: boolean; messageId: string | null; error: string | null }> {
  try {
    const res = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Postmark-Server-Token': env.POSTMARK_SERVER_TOKEN as string,
      },
      body: JSON.stringify({
        From: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
      }),
    });

    const data = (await res.json()) as { MessageID?: string; Message?: string };

    if (!res.ok) {
      return {
        success: false,
        messageId: null,
        error: data.Message || 'Failed to send via Postmark',
      };
    }

    return {
      success: true,
      messageId: data.MessageID || null,
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      messageId: null,
      error: err instanceof Error ? err.message : 'Unknown network error',
    };
  }
}

/**
 * Sends a templated email.
 *
 * - If POSTMARK_SERVER_TOKEN is set: sends via Postmark HTTP API (primary)
 * - If RESEND_API_KEY is set: sends via Resend API (fallback)
 * - If neither is set + NODE_ENV=development: logs OTP to console (DEV MODE)
 * - If neither is set + NODE_ENV=production: throws an error
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, template, variables } = options;
  const rendered = renderTemplate(template, variables);

  // ─── Postmark Provider (takes precedence) ──────────────────────────────
  if (env.POSTMARK_SERVER_TOKEN) {
    let attempt = 0;
    let lastError = '';
    const maxRetries = 3;

    while (attempt < maxRetries) {
      try {
        attempt++;
        const result = await sendPostmarkEmail(to, rendered.subject, rendered.html, rendered.text);
        
        if (result.success) {
          await logEmailAttempt(to, template, true, null, result.messageId);
          return {
            success: true,
            messageId: result.messageId,
            error: null,
            devMode: false,
          };
        }

        lastError = result.error ?? 'Failed to send';
        // Retry on network/rate-limiting/timeout errors
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Unknown error';
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }

    await logEmailAttempt(to, template, false, lastError, null);
    return {
      success: false,
      messageId: null,
      error: lastError,
      devMode: false,
    };
  }

  // ─── Resend Provider (fallback) ─────────────────────────────────────────
  const resend = getResend();

  if (resend) {
    let attempt = 0;
    let lastError = '';
    const maxRetries = 3;

    while (attempt < maxRetries) {
      try {
        attempt++;
        const result = await resend.emails.send({
          from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
          to,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });

        if (result.error) {
          lastError = result.error.message;
          if (result.error.message.includes('rate limit') || result.error.message.includes('timeout')) {
              await new Promise((res) => setTimeout(res, 1000 * attempt)); // exponential backoff
              continue; // retry
          } else {
              break; // don't retry on formatting/auth errors
          }
        }

        // Success
        await logEmailAttempt(to, template, true, null, result.data?.id);
        return {
          success: true,
          messageId: result.data?.id ?? null,
          error: null,
          devMode: false,
        };
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'Unknown error';
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }

    // Failure after retries
    await logEmailAttempt(to, template, false, lastError, null);
    return {
      success: false,
      messageId: null,
      error: lastError,
      devMode: false,
    };
  }

  // ─── Dev mode fallback (neither provider configured) ───────────────────────
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Neither POSTMARK_SERVER_TOKEN nor RESEND_API_KEY is configured in production. Cannot send emails.',
    );
  }

  // Development: log to console so developers can test without a real email
  // eslint-disable-next-line no-console -- intentional: dev-only feedback
  console.log(
    [
      '',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
      '  📧  DEV MODE EMAIL (No provider configured)',
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

async function logEmailAttempt(to: string, template: string, success: boolean, error: string | null, messageId: string | null | undefined) {
    try {
        const db = getAdminDb();
        await db.collection('emailLogs').add({
            to,
            template,
            success,
            error,
            messageId: messageId || null,
            timestamp: FieldValue.serverTimestamp()
        });
    } catch (e) {
        console.error("Failed to write to emailLogs", e);
    }
}
