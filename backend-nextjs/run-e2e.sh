#!/bin/bash
set -e

echo "Starting Next.js Dev Server..."
cd /Users/havocerebus/Documents/Current_Project_Working/j/1sthackathon/backend-nextjs
FIRESTORE_EMULATOR_HOST="localhost:8080" FIREBASE_AUTH_EMULATOR_HOST="localhost:9099" npm run dev &
NEXT_PID=$!

echo "Waiting for Next.js to start..."
sleep 10

echo "Starting Firebase Emulator & running simulation..."
cd /Users/havocerebus/Documents/Current_Project_Working/j/1sthackathon
npx firebase emulators:exec --project demo-revengershack "cd backend-nextjs && npx tsx scripts/e2e_simulation.ts" || echo "Simulation script exited with error"

echo "Killing Next.js..."
kill $NEXT_PID
