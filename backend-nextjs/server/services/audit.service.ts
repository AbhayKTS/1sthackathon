/**
 * Audit Service — server-side only.
 *
 * Every admin mutation and privileged action writes an AuditLog entry.
 * Call writeAuditLog() as the final step inside every API route that mutates data.
 *
 * AuditLogs are append-only — never updated or deleted.
 * Collection name: `auditLogs` (lowercase, consistent with all other collections).
 *
 * @module server/services/audit.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import type { AuditAction } from '@/types/index';

// Re-export so existing callers that import AuditAction from here still work
export type { AuditAction };

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
 *
 * Collection: `auditLogs` (canonical name as of 2026-07-11)
 * Old name `AuditLogs` is still readable via the old security rules.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  try {
    await getAdminDb()
      .collection('auditLogs')
      .add({
        ...entry,
        at: FieldValue.serverTimestamp(),
      });
  } catch {
    // Audit log write failure must not block the primary operation.
    // eslint-disable-next-line no-console -- intentional: audit failure is operational
    console.error('[AuditService] Failed to write audit log:', entry.action);
  }
}
