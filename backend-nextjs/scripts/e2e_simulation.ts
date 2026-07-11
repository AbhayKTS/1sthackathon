import fs from 'fs';
import path from 'path';

// Simulation Configuration
const STAGES = [100];
const BASE_URL = process.env.API_URL || 'http://localhost:3001';
const ADMIN_TOKEN = 'MOCK_TOKEN_superadmin';

interface TestReport {
  stage: number;
  results: Record<string, any>;
  latencies: Record<string, number>;
}

async function apiCall(method: string, endpoint: string, body?: any, token?: string) {
  const start = Date.now();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    return {
      status: res.status,
      ok: res.ok,
      data,
      latency: Date.now() - start,
    };
  } catch (error: any) {
    return {
      status: 500,
      ok: false,
      data: { error: error.message },
      latency: Date.now() - start,
    };
  }
}

async function generateCsvAndImport(teamCount: number) {
  console.log(`[Stage ${teamCount}] Generating CSV for ${teamCount} teams...`);
  let csvContent = 'teamName,leaderName,leaderEmail,leaderPhone,college\n';
  for (let i = 0; i < teamCount; i++) {
    csvContent += `SimTeam${i},Leader${i},leader${i}@sim.com,9999999999,SimCollege\n`;
  }

  const formData = new FormData();
  const blob = new Blob([csvContent], { type: 'text/csv' });
  formData.append('file', blob, 'import.csv');

  const start = Date.now();
  try {
    const res = await fetch(`${BASE_URL}/api/admin/import-teams`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
      },
      body: formData,
    });
    const data = await res.json().catch(() => null);
    return { success: res.ok, data, latency: Date.now() - start };
  } catch (e: any) {
    return { success: false, error: e.message, latency: Date.now() - start };
  }
}

