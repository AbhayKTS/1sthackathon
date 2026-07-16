/**
 * POST /api/onboarding/complete
 * Leader or member completes their onboarding profile.
 *
 * For leaders (role: participant_leader):
 *   - Creates/updates the Teams doc
 *   - Sets invitedTeams.status to LeaderRegistered
 *   - Queues member invitation emails
 *
 * For members (role: participant_member):
 *   - Updates their slot in Teams.members array
 *   - Auto-locks registration when ALL members are complete
 *
 * @route POST /api/onboarding/complete
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth, requireRole } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { completeLeaderProfile, completeMemberProfile } from '@/server/services/onboarding.service';
import { writeActivityLog } from '@/server/services/activity-log.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    requireRole(token, ['participant_leader', 'participant_member']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload.');
    });

    const { displayName, role: teamRole, phone, college, github, whatsapp, course, gradYear, linkedin, members } = body;

    if (!displayName?.trim()) throw Errors.validation('displayName is required.');
    if (!teamRole?.trim()) throw Errors.validation('role (team role, e.g. "Developer") is required.');
    if (!phone?.trim()) throw Errors.validation('phone is required.');
    if (!college?.trim()) throw Errors.validation('college is required.');
    if (!whatsapp?.trim()) throw Errors.validation('whatsapp number is required.');
    if (!course?.trim()) throw Errors.validation('course/branch is required.');
    if (!gradYear) throw Errors.validation('graduation year is required.');

    const parsedGradYear = Number(gradYear);
    if (isNaN(parsedGradYear)) throw Errors.validation('graduation year must be a valid number.');

    const input: any = {
      displayName: displayName.trim(),
      role: teamRole.trim(),
      phone: phone.trim(),
      college: college.trim(),
      github: github?.trim() ?? null,
      whatsapp: whatsapp.trim(),
      course: course.trim(),
      gradYear: parsedGradYear,
      linkedin: linkedin?.trim() ?? null,
    };

    if (token.role === 'participant_leader') {
      if (!Array.isArray(members) || members.length === 0) {
        throw Errors.validation('members list is required.');
      }
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.name?.trim()) throw Errors.validation(`Member ${i + 1} name is required.`);
        if (!m.email?.trim()) throw Errors.validation(`Member ${i + 1} email is required.`);
        if (!m.phone?.trim()) throw Errors.validation(`Member ${i + 1} phone is required.`);
        if (!m.whatsapp?.trim()) throw Errors.validation(`Member ${i + 1} whatsapp is required.`);
        if (!m.college?.trim()) throw Errors.validation(`Member ${i + 1} college is required.`);
        if (!m.course?.trim()) throw Errors.validation(`Member ${i + 1} course is required.`);
        if (!m.gradYear) throw Errors.validation(`Member ${i + 1} graduation year is required.`);
        const mGradYear = Number(m.gradYear);
        if (isNaN(mGradYear)) throw Errors.validation(`Member ${i + 1} graduation year must be a valid number.`);
        m.gradYear = mGradYear;
      }
      input.members = members;
      await completeLeaderProfile(token.uid, input);
    } else {
      await completeMemberProfile(token.uid, input);
    }

    await writeActivityLog({
      userId: token.uid,
      teamId: null,
      action: 'onboarding.complete',
      metadata: { role: token.role },
      ip: request.headers.get('x-forwarded-for')?.split(',')[0] ?? null,
      userAgent: request.headers.get('user-agent') ?? null,
    });

    const response = apiSuccess({ completed: true });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
