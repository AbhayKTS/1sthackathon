/**
 * Support Ticket Service — handles creation and administration of tickets.
 *
 * @module server/services/ticket.service
 */

import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { Errors } from '@/lib/errors';
import { writeAuditLog } from './audit.service';
import { createNotification } from './notification.service';
import { sendEmail } from './email.service';
import { env } from '@/lib/env';

export type TicketCategory = 'Technical' | 'Submission' | 'General';
export type TicketStatus = 'Open' | 'Pending' | 'Resolved';
export type SenderType = 'user' | 'admin';

export interface TicketMessage {
  sender: SenderType;
  senderUid: string;
  senderName?: string;
  content: string;
  timestamp: string; // ISO string
}

export interface TicketInput {
  userId: string;
  teamId?: string;
  subject: string;
  category: TicketCategory;
  initialMessage: string;
}

/**
 * Creates a new support ticket.
 */
export async function createTicket(input: TicketInput): Promise<string> {
  const db = getAdminDb();
  
  if (!input.subject || !input.initialMessage || !input.category) {
    throw Errors.validation("Subject, category, and message are required.");
  }

  const validCategories = ['Technical', 'Submission', 'General'];
  if (!validCategories.includes(input.category)) {
    throw Errors.validation("Invalid category.");
  }

  // Get user details for sender name
  let senderName = 'Hacker';
  try {
      const userSnap = await db.collection('users').doc(input.userId).get();
      if (userSnap.exists) {
          senderName = userSnap.data()?.displayName || userSnap.data()?.email || 'Hacker';
      }
  } catch (e) {}

  const initialMsg: TicketMessage = {
    sender: 'user',
    senderUid: input.userId,
    senderName,
    content: input.initialMessage,
    timestamp: new Date().toISOString()
  };

  const docRef = await db.collection('tickets').add({
    userId: input.userId,
    teamId: input.teamId || null,
    subject: input.subject,
    category: input.category,
    status: 'Open' as TicketStatus,
    messages: [initialMsg],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  });

  // Optionally notify admins in a real system here, but for now we'll just log it.

  return docRef.id;
}

/**
 * Fetches tickets for a specific user.
 */
export async function getUserTickets(userId: string) {
  const db = getAdminDb();
  const snap = await db.collection('tickets')
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .get();

  return snap.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
}

/**
 * Adds an admin reply to an existing ticket and optionally changes its status.
 */
export async function adminReplyTicket(
  adminUid: string, 
  ticketId: string, 
  content: string, 
  newStatus?: TicketStatus
): Promise<void> {
  const db = getAdminDb();
  const ticketRef = db.collection('tickets').doc(ticketId);

  if (!content) {
    throw Errors.validation("Reply content is required.");
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ticketRef);
    if (!snap.exists) {
      throw Errors.notFound("Ticket not found.");
    }

    const ticketData = snap.data()!;
    const statusToSet = newStatus || 'Pending';

    const newMsg: TicketMessage = {
      sender: 'admin',
      senderUid: adminUid,
      senderName: 'Central Command',
      content,
      timestamp: new Date().toISOString()
    };

    tx.update(ticketRef, {
      messages: FieldValue.arrayUnion(newMsg),
      status: statusToSet,
      updatedAt: FieldValue.serverTimestamp()
    });

    // We fetch the user email within the transaction to avoid extra reads if possible, 
    // but tx requires all reads before writes. 
    // Since we just need the notification sent, we can do it after the tx, or inside.
    // It's safer to queue it after.
  });

  // Side-effects (outside tx)
  try {
      const snap = await ticketRef.get();
      const ticketData = snap.data()!;
      
      // In-app notification
      await createNotification({
          userId: ticketData.userId,
          type: 'support_reply',
          title: 'Ticket Updated',
          message: `Admin replied to: ${ticketData.subject}`
      });

      // Email
      const userSnap = await db.collection('users').doc(ticketData.userId).get();
      if (userSnap.exists) {
          const email = userSnap.data()!.email;
          const loginUrl = env.NEXT_PUBLIC_APP_URL ? `${env.NEXT_PUBLIC_APP_URL}/login` : 'https://revengershack.com/login';
          // We don't have a specific "ticket" email template yet in Phase 11. 
          // We can reuse a generic reminder/notification if needed, or just skip email for now
          // as Phase 11 didn't specify a ticket email template. Let's skip email for support to keep scope tight.
      }
  } catch (e) {
      console.error("Failed to process ticket side-effects", e);
  }

  await writeAuditLog({
    action: 'ticket.replied',
    actorUid: adminUid,
    actorRole: 'admin',
    targetId: ticketId,
    targetType: 'tickets',
    metadata: { newStatus },
    ip: null,
  });
}