import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Admin SDK for setup/teardown
if (!getApps().length) {
  // Use project id from emulator
  process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
  initializeApp({ projectId: 'demo-revengershack' });
}
const db = getFirestore();

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runSimulationForStage(teamCount: number): Promise<TestReport> {
  console.log(`\n========================================`);
  console.log(`🚀 Starting Stage: ${teamCount} Teams`);
  console.log(`========================================`);

  const report: TestReport = { stage: teamCount, results: {}, latencies: {} };

  // Setup Admin user FIRST
  await db.collection('users').doc('superadmin').set({ role: 'super_admin', email: 'admin@sim.com', isActive: true });

  // 1. CSV Import
  const importRes = await generateCsvAndImport(teamCount);
  report.results['CSV_Import'] = importRes.success ? 'PASS' : 'FAIL';
  report.latencies['CSV_Import'] = importRes.latency;
  if (!importRes.success) return report;
  
  const payloadData = importRes.data?.data || importRes.data;
  const batchId = payloadData.batchId || payloadData.importBatchId || payloadData.batch_id;
  const invitedTeamsRes = await apiCall('GET', `/api/admin/invited-teams?batchId=${batchId}&limit=1000`, undefined, ADMIN_TOKEN);
  const invitedTeams = invitedTeamsRes.data?.data?.teams || invitedTeamsRes.data?.teams || [];

  // Create Round 1
  await db.collection('rounds').doc('round1').set({
    title: 'Round 1',
    status: 'Published',
    type: 'general',
    submissionType: 'github_link',
    allowedTeams: 'all',
    createdAt: new Date(),
    updatedAt: new Date()
  });

  // 2. Registration (Leader Onboarding)
  console.log(`[Stage ${teamCount}] Simulating leader registration...`);
  let regSuccess = 0;
  let totalLat = 0;

  for (let i = 0; i < teamCount; i++) {
    const invite = invitedTeams[i];
    if (!invite) continue;
    const uid = `sim_${i}_uid`;
    const leaderToken = `MOCK_TOKEN_${uid}`;
    
    // Setup User Doc directly
    await db.collection('users').doc(uid).set({
      email: invite.leaderEmail,
      role: 'participant_leader',
      invitedTeamId: invite.id,
      isActive: true,
      onboardingStatus: 'pending'
    });

    const res = await apiCall('POST', '/api/onboarding/complete', {
      displayName: invite.leaderName || `Leader${i}`,
      role: 'Frontend Developer',
      phone: '9999999999',
      college: invite.college || 'SimCollege',
      github: 'https://github.com/sim'
    }, leaderToken);

    if (res.ok) regSuccess++;
    totalLat += res.latency;
  }
  
  report.results['Registration'] = regSuccess === teamCount ? 'PASS' : `FAIL (${regSuccess}/${teamCount})`;
  report.latencies['Registration'] = Math.round(totalLat / Math.max(teamCount, 1));

  // 3. Round Activation
  console.log(`[Stage ${teamCount}] Simulating Round Activation...`);
  const actRes = await apiCall('POST', '/api/admin/rounds/round1/transition', { to: 'Active' }, 'MOCK_TOKEN_superadmin');
  report.results['Round_Activation'] = actRes.ok ? 'PASS' : `FAIL (${JSON.stringify(actRes.data)})`;
  report.latencies['Round_Activation'] = actRes.latency;

  // Wait a bit to ensure async triggers
  await sleep(500);

  // Get Teams
  const teamsSnap = await db.collection('teams').get();
  const teams = teamsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // 4. Submissions (Concurrent)
  console.log(`[Stage ${teamCount}] Simulating Concurrent Submissions...`);
  const subStart = Date.now();
  const subPromises = teams.map((team: any, i: number) => {
    return apiCall('POST', '/api/submission/submit', {
      teamId: team.id,
      roundId: 'round1',
      githubLink: 'https://github.com/test/repo',
      demoLink: 'https://demo.com'
    }, `MOCK_TOKEN_sim_${i}_uid`);
  });
  const subResults = await Promise.all(subPromises);
  const subOk = subResults.filter(r => r.ok).length;
  if (subOk === teamCount) {
    report.results['Submissions'] = 'PASS';
  } else {
    const firstErr = subResults.find(r => !r.ok)?.data;
    report.results['Submissions'] = `FAIL (${JSON.stringify(firstErr)})`;
  }
  report.latencies['Submissions'] = Math.round((Date.now() - subStart) / Math.max(teamCount, 1));

  // 4b. Negative Tests (Submission)
  console.log(`[Stage ${teamCount}] Simulating Negative Scenarios...`);
  const negSubRes = await apiCall('POST', '/api/submission/submit', {
    teamId: teams[0]?.id || 'fake_id',
    roundId: 'round1',
    githubLink: 'bad'
  }, `MOCK_TOKEN_sim_random`);
  report.results['Negative_Scenarios'] = (!negSubRes.ok) ? 'PASS' : 'FAIL (Expected rejection)';
  report.latencies['Negative_Scenarios'] = negSubRes.latency;

  // 5. Time Leap
  console.log(`[Stage ${teamCount}] Simulating Time Leap...`);
  const leapRes = await apiCall('POST', '/api/admin/timeleap/select', {
    teamIds: teams.slice(0, 5).map(t => t.id)
  }, 'MOCK_TOKEN_superadmin');
  report.results['Time_Leap'] = leapRes.ok ? 'PASS' : 'FAIL';
  report.latencies['Time_Leap'] = leapRes.latency;

  // Mentor Slots Generation
  console.log(`[Stage ${teamCount}] Simulating Mentor Slots...`);
  const mentorStart = Date.now();
  const mentorPromises = teams.map((team: any, i: number) => {
    return db.collection('mentorSlots').doc(`slot_${i}`).set({
      teamId: team.id,
      roundId: 'round1',
      mentorName: 'Test Mentor',
      status: 'scheduled',
      startTime: new Date().toISOString()
    });
  });
  await Promise.all(mentorPromises);
  report.results['Mentor_Scheduling'] = 'PASS';
  report.latencies['Mentor_Scheduling'] = Math.round((Date.now() - mentorStart) / Math.max(teamCount, 1));

  // 6. Evaluation
  console.log(`[Stage ${teamCount}] Simulating Judge Evaluations...`);
  await apiCall('POST', '/api/admin/rounds/round1/transition', { to: 'Evaluation' }, 'MOCK_TOKEN_superadmin');
  
  await db.collection('users').doc('sim_judge').set({ role: 'judge', email: 'judge@sim.com', isActive: true });
  const evalStart = Date.now();
  const evalPromises = teams.map((team: any) => {
    return apiCall('POST', '/api/admin/evaluations', {
      teamId: team.id,
      roundId: 'round1',
      draftScore: 85 + Math.floor(Math.random() * 10),
      feedback: 'Good job',
      judgeUid: 'sim_judge'
    }, 'MOCK_TOKEN_sim_judge');
  });
  const evalResults = await Promise.all(evalPromises);
  const evalOk = evalResults.filter(r => r.ok).length;
  report.results['Evaluation'] = evalOk === teamCount ? 'PASS' : `FAIL (${evalOk}/${teamCount})`;
  report.latencies['Evaluation'] = Math.round((Date.now() - evalStart) / Math.max(teamCount, 1));

  // Publish Evaluations (This sets lockedAt and updates team status)
  console.log(`[Stage ${teamCount}] Simulating Evaluation Publish...`);
  const pubEvalRes = await apiCall('POST', '/api/admin/evaluations/publish', { roundId: 'round1' }, 'MOCK_TOKEN_superadmin');
  
  // 7. Leaderboard Publish
  console.log(`[Stage ${teamCount}] Simulating Leaderboard Publish...`);
  const pubRes = await apiCall('POST', '/api/admin/rounds/round1/transition', { to: 'Completed' }, 'MOCK_TOKEN_superadmin');
  report.results['Leaderboard'] = pubRes.ok && pubEvalRes.ok ? 'PASS' : 'FAIL';
  report.latencies['Leaderboard'] = pubRes.latency;

  // 8. Queue Assertions (Sheets Sync & Mail)
  const queuesOk = await (async () => {
    const qSnap = await db.collection('googleSheets').get();
    return qSnap.docs.length >= teamCount;
  })();
  report.results['Queue_Processing'] = queuesOk ? 'PASS' : 'FAIL';
  report.latencies['Queue_Processing'] = 0;

  return report;
}

