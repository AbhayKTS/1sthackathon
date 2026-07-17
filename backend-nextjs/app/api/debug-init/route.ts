/**
 * TEMPORARY DEBUG ROUTE — DELETE AFTER USE
 * GET /api/debug-init
 * Tests Firebase Admin SDK initialization and returns the error if it fails.
 */
import { type NextRequest, NextResponse } from 'next/server';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  const results: Record<string, string> = {};

  // 1. Check env vars presence (not values)
  results.has_FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON
    ? `yes (length=${process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON.length})`
    : 'MISSING';

  // 2. Try JSON parse
  try {
    const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON ?? '';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    results.json_parse = 'OK';
    results.project_id = String(parsed.project_id ?? 'missing');
    results.client_email = String(parsed.client_email ?? 'missing');
    const pk = String(parsed.private_key ?? '');
    results.private_key_length = String(pk.length);
    results.private_key_has_real_newlines = String(pk.includes('\n'));
    results.private_key_has_escaped_newlines = String(pk.includes('\\n'));
    results.private_key_starts = pk.slice(0, 27);
  } catch (e) {
    results.json_parse = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 3. Try Firebase Admin init
  try {
    const { getAdminDb } = await import('@/lib/firebase-admin');
    const db = getAdminDb();
    results.firebase_admin_init = 'OK';
    // Try a simple read
    await db.collection('settings').doc('platform').get();
    results.firestore_read = 'OK';
  } catch (e) {
    results.firebase_admin_init = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(results);
}
