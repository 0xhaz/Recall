import { type NextRequest, NextResponse } from 'next/server';
import { ApiError, verifyMagicLink } from '@/lib/recall';
import { startSession } from '@/lib/session';

// The magic link lands here. A route handler, not a page: only these may set the session cookie.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.redirect(new URL('/sign-in?error=missing', request.url));

  try {
    const session = await verifyMagicLink(token);
    await startSession(session.session_token, session.expires_at);
    return NextResponse.redirect(new URL('/', request.url));
  } catch (err) {
    const expired = err instanceof ApiError && err.status === 401;
    return NextResponse.redirect(new URL(`/sign-in?error=${expired ? 'expired' : 'failed'}`, request.url));
  }
}
