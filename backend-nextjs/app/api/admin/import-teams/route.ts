/**
 * POST /api/admin/import-teams
 *
 * Bulk import shortlisted teams from a CSV or Excel file.
 * Requires admin or super_admin role.
 *
 * Expected payload: multipart/form-data
 * - file: The .csv or .xlsx file
 *
 * CSV/Excel columns (headers):
 *   teamName, leaderName, leaderEmail, leaderPhone, college
 *   (optional) domain, problemStatement
 *   (optional) member1Name, member1Email, member1Role, member1College
 *   (optional) member2Name, member2Email, member2Role, member2College
 *   (optional) member3Name, member3Email, member3Role, member3College
 *
 * Returns: { imported, skipped, failed, errors, batchId }
 *
 * @route POST /api/admin/import-teams
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
    const token = await withAuth(request);
    requireRole(token, ['admin', 'super_admin']);

    const formData = await request.formData().catch(() => {
      throw Errors.validation('Could not parse multipart/form-data payload.');
    });

    const file = formData.get('file');
    if (!file || !(file instanceof Blob)) {
      throw Errors.validation('Missing or invalid "file" field in form data.');
    }

    const fileName = (file as File).name ?? '';
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') ||
      file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.type === 'application/vnd.ms-excel';
    const isCsv = fileName.endsWith('.csv') || file.type === 'text/csv';

    if (!isExcel && !isCsv) {
      throw Errors.validation('Uploaded file must be a CSV (.csv) or Excel (.xlsx, .xls).');
    }

    let records: CsvRow[];

    if (isExcel) {
      // Excel parsing via xlsx
      let xlsx: typeof import('xlsx');
      try {
        xlsx = await import('xlsx');
      } catch {
        throw Errors.internal(
          'Excel parsing library (xlsx) not installed. Run: npm install xlsx'
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const workbook = xlsx.read(arrayBuffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]!];
      if (!firstSheet) throw Errors.validation('Excel file has no sheets.');

      records = xlsx.utils.sheet_to_json<CsvRow>(firstSheet, {
        raw: false,
        defval: '',
      });
    } else {
      // CSV parsing via papaparse
      const text = await file.text();
      if (!text.trim()) throw Errors.validation('CSV file is empty.');

      const parsed = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (header) => header.trim(),
      });

      if (parsed.errors.length > 0) {
        console.warn(`[import-teams] CSV parser errors:`, parsed.errors.slice(0, 3));
      }

      records = parsed.data as CsvRow[];
    }

    if (records.length === 0) {
      throw Errors.validation('File contains no data rows.');
    }

    const batchId = randomUUID();
    const result = await importInvitations(records, token.uid, token.role, batchId);

    const response = apiSuccess({ batchId, stats: result }, 200);
    return applyCorsHeaders(response, origin);
  } catch (err) {
    return applyCorsHeaders(apiError(err, origin), origin);
  }
}
