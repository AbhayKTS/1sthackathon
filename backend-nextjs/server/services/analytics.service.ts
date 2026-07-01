/**
 * Analytics Service — aggregates system metrics for admin overview
 *
 * @module server/services/analytics.service
 */

import { getAdminDb } from '@/lib/firebase-admin';

export interface AdminAnalytics {
  totalInvited: number;
  totalUsers: number;
  totalTeamsSubmitted: number;
  totalTeamsApproved: number;
  totalTickets: number;
}

/**
 * Fetches high-level metrics for the admin command center.
 * In a real production system with thousands of documents, 
 * you'd use a Firestore aggregation query (count()) or maintain distributed counters.
 * Here we use count() which is optimized and doesn't download documents.
 */
export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const db = getAdminDb();

  // Perform parallel count queries
  const [
    invitedCountSnap,
    usersCountSnap,
    submittedCountSnap,
    approvedCountSnap,
    ticketsCountSnap
  ] = await Promise.all([
    db.collection('invitedTeams').count().get(),
    db.collection('users').count().get(),
    db.collection('teams').where('status', 'in', ['Submitted', 'Approved', 'Rejected']).count().get(),
    db.collection('teams').where('status', '==', 'Approved').count().get(),
    db.collection('tickets').count().get()
  ]);

  return {
    totalInvited: invitedCountSnap.data().count,
    totalUsers: usersCountSnap.data().count,
    totalTeamsSubmitted: submittedCountSnap.data().count,
    totalTeamsApproved: approvedCountSnap.data().count,
    totalTickets: ticketsCountSnap.data().count
  };
}
