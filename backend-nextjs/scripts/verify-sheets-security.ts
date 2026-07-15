import fs from 'fs';
import path from 'path';

// 1. Manually load .env.local from workspace root to make sure credentials are populated
try {
  const envPath = path.resolve(__dirname, '../.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.substring(1, val.length - 1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.substring(1, val.length - 1);
        }
        process.env[key] = val;
      }
    });
    console.log('Successfully loaded .env.local');
  }
} catch (e) {
  console.error('Failed loading .env.local:', e);
}

// Load service account JSON from Downloads if available (as done in ensure-super-admin.ts)
if (!process.env.FORCE_EMULATOR) {
  try {
    const saPath = '/Users/havocerebus/Downloads/sthack-88def-4e61863395d6.json';
    if (fs.existsSync(saPath)) {
      const saContent = fs.readFileSync(saPath, 'utf8');
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON = saContent;
      console.log('Successfully loaded Google service account JSON from Downloads');
    }
  } catch (e) {
    console.error('Failed loading Google service account JSON:', e);
  }
}

import { google } from 'googleapis';

async function main() {
  console.log('\n=========================================');
  console.log('🔍 GOOGLE SHEETS SECURITY VERIFICATION 🔍');
  console.log('=========================================\n');

  const sheetsConfig = [
    { name: 'ONBOARDING', id: process.env.GOOGLE_SHEET_ONBOARDING_ID },
    { name: 'PPT SUBMISSION', id: process.env.GOOGLE_SHEET_PPT_ID },
    { name: 'PROTOTYPE SUBMISSION', id: process.env.GOOGLE_SHEET_PROTO_ID },
  ];

  let hasErrors = false;

  console.log('1️⃣  Checking Environment Variables');
  const missingIds = sheetsConfig.filter((s) => !s.id);
  if (missingIds.length > 0) {
    console.error(`❌ Missing Sheet IDs: ${missingIds.map((s) => s.name).join(', ')}`);
    hasErrors = true;
  } else {
    console.log('✅ All Sheet IDs are configured.');
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.error(`❌ Missing GOOGLE_SERVICE_ACCOUNT_JSON`);
    hasErrors = true;
  } else {
    console.log('✅ GOOGLE_SERVICE_ACCOUNT_JSON is configured.\n');
  }

  if (hasErrors) {
    console.log('Aborting tests due to missing configuration.');
    process.exit(1);
  }

  console.log('2️⃣  Running Negative Test (Public Access Denied)');
  for (const sheet of sheetsConfig) {
    try {
      // Fetch without auth header
      const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}`);
      if (res.ok) {
        console.error(`❌ VULNERABILITY: ${sheet.name} is PUBLICALLY ACCESSIBLE! (Status: ${res.status})`);
        hasErrors = true;
      } else {
        console.log(`✅ ${sheet.name} is restricted. Public fetch failed with status ${res.status}.`);
      }
    } catch (err: any) {
      console.log(`✅ ${sheet.name} is restricted. Public fetch rejected.`);
    }
  }

  console.log('\n3️⃣  Running Positive Test (Service Account Access)');
  try {
    const serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON as string);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccount,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    for (const sheet of sheetsConfig) {
      try {
        const response = await sheets.spreadsheets.get({
          spreadsheetId: sheet.id as string,
        });
        console.log(`✅ ${sheet.name} successfully accessed via Service Account.`);
        console.log(`   └─ Sheet Title: "${response.data.properties?.title}"`);
      } catch (err: any) {
        console.error(`❌ Failed to access ${sheet.name} via Service Account: ${err.message}`);
        hasErrors = true;
      }
    }
  } catch (err: any) {
    console.error(`❌ Failed to initialize Google Auth: ${err.message}`);
    hasErrors = true;
  }

  console.log('\n=========================================');
  if (hasErrors) {
    console.error('❌ SECURITY VERIFICATION FAILED. See errors above.');
    process.exit(1);
  } else {
    console.log('✅ SECURITY VERIFICATION PASSED. All sheets are restricted and service account has access.');
    process.exit(0);
  }
}

main().catch(console.error);
