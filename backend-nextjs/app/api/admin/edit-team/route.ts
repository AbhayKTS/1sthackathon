/**
 * PATCH /api/admin/edit-team
 *
 * Secure endpoint for modifying team details.
 * Requires `super_admin` or `admin` role (with canManageTeams permission).
 *
 * @route PATCH /api/admin/edit-team
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { getAdminDb } from '@/lib/firebase-admin';
import { writeAuditLog } from '@/server/services/audit.service';
import { createNotification } from '@/server/services/notification.service';
import { createMailJob } from '@/server/services/mail-queue.service';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { getPortalBaseUrl } from '@/lib/env';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const schema = z.object({
  teamId: z.string().min(1, 'Team ID is required'),
  teamName: z.string().optional(),
  college: z.string().optional(),
  status: z.enum(['Draft', 'Verified', 'Submitted', 'Approved', 'Rejected', 'Incomplete', 'NeedChanges']).optional(),
  notes: z.string().optional(),
});

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Auth & Role check
    const token = await withAuth(request);
    requireRole(token, ['super_admin', 'admin']);

    const db = getAdminDb();

    // 1b. If regular admin, check canManageTeams
    if (token.role === 'admin') {
      const permSnap = await db.collection('permissions').doc(token.uid).get();
      if (!permSnap.exists || permSnap.data()?.canManageTeams !== true) {
        throw Errors.forbidden('You do not have permission to manage teams.');
      }
    }

    // 2. Parse JSON
    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { teamId, teamName, college, status, notes } = parsed.data;

    if (!teamName && !college && !status) {
      throw Errors.validation('No fields provided to update');
    }

    const teamRef = db.collection('teams').doc(teamId);

    // Fetch old team data
    const oldSnap = await teamRef.get();
    if (!oldSnap.exists) {
      throw Errors.validation('Team not found');
    }
    const oldTeamData = oldSnap.data()!;
    const oldStatus = oldTeamData.status;

    // 3. Update team document
    const updateData: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp()
    };

    if (teamName !== undefined) updateData.teamName = teamName;
    if (college !== undefined) updateData.college = college;
    if (status !== undefined) updateData.status = status;

    if (status === 'NeedChanges' || status === 'Incomplete' || status === 'Rejected') {
       if (notes) {
          updateData.adminNotes = notes;
       }
       if ((status === 'NeedChanges' || status === 'Incomplete') && notes) {
         updateData.needChangesHistory = FieldValue.arrayUnion({
           note: notes,
           at: new Date(),
           byAdminUid: token.uid,
         });
       }
    }

    if (status === 'Approved') {
       updateData.verifiedAt = FieldValue.serverTimestamp();
    }

    await teamRef.update(updateData);

    // 4. Update invitedTeam status if it exists
    if (status && oldTeamData.invitedTeamId) {
       const inviteRef = db.collection('invitedTeams').doc(oldTeamData.invitedTeamId);
       let inviteStatus = null;
       if (status === 'Approved') inviteStatus = 'Approved';
       else if (status === 'Rejected') inviteStatus = 'Rejected';
       else if (status === 'NeedChanges' || status === 'Incomplete') inviteStatus = 'Incomplete';
       
       if (inviteStatus) {
         await inviteRef.update({ status: inviteStatus, updatedAt: FieldValue.serverTimestamp() }).catch(() => {});
       }
    }

    // 5. Notifications
    if (status && status !== oldStatus && (status === 'Approved' || status === 'Rejected' || status === 'NeedChanges' || status === 'Incomplete')) {
      const memberEmails = (oldTeamData.memberEmails || []) as string[];
      if (oldTeamData.leaderEmail && !memberEmails.includes(oldTeamData.leaderEmail)) {
        memberEmails.push(oldTeamData.leaderEmail);
      }
      const tName = updateData.teamName || oldTeamData.teamName || 'Unknown Team';
      const loginUrl = `${getPortalBaseUrl()}/login`;

      if (status === 'Approved') {
        const title = 'Clearance Granted';
        const msg = 'Your team has been verified. The dashboard is now fully unlocked.';
        if (oldTeamData.leaderId) {
          await createNotification({ userId: oldTeamData.leaderId, type: 'team_approved', title, message: msg }).catch(() => {});
        }
        for (const email of memberEmails) {
           await createMailJob({ to: email, template: 'approved', variables: { teamName: tName, loginUrl }, createdBy: token.uid }).catch(() => {});
        }
      } else if (status === 'NeedChanges' || status === 'Incomplete') {
        const title = 'Intel Required';
        const msg = 'Admin has requested changes to your profile.';
        if (oldTeamData.leaderId) {
          await createNotification({ userId: oldTeamData.leaderId, type: 'team_need_changes', title, message: msg }).catch(() => {});
        }
        for (const email of memberEmails) {
           await createMailJob({ to: email, template: 'need_changes', variables: { teamName: tName, notes: notes ?? 'Please check dashboard.', loginUrl }, createdBy: token.uid }).catch(() => {});
        }
      } else if (status === 'Rejected') {
        if (oldTeamData.leaderId) {
           await createNotification({ userId: oldTeamData.leaderId, type: 'team_rejected', title: 'Application Rejected', message: 'Your application has been rejected.' }).catch(() => {});
        }
      }
    }

    // 6. Write audit log
    await writeAuditLog({
      action: status === 'Approved' ? 'team.verified' : 'team.updated',
      actorUid: token.uid,
      actorRole: token.role,
      targetId: teamId,
      targetType: 'teams',
      metadata: { updateData },
      ip: null,
    }).catch(() => {});

    return applyCorsHeaders(apiSuccess({ message: 'Team updated successfully' }, 200), origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
