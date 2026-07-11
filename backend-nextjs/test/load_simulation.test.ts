import { describe, it, expect, beforeAll } from 'vitest';
import { getAdminDb } from '@/lib/firebase-admin';

describe('Firestore Load Simulation', () => {
  const db = getAdminDb();

  beforeAll(async () => {
    // Seed 1000 dummy documents inside a mock load collection to make read testing realistic
    const batch = db.batch();
    for (let i = 0; i < 200; i++) {
      batch.set(db.collection('load_test_users').doc(`user-${i}`), {
        name: `Test User ${i}`,
        college: 'Load College',
        teamId: `team-${i % 20}`,
        registeredAt: new Date(),
      });
    }
    await batch.commit();
  });

  const runSimulation = async (concurrencyLevel: number) => {
    console.log(`\n--- Starting Simulation for ${concurrencyLevel} Concurrent Users ---`);
    const memBefore = process.memoryUsage().heapUsed;
    const startOverall = Date.now();

    let totalWriteMs = 0;
    let totalReadMs = 0;
    let totalQueryMs = 0;

    const executeUserTask = async (id: number) => {
      // 1. Simulating Write Latency (Writing unique submission logs)
      const writeStart = Date.now();
      await db.collection('load_test_submissions').doc(`sub-${concurrencyLevel}-${id}`).set({
        teamId: `team-${id % 50}`,
        submittedAt: new Date(),
        githubLink: 'https://github.com/load/test',
        demoLink: 'https://demo.load.test',
      });
      totalWriteMs += (Date.now() - writeStart);

      // 2. Simulating Read Latency (Reading a specific user document)
      const readStart = Date.now();
      const userRef = db.collection('load_test_users').doc(`user-${id % 200}`);
      await userRef.get();
      totalReadMs += (Date.now() - readStart);

      // 3. Simulating Snapshot query Latency (Compound query index)
      const queryStart = Date.now();
      await db
        .collection('load_test_users')
        .where('teamId', '==', `team-${(id % 20)}`)
        .get();
      totalQueryMs += (Date.now() - queryStart);
    };

    // Spawn concurrent requests in parallel
    const promises = Array.from({ length: concurrencyLevel }).map((_, i) => executeUserTask(i));
    await Promise.all(promises);

    const totalDuration = Date.now() - startOverall;
    const memAfter = process.memoryUsage().heapUsed;
    const memoryDiffMb = ((memAfter - memBefore) / 1024 / 1024).toFixed(2);

    const avgWrite = (totalWriteMs / concurrencyLevel).toFixed(1);
    const avgRead = (totalReadMs / concurrencyLevel).toFixed(1);
    const avgQuery = (totalQueryMs / concurrencyLevel).toFixed(1);

    console.log(`[Results] Concurrency: ${concurrencyLevel}`);
    console.log(` - Avg Write Latency: ${avgWrite} ms`);
    console.log(` - Avg Read Latency: ${avgRead} ms`);
    console.log(` - Avg Snapshot Query Latency: ${avgQuery} ms`);
    console.log(` - Heap Memory Delta: ${memoryDiffMb} MB`);
    console.log(` - Total Batch Time: ${totalDuration} ms`);

    return {
      concurrencyLevel,
      avgWrite: parseFloat(avgWrite),
      avgRead: parseFloat(avgRead),
      avgQuery: parseFloat(avgQuery),
      memoryDiffMb: parseFloat(memoryDiffMb),
      totalDuration,
    };
  };

  it('runs load simulation at 100 concurrent users', async () => {
    const res = await runSimulation(100);
    expect(res.avgWrite).toBeLessThan(1000); // Latency should be sub-second
  });

  it('runs load simulation at 250 concurrent users', async () => {
    const res = await runSimulation(250);
    expect(res.avgWrite).toBeLessThan(1500);
  });

  it('runs load simulation at 500 concurrent users', async () => {
    const res = await runSimulation(500);
    expect(res.avgWrite).toBeLessThan(2000);
  });

  it('runs load simulation at 1000 concurrent users', async () => {
    const res = await runSimulation(1000);
    expect(res.avgWrite).toBeLessThan(3000);
  });
});
