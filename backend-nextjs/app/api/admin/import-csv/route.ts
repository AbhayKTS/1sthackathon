/**
 * POST /api/admin/import-csv
 *
 * Secure endpoint for bulk importing shortlisted teams from a CSV file.
 * Requires `super_admin` role.
 *
 * Expected payload: multipart/form-data
 * - file: The .csv file
 *
 * CSV Columns expected (headers):
 * teamName, leaderName, leaderEmail, leaderPhone, college
 *
 * Returns: { imported, skipped, failed }
 *
 * @route POST /api/admin/import-csv
 */

import { type NextRequest, NextResponse } from 'next/server';
import { apiSuccess, apiError, applyCorsHeaders, handleOptions, requireRole, withAuth } from '@/lib/api-helpers';
import { Errors } from '@/lib/errors';
import Papa from 'papaparse';
import { randomUUID } from 'crypto';
import { importInvitations, type CsvRow } from '@/server/services/invitation.service';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get('origin') ?? '';

  try {
    // 1. Auth & Role check (super_admin only)
    const token = await withAuth(request);
    requireRole(token, ['super_admin']);

    // 2. Extract multipart form data
    const formData = await request.formData().catch(() => {
      throw Errors.validation('Could not parse multipart/form-data payload.');
    });

    const file = formData.get('file');
    if (!file || !(file instanceof Blob)) {
      throw Errors.validation('Missing or invalid "file" field in form data.');
    }

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      throw Errors.validation('Uploaded file must be a CSV.');
    }

    // 3. Read file contents
    const text = await file.text();
    if (!text.trim()) {
      throw Errors.validation('CSV file is empty.');
    }

    // 4. Parse CSV using papaparse
    const parsed = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
    });

    if (parsed.errors.length > 0) {
      // Just log parser errors, but continue with valid rows if any
      console.warn(`CSV parser encountered ${parsed.errors.length} errors. First error:`, parsed.errors[0]);
    }

    const records = parsed.data as Record<string, string>[];
    
    // 5. Map to expected CsvRow interface and validate basic existence of required columns
    const mappedRecords: CsvRow[] = records.map((row) => ({
      teamName: row['teamName'] || '',
      leaderName: row['leaderName'] || '',
      leaderEmail: row['leaderEmail'] || '',
      leaderPhone: row['leaderPhone'] || '',
      college: row['college'] || '',
    }));

    // Generate a unique batch ID for this import session
    const batchId = randomUUID();

    // 6. Pass to service for batch writing and deduplication
    const result = await importInvitations(mappedRecords, token.uid, token.role, batchId);

    // 7. Return summary
    const response = apiSuccess(
      {
        message: 'Import completed successfully.',
        batchId,
        stats: result,
      },
      200
    );

    return applyCorsHeaders(response, origin);
  } catch (err) {
    const response = apiError(err, origin);
    return applyCorsHeaders(response, origin);
  }
}
