/**
 * Timeline Scheduler Worker Service
 *
 * Automatically manages active round state transitions and notification
 * broadcasts based on startsAt timelines and submission deadlines.
 *
 * @module server/services/scheduler-worker.service
 */

import { getAdminDb } from '@/lib/firebase-admin';
import { transitionRound } from '@/server/services/round-state.service';
import { createAnnouncement } from '@/server/services/admin.service';

export interface SchedulerResult {
  processed: number;
  activated: number;
  locked: number;
}

export async function runSchedulerWorker(): Promise<SchedulerResult> {
  const db = getAdminDb();
  const now = new Date();

  // Fetch all rounds
  const roundsSnap = await db.collection('rounds').get();
  let activated = 0;
  let locked = 0;

  for (const doc of roundsSnap.docs) {
    const data = doc.data();
    const status = data.status;
    const roundId = doc.id;

    // Auto Round Activation (Published -> Active)
    if (status === 'Published' && data.startsAt) {
      const startsAtDate = data.startsAt.toDate ? data.startsAt.toDate() : new Date(data.startsAt);
      if (now >= startsAtDate) {
        try {
          await transitionRound('system', roundId, 'Active', true);
          activated++;

          await createAnnouncement('system', {
            title: `Round Started: ${data.title}`,
            message: `Attention contestants! ${data.title} has officially commenced. Start submitting your deliverables.`,
            channels: { portal: true, discord: true },
          }).catch((e) => {
            console.error('[scheduler-worker] Broadcast round active failed:', e);
          });
        } catch (e: any) {
          if (e.statusCode === 400 || e.code === 'VALIDATION_ERROR' || e.message?.includes('Cannot transition')) {
            // Concurrency race lost; round was already activated by another worker.
          } else {
            console.error('[scheduler-worker] Transition to Active failed:', e);
          }
        }
      }
    }

    // Auto Round Locking (Active -> Locked)
    if (status === 'Active' && data.submissionDeadline) {
      const deadlineDate = data.submissionDeadline.toDate ? data.submissionDeadline.toDate() : new Date(data.submissionDeadline);
      if (now >= deadlineDate) {
        try {
          await transitionRound('system', roundId, 'Locked', true);
          locked++;

          await createAnnouncement('system', {
            title: `Round Locked: ${data.title}`,
            message: `The submission window for ${data.title} is now locked. Evaluations will begin shortly.`,
            channels: { portal: true, discord: true },
          }).catch((e) => {
            console.error('[scheduler-worker] Broadcast round lock failed:', e);
          });
        } catch (e: any) {
          if (e.statusCode === 400 || e.code === 'VALIDATION_ERROR' || e.message?.includes('Cannot transition')) {
            // Concurrency race lost; round was already locked by another worker.
          } else {
            console.error('[scheduler-worker] Transition to Locked failed:', e);
          }
        }
      }
    }
  }

  return {
    processed: roundsSnap.size,
    activated,
    locked,
  };
}
