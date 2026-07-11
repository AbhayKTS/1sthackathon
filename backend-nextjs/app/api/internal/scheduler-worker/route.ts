/**
 * POST /api/internal/scheduler-worker — System-level timeline automation cron.
 *
 * Runs automatically (via Vercel Cron or script) to transition rounds based on start dates
 * and deadlines, and publishes notifications/announcements dynamically.
 *
 * @route POST /api/internal/scheduler-worker
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';
import { transitionRound } from '@/server/services/round-state.service';
import { createAnnouncement } from '@/server/services/admin.service';
import { env } from '@/lib/env';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  // Simple token/secret validation
  const authHeader = request.headers.get('Authorization');
  if (env.CRON_SECRET && authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return applyCorsHeaders(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }), origin);
  }

  try {
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
            // Bypass auth by setting system/super_admin permissions
            await transitionRound('system', roundId, 'Active', true);
            activated++;
            
            // Broadcast announcement (Portal and Discord channels)
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
            
            // Broadcast announcement (Portal and Discord channels)
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

    const response = apiSuccess({
      processed: roundsSnap.size,
      activated,
      locked,
    });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
