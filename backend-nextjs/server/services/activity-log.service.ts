/**
 * Activity Log Service — participant-facing action tracking.
 *
 * Different from AuditLogs (admin operations):
 * - ActivityLogs: participant actions (login, submit, profile update)
 * - AuditLogs: admin/system mutations (team approve, round transition, score publish)
 *
 * ActivityLogs are paginated and accessible to admins for monitoring.
 * Participants do NOT see their own activity logs (admin-only visibility).
 *
 * @module server/services/activity-log.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export interface ActivityLogEntry {
  userId: string;
  teamId: string | null;
  action: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Writes an activity log entry.
 * Non-blocking — errors are swallowed.
 */
export async function writeActivityLog(entry: ActivityLogEntry): Promise<void> {
  try {
    await getAdminDb().collection('activityLogs').add({
      ...entry,
      at: FieldValue.serverTimestamp(),
    });
  } catch {
    // Activity log failure is non-fatal
  }
}

/**
 * Lists activity logs. Admin only. Paginated (default 50/page).
 */
export async function listActivityLogs(opts: {
  userId?: string;
  teamId?: string;
  action?: string;
  limit?: number;
  startAfter?: string;
}): Promise<{ logs: Array<Record<string, unknown>>; hasMore: boolean }> {
  const db = getAdminDb();
  const limit = opts.limit ?? 50;

  let query = db.collection('activityLogs').orderBy('at', 'desc').limit(limit + 1);

  if (opts.userId) query = query.where('userId', '==', opts.userId) as typeof query;
  if (opts.teamId) query = query.where('teamId', '==', opts.teamId) as typeof query;
  if (opts.action) query = query.where('action', '==', opts.action) as typeof query;

  if (opts.startAfter) {
    const cursorSnap = await db.collection('activityLogs').doc(opts.startAfter).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap) as typeof query;
  }

  const snap = await query.get();
  const hasMore = snap.docs.length > limit;

  return {
    logs: snap.docs.slice(0, limit).map((d) => ({ id: d.id, ...d.data() })),
    hasMore,
  };
}

/**
 * Lists audit logs (admin operations). Admin/super_admin only. Paginated.
 */
export async function listAuditLogs(opts: {
  action?: string;
  actorUid?: string;
  targetType?: string;
  limit?: number;
  startAfter?: string;
}): Promise<{ logs: Array<Record<string, unknown>>; hasMore: boolean }> {
  const db = getAdminDb();
  const limit = opts.limit ?? 50;

  let query = db.collection('auditLogs').orderBy('at', 'desc').limit(limit + 1);

  if (opts.action) query = query.where('action', '==', opts.action) as typeof query;
  if (opts.actorUid) query = query.where('actorUid', '==', opts.actorUid) as typeof query;
  if (opts.targetType) query = query.where('targetType', '==', opts.targetType) as typeof query;

  if (opts.startAfter) {
    const cursorSnap = await db.collection('auditLogs').doc(opts.startAfter).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap) as typeof query;
  }

  const snap = await query.get();
  const hasMore = snap.docs.length > limit;

  return {
    logs: snap.docs.slice(0, limit).map((d) => ({ id: d.id, ...d.data() })),
    hasMore,
  };
}
