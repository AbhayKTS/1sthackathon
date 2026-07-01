/**
 * PATCH /api/notifications/[id]
 *
 * Endpoint to mark a notification as read.
 *
 * @route PATCH /api/notifications/[id]
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    const { id } = await params;

    if (!id) {
      throw Errors.validation('Notification ID is required');
    }

    const db = getAdminDb();
    const notifRef = db.collection('notifications').doc(id);
    const notifSnap = await notifRef.get();

    if (!notifSnap.exists) {
      throw Errors.notFound('Notification not found');
    }

    const notifData = notifSnap.data()!;
    if (notifData.userId !== token.uid) {
      throw Errors.unauthorized('You do not own this notification');
    }

    await notifRef.update({
      isRead: true
    });

    const response = apiSuccess({ message: 'Notification marked as read' });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
