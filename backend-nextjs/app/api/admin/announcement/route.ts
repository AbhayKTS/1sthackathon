/**
 * POST /api/admin/announcement
 *
 * Endpoint for an admin to create an announcement.
 *
 * Expected payload:
 * {
 *   title: string,
 *   message: string
 * }
 *
 * @route POST /api/admin/announcement
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import { createAnnouncement } from '@/server/services/admin.service';
import { z } from 'zod';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

const announcementSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  message: z.string().min(1, 'Message is required'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const body = await request.json().catch(() => {
      throw Errors.validation('Invalid JSON payload');
    });

    const parsed = announcementSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation(parsed.error.issues[0]?.message || 'Validation failed');
    }

    const { title, message } = parsed.data;

    await createAnnouncement(token.uid, title, message);

    const response = apiSuccess(
      { message: `Announcement broadcasted` },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
