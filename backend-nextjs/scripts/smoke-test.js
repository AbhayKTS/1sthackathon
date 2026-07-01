/**
 * Smoke Test Script
 * 
 * Run this script to verify that core API endpoints are alive and correctly enforcing auth.
 * Usage: node scripts/smoke-test.js
 */

const http = require('http');

const API_BASE = 'http://localhost:3001/api';
const ENDPOINTS_TO_TEST = [
  { path: '/rounds/active', method: 'GET', expectAuth: false },
  { path: '/admin/analytics', method: 'GET', expectAuth: true },
  { path: '/admin/announcement', method: 'GET', expectAuth: true },
  { path: '/team/profile', method: 'GET', expectAuth: true },
  { path: '/support', method: 'GET', expectAuth: true }
];

async function runSmokeTests() {
  console.log('🔥 Starting API Smoke Tests...');
  let passed = 0;
  let failed = 0;

  for (const endpoint of ENDPOINTS_TO_TEST) {
    const url = `${API_BASE}${endpoint.path}`;
    try {
      const res = await fetch(url, { method: endpoint.method });
      
      if (endpoint.expectAuth) {
        if (res.status === 401 || res.status === 403) {
          console.log(`✅ [PASS] ${endpoint.method} ${endpoint.path} correctly blocked unauthenticated access (${res.status}).`);
          passed++;
        } else {
          console.error(`❌ [FAIL] ${endpoint.method} ${endpoint.path} failed to block unauthenticated access! Status: ${res.status}`);
          failed++;
        }
      } else {
        if (res.status === 200) {
          console.log(`✅ [PASS] ${endpoint.method} ${endpoint.path} returned 200 OK.`);
          passed++;
        } else {
          console.error(`❌ [FAIL] ${endpoint.method} ${endpoint.path} expected 200 OK, got ${res.status}.`);
          failed++;
        }
      }
    } catch (e) {
      console.error(`❌ [FAIL] ${endpoint.method} ${endpoint.path} - Request failed: ${e.message}`);
      failed++;
    }
  }

  console.log('\n================================');
  console.log(`Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('================================\n');

  if (failed > 0) process.exit(1);
}

runSmokeTests();
