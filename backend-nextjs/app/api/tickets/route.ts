/**
 * GET /api/tickets
 * Fetch current user's tickets
 *
 * POST /api/tickets
 * Create a new ticket
 */
import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, withAuth } from '@/lib/api-helpers';
import { createTicket, getUserTickets, type TicketCategory } from '@/server/services/ticket.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    const tickets = await getUserTickets(token.uid);
    const response = apiSuccess(tickets);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';
  try {
    const token = await withAuth(request);
    const body = await request.json();
    
    const { subject, category, message, teamId } = body;

    const ticketId = await createTicket({
      userId: token.uid,
      teamId,
      subject,
      category: category as TicketCategory,
      initialMessage: message
    });

    const response = apiSuccess({ id: ticketId, message: 'Ticket created successfully.' });
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
