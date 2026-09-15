import { type NextRequest, NextResponse } from 'next/server';
import { ApiError, verifyMagicLink } from '@/lib/recall';
import { startSession } from '@/lib/session';

// The magic link lands here. A route handler, not a page: only these may set the session cookie.

/**
 * Where to send the browser next.
 *
 * `request.url` is the address the *container* was reached on, which behind a proxy is not the
 * address the person is using: App Runner terminates TLS and forwards to 0.0.0.0:3000, so
 * redirecting relative to it sends them to a machine that only exists inside the VPC. The
 * forwarded headers carry the origin they actually typed; fall back to the request only when
 * nothing is in front of us, which is the case locally.
 */
function publicOrigin(request: NextRequest): string {
  const url = new URL(request.url);
  const first = (value: string | null) => value?.split(',')[0]?.trim() || null;
  const proto = first(request.headers.get('x-forwarded-proto')) ?? url.protocol.replace(':', '');
  const host = first(request.headers.get('x-forwarded-host')) ?? request.headers.get('host') ?? url.host;
  return `${proto}://${host}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const origin = publicOrigin(request);
  const token = request.nextUrl.searchParams.get('token');
  if (!token) return NextResponse.redirect(new URL('/sign-in?error=missing', origin));

  try {
    const session = await verifyMagicLink(token);
    await startSession(session.session_token, session.expires_at);
    return NextResponse.redirect(new URL('/', origin));
  } catch (err) {
    const expired = err instanceof ApiError && err.status === 401;
    return NextResponse.redirect(new URL(`/sign-in?error=${expired ? 'expired' : 'failed'}`, origin));
  }
}
