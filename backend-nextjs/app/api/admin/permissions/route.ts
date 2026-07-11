/**
 * GET   /api/admin/permissions — list all users with permissions
 * POST  /api/admin/permissions — create new admin/staff user
 * PATCH /api/admin/permissions/[userId] — update user permissions
 *
 * @route /api/admin/permissions
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { listAllPermissions, updatePermissions, createAdminUser } from '@/server/services/permissions.service';
import type { UserRole } from '@/types/index';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const url = new URL(request.url);
    const role = url.searchParams.get('role') as UserRole | null ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const startAfter = url.searchParams.get('startAfter') ?? undefined;

    const result = await listAllPermissions({
      ...(role !== undefined && { role }),
      limit,
      ...(startAfter !== undefined && { startAfter }),
    });
    const response = apiSuccess(result);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    if (!body.email) throw Errors.validation('email is required.');
    if (!body.role) throw Errors.validation('role is required.');
    if (!body.displayName) throw Errors.validation('displayName is required.');

    await createAdminUser(token.uid, {
      email: body.email,
      role: body.role as UserRole,
      displayName: body.displayName,
    });

    const response = apiSuccess({ created: true }, 201);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
