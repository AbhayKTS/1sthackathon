import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import type { AuthenticatedToken } from '@/lib/api-helpers';

export interface BulkAssignInput {
  teamIds: string[];
  judgeUid?: string;
  mentorUid?: string;
  meetLink: string;
  roundId: string;
  startTime: string;
  slotDurationMinutes: number;
}

export async function bulkAssignSessions(
  token: AuthenticatedToken,
  input: BulkAssignInput,
): Promise<void> {
  const db = getAdminDb();
  
  if (!input.teamIds || input.teamIds.length === 0) {
    throw Errors.validation('No teams provided for assignment.');
  }
  if (!input.judgeUid && !input.mentorUid) {
    throw Errors.validation('Must select at least one Judge or Mentor.');
  }

  // 1. Fetch team names for sorting
  const teamDocs = await Promise.all(
    input.teamIds.map(id => db.collection('teams').doc(id).get())
  );
  
  const teams = teamDocs.map(snap => {
    if (!snap.exists) throw Errors.notFound(`Team ${snap.id} not found.`);
    return { id: snap.id, teamName: snap.data()?.teamName || '' };
  });

  // Sort alphabetically
  teams.sort((a, b) => a.teamName.localeCompare(b.teamName));

  // 2. Resolve host names
  let judgeName: string | null = null;
  if (input.judgeUid) {
    const jSnap = await db.collection('users').doc(input.judgeUid).get();
    if (!jSnap.exists) throw Errors.notFound('Judge not found.');
    judgeName = jSnap.data()?.displayName || 'Unknown Judge';
  }

  let mentorName: string | null = null;
  if (input.mentorUid) {
    const mSnap = await db.collection('users').doc(input.mentorUid).get();
    if (!mSnap.exists) throw Errors.notFound('Mentor not found.');
    mentorName = mSnap.data()?.displayName || 'Unknown Mentor';
  }

  // 3. Compute time boundaries
  const startMs = new Date(input.startTime).getTime();
  if (isNaN(startMs)) throw Errors.validation('Invalid startTime');
  const durationMs = input.slotDurationMinutes * 60 * 1000;
  const totalDurationMs = teams.length * durationMs;
  
  const startTimestamp = Timestamp.fromMillis(startMs);
  const endTimestamp = Timestamp.fromMillis(startMs + totalDurationMs);

  // 4. Conflict checking
  async function checkConflict(uid: string, role: string) {
    const q = db.collection('sessions')
      .where('hostUid', '==', uid)
      .where('scheduledFor', '>=', startTimestamp)
      .where('scheduledFor', '<', endTimestamp);
      
    const snap = await q.get();
    if (!snap.empty) {
      const conflict = snap.docs[0].data();
      const conflictTime = conflict.scheduledFor?.toDate().toLocaleTimeString() || 'unknown time';
      throw Errors.conflict(`Overlap detected: ${role} is already assigned a session at ${conflictTime}.`);
    }
  }

  if (input.judgeUid) await checkConflict(input.judgeUid, 'Judge');
  if (input.mentorUid) await checkConflict(input.mentorUid, 'Mentor');

  // 5. Batch write
  const batch = db.batch();

  teams.forEach((team, index) => {
    const sessionTimeMs = startMs + (index * durationMs);
    const scheduledFor = Timestamp.fromMillis(sessionTimeMs);

    if (input.judgeUid) {
      const docId = `${team.id}_${input.roundId}_judging`;
      const ref = db.collection('sessions').doc(docId);
      batch.set(ref, {
        sessionId: docId,
        teamId: team.id,
        roundId: input.roundId,
        type: 'judging',
        hostName: judgeName,
        hostUid: input.judgeUid,
        meetLink: input.meetLink || null,
        scheduledFor,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: token.uid
      });
    }

    if (input.mentorUid) {
      const docId = `${team.id}_${input.roundId}_mentoring`;
      const ref = db.collection('sessions').doc(docId);
      batch.set(ref, {
        sessionId: docId,
        teamId: team.id,
        roundId: input.roundId,
        type: 'mentoring',
        hostName: mentorName,
        hostUid: input.mentorUid,
        meetLink: input.meetLink || null,
        scheduledFor,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: token.uid
      });
    }
  });

  await batch.commit();

  // 6. Audit Log
  await writeAuditLog({
    action: 'sessions.bulk_assign',
    actorUid: token.uid,
    actorRole: token.role || 'admin',
    targetId: 'bulk',
    targetType: 'sessions',
    metadata: { 
      teamCount: teams.length,
      roundId: input.roundId,
      judgeUid: input.judgeUid,
      mentorUid: input.mentorUid,
      timeRange: { start: input.startTime, durationMinutes: input.slotDurationMinutes }
    },
    ip: null,
  });
}
