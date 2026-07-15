/**
 * Round Service — manages hackathon round lifecycle.
 *
 * Rounds are configurable Firestore docs (not hardcoded to round-1/2/3).
 * isActive and isLocked are independent flags — closing a round (isActive=false)
 * does NOT hide it from participants; locked rounds show as read-only.
 *
 * @module server/services/round.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RoundType = 'ppt' | 'mentoring_prototype' | 'timeleap' | 'judges_final' | 'general';

export interface RoundData {
  roundId: string;
  title: string;
  description: string;
  type: RoundType;
  startsAt: Date | null;
  endsAt: Date | null;
  submissionDeadline: Date | null;
  googleSheetId?: string | null;
  updatedAt: FirebaseFirestore.FieldValue;
  updatedBy: string;
}

export interface UpdateRoundInput {
  title?: string;
  description?: string;
  type?: RoundType;
  startsAt?: string | null;   // ISO string from client
  endsAt?: string | null;
  submissionDeadline?: string | null;
  googleSheetId?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(val: string | null | undefined): Date | null {
  if (!val) return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Updates round fields. Any subset of fields can be updated.
 */
export async function updateRound(
  adminUid: string,
  roundId: string,
  input: UpdateRoundInput,
): Promise<void> {
  const db = getAdminDb();
  const roundRef = db.collection('rounds').doc(roundId);
  const snap = await roundRef.get();

  if (!snap.exists) {
    throw Errors.notFound(`Round "${roundId}" not found.`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = {
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: adminUid,
  };

  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description;
  if (input.type !== undefined) update.type = input.type;
  if ('startsAt' in input) update.startsAt = parseDate(input.startsAt);
  if ('endsAt' in input) update.endsAt = parseDate(input.endsAt);
  if ('submissionDeadline' in input) update.submissionDeadline = parseDate(input.submissionDeadline);
  if ('googleSheetId' in input) update.googleSheetId = input.googleSheetId || null;

  await roundRef.update(update);

  await writeAuditLog({
    action: 'round.updated',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: roundId,
    targetType: 'rounds',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}

/**
 * Ensures a round document exists with minimal defaults.
 * Used to initialise new rounds without overwriting existing data.
 */
export async function ensureRoundExists(
  adminUid: string,
  roundId: string,
  defaults: Partial<UpdateRoundInput> = {},
): Promise<void> {
  const db = getAdminDb();
  const roundRef = db.collection('rounds').doc(roundId);
  const snap = await roundRef.get();

  if (!snap.exists) {
    await roundRef.set({
      roundId,
      title: defaults.title || roundId,
      description: defaults.description || '',
      type: defaults.type || 'general',
      startsAt: null,
      endsAt: null,
      submissionDeadline: null,
      googleSheetId: null,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: adminUid,
    });
  }
}

/**
 * Lists all rounds ordered by roundId.
 */
export async function listRounds(): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const snap = await db.collection('rounds').orderBy('__name__').get();
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

/**
 * Assigns a mentor/judge session to a team for a specific round.
 */
export async function assignSession(
  adminUid: string,
  input: {
    roundId: string;
    teamId: string;
    meetingLink: string;
    slotStart: string;
    slotEnd: string;
    type: 'mentor' | 'judge';
  },
): Promise<string> {
  const db = getAdminDb();

  // Verify round and team exist
  const roundSnap = await db.collection('rounds').doc(input.roundId).get();
  if (!roundSnap.exists) throw Errors.notFound('Round not found.');

  const teamSnap = await db.collection('teams').doc(input.teamId).get();
  if (!teamSnap.exists) throw Errors.notFound('Team not found.');

  // Upsert: one session per team per round (composite ID)
  const sessionId = `${input.teamId}_${input.roundId}`;
  const sessionRef = db.collection('sessions').doc(sessionId);

  await sessionRef.set({
    roundId: input.roundId,
    teamId: input.teamId,
    meetingLink: input.meetingLink,
    slotStart: new Date(input.slotStart),
    slotEnd: new Date(input.slotEnd),
    type: input.type,
    assignedBy: adminUid,
    assignedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAuditLog({
    action: 'round.session_assigned',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: sessionId,
    targetType: 'sessions',
    metadata: { roundId: input.roundId, teamId: input.teamId, type: input.type },
    ip: null,
  });

  return sessionId;
}
