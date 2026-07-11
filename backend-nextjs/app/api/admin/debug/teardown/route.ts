import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, requireRole, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    // WARNING: THIS ROUTE IS DANGEROUS and should never run in production.
    // We strictly enforce this to prevent accidental production wipes.
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Teardown API is explicitly disabled in production for safety.');
    }

    const db = getAdminDb();
    
    // Clear all simulation-relevant collections
    const collectionsToClear = [
      'invitedTeams', 'teams', 'users', 'rounds', 'mentorSlots', 
      'evaluations', 'submissions', 'mailQueue', 'googleSheets', 
      'announcements', 'leaderboard', 'tickets'
    ];

    for (const colName of collectionsToClear) {
      const snap = await db.collection(colName).get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      // Chunk batches if they exceed 500 in real scenarios, but for simulation max 400 teams
      // it might exceed 500. Let's do chunked deletion.
      let i = 0;
      let deleteBatch = db.batch();
      for (const doc of snap.docs) {
        deleteBatch.delete(doc.ref);
        i++;
        if (i % 450 === 0) {
          await deleteBatch.commit();
          deleteBatch = db.batch();
        }
      }
      if (i % 450 !== 0) {
        await deleteBatch.commit();
      }
    }

    return applyCorsHeaders(apiSuccess({ message: 'Teardown complete.' }), origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
