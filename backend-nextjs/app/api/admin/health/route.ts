/**
 * GET /api/admin/health — Platform operation and health metrics.
 *
 * @route /api/admin/health
 * @auth  Admin or SuperAdmin
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';
import { env } from '@/lib/env';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const db = getAdminDb();

    // 1. Firestore latency check
    const start = Date.now();
    const pingRef = db.collection('settings').doc('health_ping');
    await pingRef.set({ ping: true, timestamp: new Date() });
    const snap = await pingRef.get();
    const firestoreLatency = Date.now() - start;
    const firestoreStatus = snap.exists ? 'healthy' : 'unhealthy';

    // 2. Queue Metrics - Mail Queue
    const mailSnap = await db.collection('mailQueue').select('status').get();
    const mailStats = {
      queued: 0,
      sending: 0,
      sent: 0,
      failed: 0,
      retry: 0,
    };
    mailSnap.docs.forEach((doc) => {
      const status = doc.data()['status'] as keyof typeof mailStats;
      if (status in mailStats) {
        mailStats[status]++;
      }
    });

    // 3. Queue Metrics - Google Sheets
    const sheetsSnap = await db.collection('googleSheets').select('status').get();
    const sheetsStats = {
      pending: 0,
      syncing: 0,
      synced: 0,
      failed: 0,
      retry: 0,
    };
    sheetsSnap.docs.forEach((doc) => {
      const status = doc.data()['status'] as keyof typeof sheetsStats;
      if (status in sheetsStats) {
        sheetsStats[status]++;
      }
    });

    // 4. Active Users (last 15 minutes)
    const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
    const usersSnap = await db
      .collection('users')
      .where('lastLoginAt', '>=', fifteenMinsAgo)
      .select('uid')
      .get();
    const activeUsers = usersSnap.size;

    // 5. Integrations Environment verification
    const integrations = {
      emailService: env.RESEND_API_KEY ? 'configured' : 'missing',
      discordWebhook: env.DISCORD_WEBHOOK_URL ? 'configured' : 'missing',
      whatsApp: env.WHATSAPP_API_TOKEN ? 'configured' : 'missing',
    };

    const response = apiSuccess({
      status: 'healthy',
      firestore: {
        status: firestoreStatus,
        latencyMs: firestoreLatency,
      },
      queues: {
        mail: mailStats,
        sheets: sheetsStats,
      },
      activeUsers,
      integrations,
      timestamp: new Date().toISOString(),
    });

    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
