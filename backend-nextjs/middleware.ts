import { type NextRequest, NextResponse } from 'next/server';

const allowedOrigins = new Set([
  'https://revengershack.tech',
  'https://www.revengershack.tech',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
]);

function isAllowedOrigin(origin: string): boolean {
  return allowedOrigins.has(origin);
}

function applyCorsHeaders(response: NextResponse, origin: string): NextResponse {
  if (!isAllowedOrigin(origin)) {
    return response;
  }

  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.headers.set('Access-Control-Max-Age', '86400');
  response.headers.set('Vary', 'Origin');
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const origin = request.headers.get('origin') ?? '';

  if (request.method === 'OPTIONS') {
    if (!isAllowedOrigin(origin)) {
      return new NextResponse(null, { status: 403 });
    }

    return applyCorsHeaders(new NextResponse(null, { status: 204 }), origin);
  }

  const response = NextResponse.next();
  return applyCorsHeaders(response, origin);
}

export const config = {
  matcher: ['/api/:path*'],
};