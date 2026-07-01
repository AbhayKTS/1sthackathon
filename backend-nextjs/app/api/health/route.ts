/**
 * GET /api/health
 *
 * Smoke-test endpoint. Returns server status and timestamp.
 * Used by Vercel health checks and post-deploy smoke tests.
 * No auth required — intentionally public.
 *
 * @route GET /api/health
 */

import { type NextRequest, NextResponse } from 'next/server';
import { applyCorsHeaders, handleOptions } from '@/lib/api-helpers';

export function OPTIONS(request: NextRequest): NextResponse {
  return handleOptions(request);
}

export function GET(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin') ?? '';

  const response = NextResponse.json({
    success: true,
    data: {
      status: 'operational',
      service: 'RevengersHack API',
      version: process.env.npm_package_version ?? '0.0.1',
      environment: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    },
  });

  return applyCorsHeaders(response, origin);
}
