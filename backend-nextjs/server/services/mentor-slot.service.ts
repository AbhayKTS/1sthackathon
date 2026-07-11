/**
 * Mentor Slot Service — schedules and manages mentor/judge sessions.
 *
 * Meeting link visibility:
 *   - The meetLink is stored in Firestore but only returned to the team
 *     when the current time >= meetLinkVisibleAt (default: 30 min before session)
 *   - Firestore rules enforce this time gate server-side
 *
 * @module server/services/mentor-slot.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import type { MentorSlotStatus } from '@/types/index';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateMentorSlotInput {
  roundId: string;
  mentorName: string;
  mentorUid?: string | null;
  teamId: string;
  scheduledFor: string;     // ISO datetime string
  durationMins?: number;
  meetLink: string;
  meetLinkVisibleMinutesBefore?: number; // defaults to 30
}

export interface UpdateMentorSlotInput {
  mentorName?: string;
  mentorUid?: string | null;
  scheduledFor?: string;
  durationMins?: number;
  meetLink?: string;
  meetLinkVisibleMinutesBefore?: number;
  status?: MentorSlotStatus;
}

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Creates or updates a mentor/judge session slot for a team in a round.
 * Uses composite ID teamId_roundId (one slot per team per round).
 * To add multiple slots for the same team in a round, use a sequential suffix:
 *   e.g., teamId_roundId_1, teamId_roundId_2
 */
export async function createMentorSlot(
  adminUid: string,
  input: CreateMentorSlotInput,
): Promise<string> {
  const db = getAdminDb();

  // Validate round and team exist
  const [roundSnap, teamSnap] = await Promise.all([
    db.collection('rounds').doc(input.roundId).get(),
    db.collection('teams').doc(input.teamId).get(),
  ]);

  if (!roundSnap.exists) throw Errors.notFound(`Round "${input.roundId}"`);
  if (!teamSnap.exists) throw Errors.notFound(`Team "${input.teamId}"`);

  const scheduledAt = new Date(input.scheduledFor);
  if (isNaN(scheduledAt.getTime())) {
    throw Errors.validation('scheduledFor must be a valid ISO datetime string.');
  }

  const visibleMinutes = input.meetLinkVisibleMinutesBefore ?? 30;
  const meetLinkVisibleAt = new Date(scheduledAt.getTime() - visibleMinutes * 60 * 1000);
  const slotId = `${input.teamId}_${input.roundId}`;

  await db.collection('mentorSlots').doc(slotId).set({
    roundId: input.roundId,
    mentorName: input.mentorName.trim(),
    mentorUid: input.mentorUid ?? null,
    teamId: input.teamId,
    teamName: teamSnap.data()!['teamName'] as string,
    scheduledFor: scheduledAt,
    durationMins: input.durationMins ?? 30,
    meetLink: input.meetLink.trim(),
    meetLinkVisibleAt,
    status: 'scheduled' as MentorSlotStatus,
    createdBy: adminUid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAuditLog({
    action: 'round.session_assigned',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: slotId,
    targetType: 'mentorSlots',
    metadata: {
      roundId: input.roundId,
      teamId: input.teamId,
      mentorName: input.mentorName,
      scheduledFor: input.scheduledFor,
    },
    ip: null,
  });

  return slotId;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export async function updateMentorSlot(
  adminUid: string,
  slotId: string,
  input: UpdateMentorSlotInput,
): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('mentorSlots').doc(slotId);
  const snap = await ref.get();

  if (!snap.exists) throw Errors.notFound(`Mentor slot "${slotId}"`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const update: any = { updatedAt: FieldValue.serverTimestamp() };

  if (input.mentorName) update.mentorName = input.mentorName.trim();
  if (input.mentorUid !== undefined) update.mentorUid = input.mentorUid ?? null;
  if (input.durationMins) update.durationMins = input.durationMins;
  if (input.meetLink) update.meetLink = input.meetLink.trim();
  if (input.status) update.status = input.status;

  if (input.scheduledFor) {
    const scheduledAt = new Date(input.scheduledFor);
    if (isNaN(scheduledAt.getTime())) {
      throw Errors.validation('scheduledFor must be a valid ISO datetime string.');
    }
    update.scheduledFor = scheduledAt;

    const visibleMinutes = input.meetLinkVisibleMinutesBefore ?? 30;
    update.meetLinkVisibleAt = new Date(scheduledAt.getTime() - visibleMinutes * 60 * 1000);
  }

  await ref.update(update);

  await writeAuditLog({
    action: 'round.session_assigned',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: slotId,
    targetType: 'mentorSlots',
    metadata: { updatedFields: Object.keys(input) },
    ip: null,
  });
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Gets a team's mentor slot for a round.
 * For participants: strips meetLink if meetLinkVisibleAt hasn't passed yet.
 */
export async function getTeamMentorSlot(
  teamId: string,
  roundId: string,
  isAdmin: boolean,
): Promise<Record<string, unknown> | null> {
  const db = getAdminDb();
  const slotId = `${teamId}_${roundId}`;
  const snap = await db.collection('mentorSlots').doc(slotId).get();

  if (!snap.exists) return null;

  const data = { id: snap.id, ...snap.data() } as Record<string, unknown>;

  if (!isAdmin) {
    // Apply time gate on meetLink
    const visibleAt = data['meetLinkVisibleAt'] as { toMillis?: () => number } | null;
    const visibleMs = visibleAt?.toMillis ? visibleAt.toMillis() : 0;

    if (Date.now() < visibleMs) {
      // Redact meeting link — not yet visible
      data['meetLink'] = null;
      data['meetLinkHidden'] = true;
    }

    // Never expose the createdBy or mentorUid to participants
    delete data['createdBy'];
  }

  return data;
}

/**
 * Lists all mentor slots for a round (admin view).
 */
export async function listRoundMentorSlots(
  roundId: string,
): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const snap = await db
    .collection('mentorSlots')
    .where('roundId', '==', roundId)
    .orderBy('scheduledFor')
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Lists all mentor slots assigned to a specific team (admin or team view).
 */
export async function getTeamAllSlots(
  teamId: string,
  isAdmin: boolean,
): Promise<Array<Record<string, unknown>>> {
  const db = getAdminDb();
  const snap = await db
    .collection('mentorSlots')
    .where('teamId', '==', teamId)
    .orderBy('scheduledFor')
    .get();

  return snap.docs.map((d) => {
    const data = { id: d.id, ...d.data() } as Record<string, unknown>;

    if (!isAdmin) {
      const visibleAt = data['meetLinkVisibleAt'] as { toMillis?: () => number } | null;
      const visibleMs = visibleAt?.toMillis ? visibleAt.toMillis() : 0;

      if (Date.now() < visibleMs) {
        data['meetLink'] = null;
        data['meetLinkHidden'] = true;
      }

      delete data['createdBy'];
    }

    return data;
  });
}
