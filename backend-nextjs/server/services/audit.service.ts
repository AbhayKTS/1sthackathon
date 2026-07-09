/**
 * Audit Service — server-side only.
 *
 * Every admin mutation and privileged action writes an AuditLog entry.
 * Call writeAuditLog() as the final step inside every API route that mutates data.
 *
 * AuditLogs are append-only — never updated or deleted.
 *
 * @module server/services/audit.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export type AuditAction =
  | 'auth.otp_requested'
  | 'auth.otp_verified'
  | 'auth.user_created'
  | 'team.invitation_imported'
  | 'team.invitation_email_sent'
  | 'team.profile_submitted'
  | 'team.approved'
  | 'team.rejected'
  | 'team.need_changes'
  | 'team.updated'
  | 'team.member_removed'
  | 'team.member_added'
  | 'round.activated'
  | 'round.deactivated'
  | 'announcement.created'
  | 'announcement.updated'
  | 'announcement.deleted'
  | 'submission.submitted'
  | 'submission.locked'
  | 'ticket.created'
  | 'ticket.replied'
  | 'ticket.responded'
  | 'ticket.closed'
  | 'admin.created'
  | 'admin.role_changed'
  | 'admin.score_permission_changed'
  | 'leaderboard.score_updated';

export interface AuditLogEntry {
  action: AuditAction;
  actorUid: string;
  actorRole: string;
  targetId: string | null;
  targetType: string | null;
  /** Sanitized metadata — no passwords, no full PII */
  metadata: Record<string, unknown>;
  /** Hashed/truncated IP for privacy. Pass req IP from API route. */
  ip: string | null;
}

/**
 * Writes an audit log entry to Firestore.
 * Non-blocking — errors are swallowed to prevent audit failures from
 * blocking the primary operation, but are logged server-side.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await getAdminDb()
      .collection('AuditLogs')
      .add({
        ...entry,
        at: FieldValue.serverTimestamp(),
      });
  } catch {
    // Audit log write failure must not block the primary operation.
    // In production, this should be sent to a monitoring service (e.g., Sentry).
    // eslint-disable-next-line no-console -- intentional: audit failure is operational
    console.error('[AuditService] Failed to write audit log:', entry.action);
  }
}
