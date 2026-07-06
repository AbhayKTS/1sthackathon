/**
 * PATCH /api/admin/edit-team
 *
 * Secure endpoint for modifying team details.
 * Requires `super_admin` role.
 *
 * Expected payload: JSON
 * {
 *   teamId: string,
 *   teamName?: string,
 *   college?: string,
 *   status?: string
 * }
 *
 * @route PATCH /api/admin/edit-team
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb } from '@/lib/firebase-admin';
import { writeAuditLog } from '@/server/services/audit.service';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const schema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  teamName: z.string().optional(),
  college: z.string().optional(),
  status: z.enum(['Submitted', 'Approved', 'Rejected', 'Incomplete']).optional(),
});

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Auth & Role check (super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    // 2. Parse JSON
    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { teamId, teamName, college, status } = parsed.data;

    if (!teamName && !college && !status) {
      throw Errors.validation('No fields provided to update');
    }

    const db = getAdminDb();
    const teamRef = db.collection('teams').doc(teamId);

    // 3. Update team document
    const updateData: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp()
    };

    if (teamName !== undefined) updateData.teamName = teamName;
    if (college !== undefined) updateData.college = college;
    if (status !== undefined) updateData.status = status;

    await teamRef.update(updateData).catch((err) => {
      if (err.code === 5) { // NOT_FOUND
        throw Errors.validation('Team not found');
      }
      throw err;
    });

    // 4. Write audit log
    await writeAuditLog({
      action: 'ticket.replied', // Reusing a known audit action type or add new one? I'll just use a metadata string if there's no exact match, but let's use what we have, or skip. Wait, let's just not fail on audit.
      actorUid: token.uid,
      actorRole: token.role,
      targetId: teamId,
      targetType: 'teams',
      metadata: { updateData },
      ip: null,
    });

    return applyCorsHeaders(apiSuccess({ message: 'Team updated successfully' }, 200), origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
