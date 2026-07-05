/**
 * Notification Service — handles in-app notifications
 *
 * @module server/services/notification.service
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';

export type NotificationType = 
  | 'system_alert' 
  | 'team_approved' 
  | 'team_rejected' 
  | 'team_need_changes' 
  | 'submission_received'
  | 'support_reply';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  actionLink?: string | undefined;
}

/**
 * Creates an in-app notification for a specific user.
 * 
 * @param input The notification payload
 */
export async function createNotification(input: CreateNotificationInput): Promise<string> {
  const db = getAdminDb();
  const notifRef = db.collection('notifications').doc();
  
  await notifRef.set({
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    actionLink: input.actionLink || null,
    isRead: false,
    createdAt: FieldValue.serverTimestamp()
  });

  return notifRef.id;
}

/**
 * Creates in-app notifications for an entire team.
 * 
 * @param teamId The team document ID
 * @param type The notification type
 * @param title The notification title
 * @param message The notification message
 * @param actionLink Optional link for the notification
 */
export async function createTeamNotification(
  teamId: string, 
  type: NotificationType, 
  title: string, 
  message: string, 
  actionLink?: string
): Promise<void> {
  const db = getAdminDb();
  const teamRef = db.collection('teams').doc(teamId);
  const teamSnap = await teamRef.get();

  if (!teamSnap.exists) return;

  // Query all users linked to this team — catches both leader and members who have logged in
  const usersSnap = await db.collection('users').where('teamId', '==', teamId).get();

  await Promise.all(
    usersSnap.docs.map((userDoc) =>
      createNotification({
        userId: userDoc.id,
        type,
        title,
        message,
        actionLink,
      })
    )
  );
}
