/**
 * Team Service — manages team profile submission and updates.
 *
 * @module server/services/team.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';

// ─── Admin Flags ──────────────────────────────────────────────────────────────

/**
 * Admin-only: set isTimeLeapSelected flag on a team.
 */
export async function setTimeLeapSelected(
  adminUid: string,
  teamId: string,
  value: boolean,
): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (!snap.exists) throw Errors.notFound('Team not found.');

  await teamRef.update({ isTimeLeapSelected: value, updatedAt: FieldValue.serverTimestamp() });

  await writeAuditLog({
    action: 'team.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: teamId,
    targetType: 'teams',
    metadata: { field: 'isTimeLeapSelected', value },
    ip: null,
  });
}

/**
 * Admin-only: set isTop10 / isTop15 flags on a team.
 */
export async function setTopFlags(
  adminUid: string,
  teamId: string,
  flags: { isTop10?: boolean; isTop15?: boolean },
): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const snap = await teamRef.get();
  if (!snap.exists) throw Errors.notFound('Team not found.');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { updatedAt: FieldValue.serverTimestamp() };
  if (flags.isTop10 !== undefined) update.isTop10 = flags.isTop10;
  if (flags.isTop15 !== undefined) update.isTop15 = flags.isTop15;

  await teamRef.update(update);

  await writeAuditLog({
    action: 'team.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: teamId,
    targetType: 'teams',
    metadata: { flags },
    ip: null,
  });
}
