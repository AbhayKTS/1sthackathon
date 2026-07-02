/**
 * GET /api/dev/seed
 *
 * Developer-only API endpoint to seed Firestore with initial mock data (Rounds, Invited Teams, Admin users).
 * This endpoint is ONLY active when NODE_ENV is 'development' or when running against the emulator.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { getAdminDb, getAdminAuth } from '@/lib/firebase-admin';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV === 'development' || 
                process.env.FIRESTORE_EMULATOR_HOST || 
                process.env.FIREBASE_AUTH_EMULATOR_HOST;

  if (!isDev) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized. Seeding is only permitted in development mode.' },
      { status: 403 }
    );
  }

  try {
    const db = getAdminDb();

    // 1. Seed active rounds (round-1, round-2, round-3)
    const rounds = [
      { id: 'round-1', title: 'Round 1', description: 'Show Us What You Got', isActive: false },
      { id: 'round-2', title: 'Round 2', description: 'We Ride At Midnight', isActive: true },
      { id: 'round-3', title: 'Round 3', description: 'Seek The Way In Or Out', isActive: false }
    ];

    for (const round of rounds) {
      await db.collection('rounds').doc(round.id).set({
        title: round.title,
        description: round.description,
        isActive: round.isActive,
        updatedAt: new Date()
      }, { merge: true });
    }

    // 2. Seed mock invited teams for testing
    const invitedTeams = [
      {
        id: 'test-invite-participant',
        teamName: 'Alpha Gang',
        leaderName: 'Takemichi Hanagaki',
        leaderEmail: 'participant@test.com',
        leaderPhone: '+919999999999',
        college: 'Tokyo Shibuya College',
        status: 'Invited',
        invitedAt: new Date(),
        round: 2
      },
      {
        id: 'test-invite-admin',
        teamName: 'Valhalla Admin',
        leaderName: 'Manjiro Sano',
        leaderEmail: 'admin@test.com',
        leaderPhone: '+918888888888',
        college: 'Toman HQ',
        status: 'Invited',
        invitedAt: new Date(),
        round: 2
      }
    ];

    for (const team of invitedTeams) {
      await db.collection('invitedTeams').doc(team.id).set(team, { merge: true });
    }

    // 3. Directly create or retrieve test users in Auth and Firestore
    const authSdk = getAdminAuth();
    
    // Seed Admin Account
    let adminUid = '';
    try {
      const existingAdmin = await authSdk.getUserByEmail('admin@test.com');
      adminUid = existingAdmin.uid;
    } catch {
      const newAdmin = await authSdk.createUser({
        email: 'admin@test.com',
        emailVerified: true
      });
      adminUid = newAdmin.uid;
    }

    await db.collection('users').doc(adminUid).set({
      uid: adminUid,
      email: 'admin@test.com',
      role: 'admin',
      teamId: null,
      isActive: true,
      updatedAt: new Date()
    }, { merge: true });

    // Seed Participant Account
    let participantUid = '';
    try {
      const existingParticipant = await authSdk.getUserByEmail('participant@test.com');
      participantUid = existingParticipant.uid;
    } catch {
      const newParticipant = await authSdk.createUser({
        email: 'participant@test.com',
        emailVerified: true
      });
      participantUid = newParticipant.uid;
    }

    await db.collection('users').doc(participantUid).set({
      uid: participantUid,
      email: 'participant@test.com',
      role: 'participant_leader',
      teamId: null,
      isActive: true,
      updatedAt: new Date()
    }, { merge: true });

    // Scan any other existing users for auto-upgrade
    const usersSnap = await db.collection('users').get();
    let upgradedAdminsCount = 0;
    
    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const email = (userData.email || '').toLowerCase();
      if (email !== 'admin@test.com' && email.includes('admin')) {
        await userDoc.ref.update({
          role: 'admin',
          isActive: true
        });
        upgradedAdminsCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Firestore seeded successfully!',
      data: {
        roundsSeeded: rounds.length,
        invitedTeamsCreated: invitedTeams.length,
        existingAdminsUpgraded: upgradedAdminsCount
      }
    });

  } catch (err: any) {
    console.error('Seeding error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Seeding failed' },
      { status: 500 }
    );
  }
}
