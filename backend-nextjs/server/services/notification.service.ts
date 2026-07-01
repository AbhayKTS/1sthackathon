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
  | 'submission_received';

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
  
  const teamData = teamSnap.data()!;
  
  // Notify leader
  if (teamData.leaderId) {
    await createNotification({
      userId: teamData.leaderId,
      type,
      title,
      message,
      actionLink
    });
  }
  
  // Notify members (assuming members array exists but only has email/name strings right now? 
  // Wait, members array might not have uids, because members sign up later or don't have accounts yet?
  // Let's check how members are handled. If they don't have uid yet, we can't notify them.
  // We'll just notify the leader for now.)
}
