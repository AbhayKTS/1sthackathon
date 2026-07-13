/**
 * DELETE /api/admin/team/[teamId]
 *
 * Secure endpoint for permanently deleting a team, its members' accounts,
 * and the corresponding invitedTeam document if present.
 * Requires admin or super_admin role.
 *
 * @route DELETE /api/admin/team/[teamId]
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';
import { writeAuditLog } from '@/server/services/audit.service';

type Params = { params: Promise<{ teamId: string }> };

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function DELETE(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Authenticate and authorize (admin or super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const { teamId } = await params;
    const db = getAdminDb();
    const auth = getAdminAuth();

    // 2. Fetch the team document to find associated members and invitedTeamId
    const teamRef = db.collection('teams').doc(teamId);
    const teamSnap = await teamRef.get();

    if (!teamSnap.exists) {
      throw Errors.notFound('Team');
    }

    const teamData = teamSnap.data()!;
    const uidsToDelete = new Set<string>();

    if (teamData.leaderId) {
      uidsToDelete.add(teamData.leaderId);
    }

    if (Array.isArray(teamData.members)) {
      for (const m of teamData.members) {
        if (m.uid) {
          uidsToDelete.add(m.uid);
        }
      }
    }

    // 3. Delete associated users from Firebase Authentication
    for (const uid of uidsToDelete) {
      try {
        await auth.deleteUser(uid);
      } catch (err: any) {
        // Log warning but do not halt process if user is not found in Auth
        console.warn(`Failed to delete Firebase Auth user ${uid}:`, err.message || err);
      }
    }

    // 4. Batch delete all associated Firestore documents
    const batch = db.batch();

    // Delete Team Document
    batch.delete(teamRef);

    // Delete Leader User Document
    if (teamData.leaderId) {
      batch.delete(db.collection('users').doc(teamData.leaderId));
    }

    // Delete Member User Documents
    if (Array.isArray(teamData.members)) {
      for (const m of teamData.members) {
        if (m.uid) {
          batch.delete(db.collection('users').doc(m.uid));
        }
      }
    }

    // Delete related InvitedTeam Document if present
    if (teamData.invitedTeamId) {
      batch.delete(db.collection('invitedTeams').doc(teamData.invitedTeamId));
    }

    await batch.commit();

    // 5. Write audit log
    await writeAuditLog({
      action: 'team.deleted',
      actorUid: token.uid,
      actorRole: token.role,
      targetId: teamId,
      targetType: 'teams',
      metadata: { teamName: teamData.teamName || 'Unnamed Team' },
      ip: null,
    }).catch((err) => {
      console.error('Failed to write audit log for team deletion:', err);
    });

    return applyCorsHeaders(apiSuccess({ success: true, message: 'Team and members deleted successfully' }, 200), origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
