/**
 * Mail Queue Service — queue-based email system.
 *
 * NEVER call sendEmail() directly from business logic.
 * Always use createMailJob() to queue an email.
 *
 * The queue is processed by POST /api/internal/mail-worker
 * (called by Vercel Cron or manually from the admin panel).
 *
 * States: queued → sending → sent
 *                         ↘ failed / retry
 *
 * @module server/services/mail-queue.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { env } from '@/lib/env';
import { writeAuditLog } from './audit.service';
import type { EmailTemplate, MailPriority, MailStatus } from '@/types/index';

// ─── Create Job ───────────────────────────────────────────────────────────────

export interface CreateMailJobOptions {
  to: string;
  template: EmailTemplate;
  variables: Record<string, string | number>;
  priority?: MailPriority;
  scheduledFor?: Date | null;
  createdBy?: string;
}

/**
 * Enqueues an email job in the mailQueue collection.
 * Does NOT send the email — that is done by the mail worker.
 * Returns the job document ID.
 */
export async function createMailJob(opts: CreateMailJobOptions): Promise<string> {
  const db = getAdminDb();

  const docRef = await db.collection('mailQueue').add({
    to: opts.to.toLowerCase().trim(),
    template: opts.template,
    variables: opts.variables,
    status: 'queued' as MailStatus,
    attempts: 0,
    maxAttempts: env.MAIL_QUEUE_MAX_ATTEMPTS ?? 3,
    lastAttemptAt: null,
    sentAt: null,
    failedAt: null,
    error: null,
    messageId: null,
    priority: opts.priority ?? 'normal',
    createdAt: FieldValue.serverTimestamp(),
    scheduledFor: opts.scheduledFor ? opts.scheduledFor : null,
    createdBy: opts.createdBy ?? 'system',
  });

  return docRef.id;
}

/**
 * Convenience: queue multiple emails in one batch write.
 * Used for bulk member invitations.
 */
export async function createMailJobs(jobs: CreateMailJobOptions[]): Promise<string[]> {
  const db = getAdminDb();
  const maxAttempts = env.MAIL_QUEUE_MAX_ATTEMPTS ?? 3;

  // Chunk into batches of 500 (Firestore batch limit)
  const CHUNK = 450;
  const ids: string[] = [];

  for (let i = 0; i < jobs.length; i += CHUNK) {
    const chunk = jobs.slice(i, i + CHUNK);
    const batch = db.batch();

    for (const opts of chunk) {
      const ref = db.collection('mailQueue').doc();
      ids.push(ref.id);
      batch.set(ref, {
        to: opts.to.toLowerCase().trim(),
        template: opts.template,
        variables: opts.variables,
        status: 'queued' as MailStatus,
        attempts: 0,
        maxAttempts,
        lastAttemptAt: null,
        sentAt: null,
        failedAt: null,
        error: null,
        messageId: null,
        priority: opts.priority ?? 'normal',
        createdAt: FieldValue.serverTimestamp(),
        scheduledFor: opts.scheduledFor ?? null,
        createdBy: opts.createdBy ?? 'system',
      });
    }

    await batch.commit();
  }

  return ids;
}

// ─── Process Queue ─────────────────────────────────────────────────────────────

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  retried: number;
}

/**
 * Processes pending mail queue jobs.
 * Called by POST /api/internal/mail-worker.
 *
 * Picks up to MAIL_QUEUE_BATCH_SIZE jobs with status 'queued' or 'retry'
 * whose scheduledFor is in the past (or null).
 */
