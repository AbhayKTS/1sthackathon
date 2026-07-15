/**
 * Evaluation Service — manages hackathon scoring.
 *
 * Permissions:
 *   - super_admin: can enter draft AND publish scores
 *   - admin with canEditScores=true: can enter draft scores only
 *   - All others: no access
 *
 * Score publishing:
 *   - Only super_admin can publish (batch-atomically for a full round)
 *   - Publishing is irreversible for individual entries
 *   - Complete audit trail for every score change (old → new values)
 *
 * @module server/services/evaluation.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import type { AuthenticatedToken } from '@/lib/api-helpers';
import type { EvaluationDoc, EvaluationHistoryEntry } from '@/types/index';

// ─── Permission Check ─────────────────────────────────────────────────────────

async function assertCanEnterScore(token: AuthenticatedToken, teamId: string): Promise<void> {
  const db = getAdminDb();

  if (token.role === 'super_admin') return;

  if (token.role === 'admin') {
    const permSnap = await db.collection('permissions').doc(token.uid).get();
    if (permSnap.data()?.canEditScores === true) return;
    throw Errors.forbidden('You do not have canEditScores permission. Ask a super_admin to grant it.');
  }

  throw Errors.forbidden('Only admins can enter scores.');
}

// ─── Enter Draft Score ────────────────────────────────────────────────────────

export interface UpsertEvaluationInput {
  teamId: string;
  roundId: string;
  draftScore: number;
  feedback?: string;
  judgeUid?: string;
}

/**
 * Enters or updates a draft score for a team in a round.
 * Draft scores are NOT visible to participants.
 * Only super_admin can later publish them.
 */
export async function enterDraftScore(
  token: AuthenticatedToken,
  input: UpsertEvaluationInput,
): Promise<void> {
  await assertCanEnterScore(token, input.teamId);

  if (input.draftScore < 0 || input.draftScore > 100) {
    throw Errors.validation('Score must be between 0 and 100.');
  }

  const db = getAdminDb();
  const evalId = `${input.teamId}_${input.roundId}`;
  const evalRef = db.collection('evaluations').doc(evalId);

  const existingSnap = await evalRef.get();
  const existing = existingSnap.exists ? (existingSnap.data() as EvaluationDoc) : null;

  if (existing?.isPublished) {
    throw Errors.forbidden('This score has already been published and cannot be edited.');
  }

  const historyEntry: Omit<EvaluationHistoryEntry, 'at'> & { at: unknown } = {
    score: input.draftScore,
    by: token.uid,
    at: FieldValue.serverTimestamp(),
    action: existing ? 'edit' : 'draft',
  };

  if (existingSnap.exists) {
    await evalRef.update({
      draftScore: input.draftScore,
      feedback: input.feedback ?? existing?.feedback ?? null,
      judgeUid: input.judgeUid ?? existing?.judgeUid ?? null,
      history: FieldValue.arrayUnion(historyEntry),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: token.uid,
    });
  } else {
    await evalRef.set({
      teamId: input.teamId,
      roundId: input.roundId,
      judgeUid: input.judgeUid ?? null,
      draftScore: input.draftScore,
      publishedScore: null,
      isPublished: false,
      feedback: input.feedback ?? null,
      history: [historyEntry],
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: token.uid,
    });
  }

  await writeAuditLog({
    action: 'evaluation.draft_score_entered',
    actorUid: token.uid,
    actorRole: token.role,
    targetId: evalId,
    targetType: 'evaluations',
    metadata: {
      teamId: input.teamId,
      roundId: input.roundId,
      draftScore: input.draftScore,
      previousDraftScore: existing?.draftScore ?? null,
    },
    ip: null,
  });
}

// ─── Publish Scores ───────────────────────────────────────────────────────────

export interface PublishRoundScoresInput {
  roundId: string;
}

/**
 * Publishes all draft scores for a round.
 * Only super_admin can call this.
 * Atomic: all scores are published in a single batch.
 * Also updates the leaderboard standings subcollection.
 */