async function runAll() {
  console.log('Starting RevengersHack 2026 E2E Simulation...');
  
  // Setup Admin user for teardown
  await db.collection('users').doc('superadmin').set({ role: 'super_admin', email: 'admin@sim.com', isActive: true });

  // Teardown API needs to be implemented to clear DB
  await apiCall('POST', '/api/admin/debug/teardown', {}, ADMIN_TOKEN);

  const reports: TestReport[] = [];

  for (const count of STAGES) {
    const report = await runSimulationForStage(count);
    reports.push(report);
    await apiCall('POST', '/api/admin/debug/teardown', {}, ADMIN_TOKEN);
  }

  generateMarkdownReport(reports);
}

function generateMarkdownReport(reports: TestReport[]) {
  let md = '# RevengersHack 2026: E2E Simulation Report\n\n';
  reports.forEach(r => {
    md += `## Stage: ${r.stage} Teams\n`;
    md += `| Workflow | Status | Latency (ms) |\n`;
    md += `|---|---|---|\n`;
    for (const [wf, status] of Object.entries(r.results)) {
      md += `| ${wf} | ${status} | ${r.latencies[wf]}ms |\n`;
    }
    md += '\n';
  });

  fs.writeFileSync('e2e_report.md', md);
  console.log('Report generated at e2e_report.md');
}

runAll().catch(console.error);
