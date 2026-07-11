/**
 * Email Service — server-side only.
 *
 * IMPORTANT: External code should NEVER call sendEmailDirect() directly.
 * Use createMailJob() from mail-queue.service.ts instead.
 *
 * sendEmailDirect() is exported ONLY for the mail-worker to call.
 * It is the inner transport layer — no queueing, no retry, no Firestore writes.
 *
 * Provider priority:
 *   1. Postmark (POSTMARK_SERVER_TOKEN set)
 *   2. Resend  (RESEND_API_KEY set)
 *   3. Console log (development only)
 *
 * @module server/services/email.service
 */

import { Resend } from 'resend';
import { FieldValue } from 'firebase-admin/firestore';
import { env } from '@/lib/env';
import { getAdminDb } from '@/lib/firebase-admin';
import type { EmailTemplate } from '@/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { EmailTemplate };

export interface DirectEmailOptions {
  to: string;
  template: EmailTemplate;
  variables: Record<string, string | number>;
}

export interface DirectEmailResult {
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

function emailWrapper(subtitle: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
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
          — Team RevengersHack &nbsp;|&nbsp; This is an automated message. Do not reply.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string, color = '#e50914'): string {
  return `<div style="margin:32px 0;">
    <a href="${href}" style="background:${color};color:#fff;text-decoration:none;padding:12px 24px;font-size:14px;letter-spacing:2px;font-weight:bold;display:inline-block;">${label}</a>
  </div>
  <p style="color:#555;font-size:12px;line-height:1.6;">If the button doesn't work, copy and paste this link:<br/>
  <a href="${href}" style="color:#e50914;">${href}</a></p>`;
}

function body(text: string): string {
  return `<p style="color:#ccc;font-size:14px;line-height:1.6;">${text}</p>`;
}

function highlightBox(content: string, color = '#e50914'): string {
  return `<div style="background:#1a1a1a;border-left:3px solid ${color};padding:16px;margin:24px 0;">
    <p style="margin:0;color:#ccc;font-size:13px;line-height:1.5;">${content}</p>
  </div>`;
}

// ─── All Email Templates ──────────────────────────────────────────────────────

function renderOtp(vars: Record<string, string | number>): RenderedEmail {
  const { otp, expiryMinutes, teamName } = vars as { otp: string; expiryMinutes: string | number; teamName?: string };
  const greeting = teamName ? `Congratulations, Team <strong>${teamName}</strong>!` : 'Hello!';

  const html = emailWrapper('VERIFICATION SYSTEM', `
    ${body(greeting)}
    ${body(`Use the code below to complete your verification. This code expires in <strong style="color:#fff;">${expiryMinutes} minutes</strong>.`)}
    <div style="background:#1a1a1a;border:1px solid #e50914;border-radius:4px;padding:24px;text-align:center;margin:32px 0;">
      <p style="margin:0 0 8px;color:#666;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Your OTP Code</p>
      <div style="font-size:40px;font-weight:bold;letter-spacing:12px;color:#e50914;font-family:monospace;">${otp}</div>
    </div>
    <p style="color:#555;font-size:12px;line-height:1.6;border-top:1px solid #1f1f1f;padding-top:20px;margin-top:20px;">
      ⚠️ Never share this code with anyone. If you didn't request this, please ignore this email.
    </p>`);

  return {
    subject: `[${otp}] Your RevengersHack Verification Code`,
    html,
    text: [
      'REVENGERSHACK — VERIFICATION',
      '',
      teamName ? `Congratulations, Team ${teamName}!` : 'Hello!',
      '',
      `Your OTP code: ${otp}`,
      `Expires in: ${expiryMinutes} minutes`,
      '',
      'Never share this code with anyone.',
    ].join('\n'),
  };
}

function renderLeaderInvitation(vars: Record<string, string | number>): RenderedEmail {
  const { teamName, loginUrl, leaderName } = vars as { teamName: string; loginUrl: string; leaderName: string };
  const html = emailWrapper('INITIATION PROTOCOL', `
    ${body(`Hey <strong>${leaderName}</strong>,`)}
    ${body(`Team <strong>${teamName}</strong> has been officially shortlisted for RevengersHack 2026.`)}
    ${body('As the Team Leader, you have been selected to complete the registration. Click below to access the portal and set up your team profile.')}
    ${highlightBox('⏰ Complete registration within 48 hours to confirm your spot.', '#f59e0b')}
    ${ctaButton(String(loginUrl), 'BEGIN REGISTRATION')}`);

  return {
    subject: `[REVENGERSHACK] You've been recruited — Complete your registration`,
    html,
    text: `Hey ${leaderName},\n\nTeam ${teamName} has been shortlisted for RevengersHack 2026.\n\nComplete registration here: ${loginUrl}`,
  };
}

function renderMemberInvitation(vars: Record<string, string | number>): RenderedEmail {
  const { memberName, teamName, leaderName, loginUrl } = vars as {
    memberName: string; teamName: string; leaderName: string; loginUrl: string;
  };

  const html = emailWrapper('SQUAD REGISTRATION CONFIRMED', `
    ${body(`Hey <strong>${memberName}</strong>,`)}
    ${body(`Your team leader <strong>${leaderName}</strong> has completed the registration for Team <strong>${teamName}</strong>.`)}
    ${body('You can now log in to the RevengersHack portal using your email via OTP. Complete your member profile to finalize your team registration.')}
    ${ctaButton(String(loginUrl), 'ACCESS PORTAL')}`);

  return {
    subject: `[REVENGERSHACK] Your team is registered — complete your profile`,
    html,
    text: `Hey ${memberName},\n\nTeam leader ${leaderName} has registered Team ${teamName}.\n\nAccess the portal: ${loginUrl}`,
  };
}

function renderVerified(vars: Record<string, string | number>): RenderedEmail {
  const { loginUrl } = vars as { loginUrl: string };
  const html = emailWrapper('VERIFICATION SUCCESS', `
    ${body('Your email has been verified.')}
    ${body('To proceed, complete your team details in the dashboard.')}
    ${ctaButton(String(loginUrl), 'COMPLETE PROFILE')}`);

  return {
    subject: '[REVENGERSHACK] Clearance level upgraded.',
    html,
    text: `Your email has been verified.\n\nComplete your profile: ${loginUrl}`,
  };
}

function renderApproved(vars: Record<string, string | number>): RenderedEmail {
  const { teamName, loginUrl } = vars as { teamName: string; loginUrl: string };
  const html = emailWrapper('APPLICATION APPROVED', `
    ${body(`Team <strong>${teamName}</strong>,`)}
    ${body('Your team profile has been approved by central command. The dashboard is now fully unlocked.')}
    ${body('Stand by for the first round to begin.')}
    ${ctaButton(String(loginUrl), 'ENTER DASHBOARD')}`);

  return {
    subject: '[REVENGERSHACK] Clearance granted.',
    html,
    text: `Team ${teamName},\n\nYour team profile has been approved.\n\nEnter Dashboard: ${loginUrl}`,
  };
}

function renderRejected(vars: Record<string, string | number>): RenderedEmail {
  const { teamName } = vars as { teamName: string };
  const html = emailWrapper('APPLICATION REJECTED', `
    ${body(`Team <strong>${teamName}</strong>,`)}
    ${body('We regret to inform you that your application has been rejected by central command.')}
    <p style="color:#555;font-size:12px;line-height:1.6;border-top:1px solid #1f1f1f;padding-top:20px;margin-top:20px;">
      Decisions are final. We thank you for your interest.
    </p>`);

  return {
    subject: '[REVENGERSHACK] Clearance denied.',
    html,
    text: `Team ${teamName},\n\nWe regret to inform you that your application has been rejected.\n\nDecisions are final. Thank you for your interest.`,
  };
}

function renderNeedChanges(vars: Record<string, string | number>): RenderedEmail {
  const { teamName, notes, loginUrl } = vars as { teamName: string; notes: string; loginUrl: string };
  const html = emailWrapper('APPLICATION INCOMPLETE', `
    ${body(`Team <strong>${teamName}</strong>,`)}
    ${body('Admin has requested changes to your team profile before it can be approved.')}
    ${highlightBox(`<em>"${notes}"</em>`, '#f59e0b')}
    ${body('Please log in to address these issues and resubmit.')}
    ${ctaButton(String(loginUrl), 'UPDATE PROFILE')}`);

  return {
    subject: '[REVENGERSHACK] Intel required.',
    html,
    text: `Team ${teamName},\n\nAdmin requested changes:\n\n"${notes}"\n\nUpdate profile: ${loginUrl}`,
  };
}

function renderReminder(vars: Record<string, string | number>): RenderedEmail {
  const { teamName, hoursLeft, loginUrl } = vars as { teamName: string; hoursLeft: string | number; loginUrl: string };
  const html = emailWrapper('SUBMISSION DEADLINE', `
    ${body(`Team <strong>${teamName}</strong>,`)}
    ${body(`Tick tock. You only have <strong style="color:#fff;">${hoursLeft} hours</strong> remaining to transmit your payload.`)}
    ${ctaButton(String(loginUrl), 'SUBMIT NOW')}`);

  return {
    subject: `[REVENGERSHACK] Tick tock. ${hoursLeft} hours remain.`,
    html,
    text: `Team ${teamName},\n\n${hoursLeft} hours remaining. Submit now: ${loginUrl}`,
  };
}

function renderAdminInvite(vars: Record<string, string | number>): RenderedEmail {
  const { loginUrl, roleName } = vars as { loginUrl: string; roleName?: string };
  const roleLabel = roleName ?? 'Administrator';
  const html = emailWrapper('SYSTEM ADMINISTRATION', `
    ${body('Hello,')}
    ${body(`You have been granted <strong>${roleLabel}</strong> access to the RevengersHack portal.`)}
    ${body('You can now log in using this email address to access the command center.')}
    ${ctaButton(String(loginUrl), 'ACCESS COMMAND CENTER', '#7c3aed')}`);

  return {
    subject: '[REVENGERSHACK] Admin Access Granted',
    html,
    text: `Hello,\n\nYou have been granted ${roleLabel} access.\n\nAccess Command Center: ${loginUrl}`,
  };
}

function renderAnnouncement(vars: Record<string, string | number>): RenderedEmail {
  const { title, message, loginUrl } = vars as { title: string; message: string; loginUrl: string };
  const html = emailWrapper('ANNOUNCEMENT', `
    <h2 style="color:#fff;font-size:18px;margin:0 0 16px;">${title}</h2>
    ${body(message)}
    ${ctaButton(String(loginUrl), 'VIEW PORTAL')}`);

  return {
    subject: `[REVENGERSHACK] ${title}`,
    html,
    text: `${title}\n\n${message}\n\nPortal: ${loginUrl}`,
  };
}

function renderTemplate(template: EmailTemplate, variables: Record<string, string | number>): RenderedEmail {
  switch (template) {
    case 'otp':                return renderOtp(variables);
    case 'leader_invitation':  return renderLeaderInvitation(variables);
    case 'member_invitation':  return renderMemberInvitation(variables);
    case 'verified':           return renderVerified(variables);
    case 'approved':           return renderApproved(variables);
    case 'rejected':           return renderRejected(variables);
    case 'need_changes':       return renderNeedChanges(variables);
    case 'reminder':           return renderReminder(variables);
    case 'admin_invite':       return renderAdminInvite(variables);
    case 'announcement':       return renderAnnouncement(variables);
    default:
      throw new Error(`Unknown email template: ${template as string}`);
  }
}

// ─── Transport Layer ──────────────────────────────────────────────────────────

let _resend: Resend | null = null;
function getResend(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(env.RESEND_API_KEY);
  return _resend;
}

async function sendViaPostmark(
  to: string, subject: string, html: string, text: string
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
    if (!res.ok) return { success: false, messageId: null, error: data.Message ?? 'Postmark error' };
    return { success: true, messageId: data.MessageID ?? null, error: null };
  } catch (err) {
    return { success: false, messageId: null, error: err instanceof Error ? err.message : 'Network error' };
  }
}

