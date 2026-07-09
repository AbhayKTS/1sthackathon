/**
 * Leaderboard Service — manages hackathon scoring.
 *
 * Permissions:
 *   - super_admin: always allowed to write scores
 *   - admin: only if canEditScores === true on their Users doc
 *   - All others: rejected
 *
 * Every score write calls writeAuditLog() with old/new values.
 *
 * @module server/services/leaderboard.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import type { AuthenticatedToken } from '@/lib/api-helpers';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  teamId: string;
  round1Score: number | null;
  round2Score: number | null;
  timeLeapScore: number | null;
  finalScore: number | null;
  rank: number | null;
  isTop10: boolean;
  isTop15: boolean;
  lastEditedBy: string;
  lastEditedAt: FirebaseFirestore.FieldValue;
}

export interface UpsertScoreInput {
  teamId: string;
  round1Score?: number | null;
  round2Score?: number | null;
  timeLeapScore?: number | null;
  finalScore?: number | null;
  rank?: number | null;
  isTop10?: boolean;
  isTop15?: boolean;
}

// ─── Permission check ─────────────────────────────────────────────────────────

/**
 * Checks if a caller is allowed to write leaderboard scores.
 * super_admin: always allowed.
 * admin: only if their Users doc has canEditScores === true.
 */
async function assertCanEditScores(token: AuthenticatedToken): Promise<void> {
  if (token.role === 'super_admin') return;

  if (token.role === 'admin') {
    const db = getAdminDb();
    const userSnap = await db.collection('users').doc(token.uid).get();
    const canEdit = userSnap.data()?.canEditScores === true;
    if (!canEdit) {
      throw Errors.forbidden(
        'You do not have permission to edit scores. Ask a super_admin to grant canEditScores.'
      );
    }
    return;
  }

  throw Errors.forbidden('Only admins can edit leaderboard scores.');
}

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Upserts score fields for a team in the leaderboard collection.
 * Reads old values first for the audit trail.
 */
export async function upsertScore(
  token: AuthenticatedToken,
  input: UpsertScoreInput,
): Promise<void> {
  await assertCanEditScores(token);

  const db = getAdminDb();
  const lbRef = db.collection('leaderboard').doc(input.teamId);

  // Read old values for audit trail
  const oldSnap = await lbRef.get();
  const oldData = oldSnap.exists ? oldSnap.data()! : {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    teamId: input.teamId,
    lastEditedBy: token.uid,
    lastEditedAt: FieldValue.serverTimestamp(),
  };

  const changedFields: Record<string, { old: unknown; new: unknown }> = {};

  const scoreFields: Array<keyof UpsertScoreInput> = [
    'round1Score', 'round2Score', 'timeLeapScore', 'finalScore', 'rank',
  ];
  const boolFields: Array<keyof UpsertScoreInput> = ['isTop10', 'isTop15'];

  for (const field of scoreFields) {
    if (field in input && input[field] !== undefined) {
      const oldVal = oldData[field] ?? null;
      const newVal = input[field] ?? null;
      if (oldVal !== newVal) {
        changedFields[field] = { old: oldVal, new: newVal };
      }
      update[field] = newVal;
    }
  }

  for (const field of boolFields) {
    if (field in input && input[field] !== undefined) {
      const oldVal = oldData[field] ?? false;
      const newVal = input[field];
      if (oldVal !== newVal) {
        changedFields[field] = { old: oldVal, new: newVal };
      }
      update[field] = newVal;
    }
  }

  // Initialize missing fields on first write
  if (!oldSnap.exists) {
    update.round1Score = update.round1Score ?? null;
    update.round2Score = update.round2Score ?? null;
    update.timeLeapScore = update.timeLeapScore ?? null;
    update.finalScore = update.finalScore ?? null;
    update.rank = update.rank ?? null;
    update.isTop10 = update.isTop10 ?? false;
    update.isTop15 = update.isTop15 ?? false;
  }

  await lbRef.set(update, { merge: true });

  // Audit log every score change with old/new values
  await writeAuditLog({
    action: 'leaderboard.score_updated',
    actorUid: token.uid,
    actorRole: token.role,
    targetId: input.teamId,
    targetType: 'leaderboard',
    metadata: { changedFields },
    ip: null,
  });
}

/**
 * Reads the full leaderboard ordered by rank.
 */
export async function getLeaderboard(): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const snap = await db.collection('leaderboard').orderBy('rank').limit(200).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Reads the leaderboard entry for a single team.
 */
export async function getTeamScore(teamId: string): Promise<Record<string, unknown> | null> {
  const db = getAdminDb();
  const snap = await db.collection('leaderboard').doc(teamId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}
