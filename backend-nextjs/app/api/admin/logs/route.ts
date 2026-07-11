/**
 * GET /api/admin/logs/audit — list audit logs
 * GET /api/admin/logs/activity — list activity logs
 *
 * @route /api/admin/logs
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { listAuditLogs, listActivityLogs } from '@/server/services/activity-log.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

// GET /api/admin/logs?type=audit|activity
export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const url = new URL(request.url);
    const type = url.searchParams.get('type') ?? 'audit';
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const startAfter = url.searchParams.get('startAfter') ?? undefined;
    const action = url.searchParams.get('action') ?? undefined;
    const actorUid = url.searchParams.get('actorUid') ?? undefined;
    const targetType = url.searchParams.get('targetType') ?? undefined;
    const userId = url.searchParams.get('userId') ?? undefined;
    const teamId = url.searchParams.get('teamId') ?? undefined;

    if (type === 'activity') {
      const result = await listActivityLogs({
        ...(userId && { userId }),
        ...(teamId && { teamId }),
        ...(action && { action }),
        limit,
        ...(startAfter && { startAfter }),
      });
      const response = apiSuccess(result);
      return applyCorsHeaders(response, origin);
    } else {
      const result = await listAuditLogs({
        ...(action && { action }),
        ...(actorUid && { actorUid }),
        ...(targetType && { targetType }),
        limit,
        ...(startAfter && { startAfter }),
      });
      const response = apiSuccess(result);
      return applyCorsHeaders(response, origin);
    }
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
