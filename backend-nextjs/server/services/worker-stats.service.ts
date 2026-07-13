/**
 * Worker Stats Service
 *
 * Manages tracking of worker execution states, statuses, and performance
 * metrics in the settings collection.
 *
 * @module server/services/worker-stats.service
 */

import { getAdminDb } from '@/lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

export interface WorkerState {
  status: 'IDLE' | 'PROCESSING' | 'PAUSED';
  lastRun: any;
  processed: number;
  failed: number;
  lastError: string | null;
}

/**
 * Retrieves the tracking stats for a specific worker.
 */
export async function getWorkerStats(workerId: string): Promise<WorkerState> {
  const db = getAdminDb();
  const snap = await db.collection('settings').doc(`worker-${workerId}`).get();
  if (snap.exists) {
    const data = snap.data()!;
    return {
      status: data.status || 'IDLE',
      lastRun: data.lastRun || null,
      processed: typeof data.processed === 'number' ? data.processed : 0,
      failed: typeof data.failed === 'number' ? data.failed : 0,
      lastError: data.lastError || null,
    };
  }
  return {
    status: 'IDLE',
    lastRun: null,
    processed: 0,
    failed: 0,
    lastError: null,
  };
}

/**
 * Sets a worker's status to PROCESSING and registers the start timestamp.
 */
export async function setWorkerStatus(workerId: string, status: 'IDLE' | 'PROCESSING' | 'PAUSED'): Promise<void> {
  const db = getAdminDb();
  await db.collection('settings').doc(`worker-${workerId}`).set({
    status,
    lastRun: FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Sets the final results of a worker's execution run.
 */
export async function setWorkerResult(
  workerId: string,
  processed: number,
  failed: number,
  lastError: string | null = null
): Promise<void> {
  const db = getAdminDb();
  await db.collection('settings').doc(`worker-${workerId}`).set({
    status: 'IDLE',
    processed,
    failed,
    lastError,
    lastRun: FieldValue.serverTimestamp(),
  }, { merge: true });
}
