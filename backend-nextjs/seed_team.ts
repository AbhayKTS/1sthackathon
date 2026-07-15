import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();
const db = getFirestore();

async function run() {
  await db.collection('invitedTeams').doc('test-team-123').set({
    teamName: "Browser Test Team",
    leaderName: "Browser Leader",
    leaderEmail: "leader@test.com",
    leaderPhone: "+919999999999",
    college: "Test College",
    domain: "AI",
    problemStatement: "PS1",
    isCustomPS: false,
    members: [
      { name: "Browser Member", email: "member@test.com", role: "Backend Developer", college: "Test College" }
    ],
    status: "EmailSent",
    importBatchId: "test-batch",
    importedAt: new Date(),
    updatedAt: new Date(),
    invitationSentAt: new Date(),
    leaderRegisteredAt: null,
    allMembersRegisteredAt: null,
    lockedAt: null
  });
  console.log("Seeded test-team-123");
}

run().catch(console.error);