async function sendViaResend(
  to: string, subject: string, html: string, text: string
): Promise<{ success: boolean; messageId: string | null; error: string | null }> {
  const resend = getResend();
  if (!resend) return { success: false, messageId: null, error: 'Resend not configured' };

  try {
    const result = await resend.emails.send({
      from: `${env.EMAIL_FROM_NAME} <${env.EMAIL_FROM}>`,
      to,
      subject,
      html,
      text,
    });

    if (result.error) return { success: false, messageId: null, error: result.error.message };
    return { success: true, messageId: result.data?.id ?? null, error: null };
  } catch (err) {
    return { success: false, messageId: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Sends an email directly via the configured provider.
 *
 * ⚠️  This function is called ONLY by the mail-worker.
 * Business logic must use createMailJob() instead.
 */
export async function sendEmailDirect(opts: DirectEmailOptions): Promise<DirectEmailResult> {
  const rendered = renderTemplate(opts.template, opts.variables);

  // 1. Postmark (primary)
  if (env.POSTMARK_SERVER_TOKEN) {
    const result = await sendViaPostmark(opts.to, rendered.subject, rendered.html, rendered.text);
    await logEmailAttempt(opts.to, opts.template, result.success, result.error, result.messageId);
    return { ...result, devMode: false };
  }

  // 2. Resend (fallback)
  if (env.RESEND_API_KEY) {
    const result = await sendViaResend(opts.to, rendered.subject, rendered.html, rendered.text);
    await logEmailAttempt(opts.to, opts.template, result.success, result.error, result.messageId);
    return { ...result, devMode: false };
  }

  // 3. Dev mode — log to console only
  if (process.env.NODE_ENV === 'production') {
    throw new Error('No email provider configured in production. Set POSTMARK_SERVER_TOKEN or RESEND_API_KEY.');
  }

  // eslint-disable-next-line no-console -- intentional: dev-only feedback
  console.log([
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  📧  DEV MODE EMAIL',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `  To:       ${opts.to}`,
    `  Template: ${opts.template}`,
    `  Subject:  ${rendered.subject}`,
    '',
    rendered.text,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
  ].join('\n'));

  return { success: true, messageId: null, error: null, devMode: true };
}

// ─── Logging ──────────────────────────────────────────────────────────────────

async function logEmailAttempt(
  to: string,
  template: string,
  success: boolean,
  error: string | null,
  messageId: string | null | undefined,
): Promise<void> {
  try {
    await getAdminDb().collection('emailLogs').add({
      to,
      template,
      success,
      error,
      messageId: messageId ?? null,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch {
    // eslint-disable-next-line no-console -- log failure is non-fatal
    console.error('[EmailService] Failed to write emailLogs entry');
  }
}

// ─── Legacy Compatibility ─────────────────────────────────────────────────────
// The old sendEmail() function is kept so existing call sites (auth.service, admin.service)
// still compile. They will be migrated to use createMailJob() in subsequent phases.

/** @deprecated Use createMailJob() from mail-queue.service instead. */
export async function sendEmail(opts: {
  to: string;
  template: string;
  variables: Record<string, string | number>;
}): Promise<DirectEmailResult> {
  // eslint-disable-next-line no-console -- migration warning
  console.warn(`[DEPRECATED] sendEmail() called directly for template '${opts.template}'. Migrate to createMailJob().`);
  return sendEmailDirect(opts as DirectEmailOptions);
}