export async function processMailQueue(): Promise<ProcessResult> {
  const db = getAdminDb();
  const batchSize = env.MAIL_QUEUE_BATCH_SIZE ?? 20;
  const maxAttempts = env.MAIL_QUEUE_MAX_ATTEMPTS ?? 3;

  const now = new Date();

  // Fetch queued jobs (priority: high first, then normal, then low)
  const snap = await db
    .collection('mailQueue')
    .where('status', 'in', ['queued', 'retry'])
    .orderBy('priority')
    .orderBy('createdAt')
    .limit(batchSize)
    .get();

  const result: ProcessResult = { processed: 0, sent: 0, failed: 0, retried: 0 };

  // Import email provider lazily — avoids circular deps
  const { sendEmailDirect } = await import('./email.service');

  for (const doc of snap.docs) {
    const data = doc.data();

    // Skip jobs scheduled for the future
    if (data.scheduledFor) {
      const scheduledMs =
        data.scheduledFor.toMillis ? data.scheduledFor.toMillis() : new Date(data.scheduledFor).getTime();
      if (scheduledMs > now.getTime()) continue;
    }

    result.processed++;

    // Mark as 'sending'
    await doc.ref.update({
      status: 'sending',
      lastAttemptAt: FieldValue.serverTimestamp(),
    });

    try {
      const emailResult = await sendEmailDirect({
        to: data.to,
        template: data.template,
        variables: data.variables,
      });

      if (emailResult.success) {
        await doc.ref.update({
          status: 'sent',
          sentAt: FieldValue.serverTimestamp(),
          messageId: emailResult.messageId ?? null,
          error: null,
          attempts: FieldValue.increment(1),
        });
        result.sent++;
      } else {
        throw new Error(emailResult.error ?? 'Send failed without error message');
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const currentAttempts = (data.attempts as number) + 1;

      if (currentAttempts >= maxAttempts) {
        // Permanently failed
        await doc.ref.update({
          status: 'failed',
          failedAt: FieldValue.serverTimestamp(),
          error: errorMsg,
          attempts: FieldValue.increment(1),
        });

        await writeAuditLog({
          action: 'mail.job_failed',
          actorUid: 'system',
          actorRole: 'system',
          targetId: doc.id,
          targetType: 'mailQueue',
          metadata: { to: data.to, template: data.template, attempts: currentAttempts, error: errorMsg },
          ip: null,
        });

        result.failed++;
      } else {
        // Exponential backoff: 2^attempt minutes
        const backoffMs = Math.pow(2, currentAttempts) * 60 * 1000;
        const retryAt = new Date(Date.now() + backoffMs);

        await doc.ref.update({
          status: 'retry',
          scheduledFor: retryAt,
          error: errorMsg,
          attempts: FieldValue.increment(1),
        });
        result.retried++;
      }
    }
  }

  return result;
}

// ─── Admin Operations ─────────────────────────────────────────────────────────

/**
 * Manually retries a specific failed mail job.
 * Resets status to 'queued' and clears attempts counter.
 */
export async function retryMailJob(jobId: string, adminUid: string): Promise<void> {
  const db = getAdminDb();
  const ref = db.collection('mailQueue').doc(jobId);
  const snap = await ref.get();

  if (!snap.exists) throw new Error(`Mail job ${jobId} not found.`);

  const data = snap.data()!;
  if (data.status !== 'failed') {
    throw new Error(`Cannot retry job with status '${data.status}'. Only 'failed' jobs can be retried.`);
  }

  await ref.update({
    status: 'queued',
    attempts: 0,
    error: null,
    scheduledFor: null,
  });

  await writeAuditLog({
    action: 'mail.job_created',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: jobId,
    targetType: 'mailQueue',
    metadata: { action: 'manual_retry', to: data.to, template: data.template },
    ip: null,
  });
}

/**
 * Lists mail queue jobs with optional status filter. Paginated.
 */
export async function listMailJobs(opts: {
  status?: MailStatus | MailStatus[];
  limit?: number;
  startAfter?: string;
}): Promise<{ jobs: Array<Record<string, unknown>>; total: number }> {
  const db = getAdminDb();
  const limit = opts.limit ?? 20;

  let query = db.collection('mailQueue').orderBy('createdAt', 'desc');

  if (opts.status) {
    const statusArray = Array.isArray(opts.status) ? opts.status : [opts.status];
    query = query.where('status', 'in', statusArray) as typeof query;
  }

  if (opts.startAfter) {
    const cursorSnap = await db.collection('mailQueue').doc(opts.startAfter).get();
    if (cursorSnap.exists) query = query.startAfter(cursorSnap) as typeof query;
  }

  const snap = await query.limit(limit).get();

  // Count query (no filters for total)
  const countSnap = await db.collection('mailQueue').count().get();

  return {
    jobs: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    total: countSnap.data().count,
  };
}