export async function publishRoundScores(
  token: AuthenticatedToken,
  input: PublishRoundScoresInput,
): Promise<{ published: number }> {
  if (token.role !== 'super_admin') {
    throw Errors.forbidden('Only super_admin can publish scores.');
  }

  const db = getAdminDb();

  // Load all evaluations for this round
  const evalSnap = await db
    .collection('evaluations')
    .where('roundId', '==', input.roundId)
    .get();

  if (evalSnap.empty) {
    throw Errors.validation(`No evaluations found for round "${input.roundId}".`);
  }

  const unpublished = evalSnap.docs.filter((d) => !d.data().isPublished);
  if (unpublished.length === 0) {
    throw Errors.validation('All scores for this round are already published.');
  }

  // Load team names for leaderboard
  const teamIds = unpublished.map((d) => d.data().teamId as string);
  const teamDocs = await Promise.all(
    teamIds.map((id) => db.collection('teams').doc(id).get())
  );
  const teamNames: Record<string, string> = {};
  teamDocs.forEach((snap) => {
    if (snap.exists) teamNames[snap.id] = snap.data()!['teamName'] as string;
  });

  // Build standings sorted by score descending
  const standings = unpublished
    .map((d) => ({
      id: d.id,
      ref: d.ref,
      teamId: d.data().teamId as string,
      draftScore: (d.data().draftScore as number) ?? 0,
    }))
    .sort((a, b) => b.draftScore - a.draftScore)
    .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

  // Batch publish evaluations + write leaderboard standings
  const BATCH_SIZE = 450;
  for (let i = 0; i < standings.length; i += BATCH_SIZE) {
    const chunk = standings.slice(i, i + BATCH_SIZE);
    const batch = db.batch();

    for (const entry of chunk) {
      // Publish evaluation doc
      batch.update(entry.ref, {
        publishedScore: entry.draftScore,
        isPublished: true,
        history: FieldValue.arrayUnion({
          score: entry.draftScore,
          by: token.uid,
          at: new Date(),
          action: 'publish',
        }),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: token.uid,
      });

      // Write leaderboard standing
      const standingRef = db
        .collection('leaderboard')
        .doc(input.roundId)
        .collection('standings')
        .doc(entry.teamId);

      batch.set(standingRef, {
        teamId: entry.teamId,
        teamName: teamNames[entry.teamId] ?? 'Unknown Team',
        score: entry.draftScore,
        rank: entry.rank,
        isTimeLeapQualified: false,
        isFinalist: false,
      });
    }

    // Update/create the leaderboard round doc
    const lbRoundRef = db.collection('leaderboard').doc(input.roundId);
    batch.set(lbRoundRef, {
      roundId: input.roundId,
      isPublished: true,
      publishedAt: FieldValue.serverTimestamp(),
      publishedBy: token.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await batch.commit();
  }

  await writeAuditLog({
    action: 'evaluation.score_published',
    actorUid: token.uid,
    actorRole: token.role,
    targetId: input.roundId,
    targetType: 'evaluations',
    metadata: { roundId: input.roundId, publishedCount: standings.length },
    ip: null,
  });

  await writeAuditLog({
    action: 'leaderboard.published',
    actorUid: token.uid,
    actorRole: token.role,
    targetId: input.roundId,
    targetType: 'leaderboard',
    metadata: { roundId: input.roundId, standingsCount: standings.length },
    ip: null,
  });

  return { published: standings.length };
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Lists all evaluations for a round. Admin only.
 * Returns draft scores (which are not visible to participants).
 */
export async function listEvaluations(
  roundId: string,
): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const snap = await db.collection('evaluations').where('roundId', '==', roundId).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Gets the published leaderboard for a round.
 * Returns empty if scores are not yet published.
 */
export async function getPublishedLeaderboard(
  roundId: string,
): Promise<{ isPublished: boolean; standings: Array<Record<string, unknown>> }> {
  const db = getAdminDb();

  const lbRoundSnap = await db.collection('leaderboard').doc(roundId).get();
  if (!lbRoundSnap.exists || !lbRoundSnap.data()?.isPublished) {
    return { isPublished: false, standings: [] };
  }

  const standingsSnap = await db
    .collection('leaderboard')
    .doc(roundId)
    .collection('standings')
    .orderBy('rank')
    .get();

  return {
    isPublished: true,
    standings: standingsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}
