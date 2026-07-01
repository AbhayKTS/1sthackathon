/**
 * GET /api/admin/analytics
 * Returns aggregated system metrics for the command center.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { getAdminAnalytics } from '@/server/services/analytics.service';
import { Errors } from '@/lib/errors';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    if (token.role !== 'admin' && token.role !== 'super_admin') {
      throw Errors.forbidden('Admin access required.');
    }

    const metrics = await getAdminAnalytics();
    
    const response = apiSuccess(metrics);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
