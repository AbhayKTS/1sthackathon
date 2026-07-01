/**
 * POST /api/admin/tickets/[id]/reply
 * Admin replies to a ticket.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { adminReplyTicket, type TicketStatus } from '@/server/services/ticket.service';
import { Errors } from '@/lib/errors';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    const token = await withAuth(request);
    if (token.role !== 'admin' && token.role !== 'super_admin') {
      throw Errors.forbidden('Admin access required.');
    }

    const { id } = await params;
    const body = await request.json();
    const { content, status } = body;

    if (!id) throw Errors.validation('Ticket ID is required');

    await adminReplyTicket(
      token.uid,
      id,
      content,
      status as TicketStatus | undefined
    );

    const response = apiSuccess({ message: 'Reply added successfully.' });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
