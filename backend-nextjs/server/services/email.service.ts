/**
 * Email Service — server-side only.
 *
 * Wraps the Resend email provider. Provider-agnostic interface — swap to Brevo
 * by implementing the same sendEmail() signature with a different SDK.
 *
 * Called ONLY from API routes or Server Actions. Never from client components.
 *
 * All sent emails are logged to the EmailLogs Firestore collection (Phase 11).
 *
 * @module server/services/email.service
 */

// NOTE: Implementation is added in Phase 11.
// This file exists as the migration-seam scaffold required by Phase 0.

/** Email template identifiers — expand as new templates are added */
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
  /** Template-specific variables */
  variables: Record<string, string | number>;
}

export interface SendEmailResult {
  success: boolean;
  messageId: string | null;
  error: string | null;
}

/**
 * Sends a templated email.
 * Logs result to EmailLogs collection regardless of success/failure.
 *
 * @throws AppError('EMAIL_FAILED') if sending fails after retries
 */
export async function sendEmail(_options: SendEmailOptions): Promise<SendEmailResult> {
  // TODO: Phase 11 — implement with Resend SDK
  throw new Error('sendEmail() not yet implemented. This will be built in Phase 11.');
}
