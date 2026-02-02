/**
 * Next.js Proxy (Next.js 16 convention) — sets the tiq_session cookie
 * on every rate-limited API request.
 *
 * This runs BEFORE any API route handler, ensuring that the rate-limiter
 * always sees a consistent session ID.  Without this, each request that
 * lacked the cookie would generate a new session ID inside
 * checkRateLimit(), meaning the in-memory counter would never accumulate
 * and rate limiting would never trigger.
 *
 * On Vercel serverless the in-memory Map resets on cold starts — this is
 * acceptable for demo protection. The session cookie (7-day TTL) survives
 * cold starts so returning visitors are still tracked when the instance
 * re-warms.
 */

import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "tiq_session";

function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function proxy(req: NextRequest) {
  // If the cookie already exists, pass through unchanged
  if (req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }

  // Generate a new session ID for this visitor
  const sessionId = generateSessionId();

  // Standard Next.js pattern: create the response, set cookie on it, return it.
  // This correctly propagates Set-Cookie to the client on Vercel.
  const response = NextResponse.next({
    request: {
      // Inject session ID as a request header so downstream API routes
      // can read it on this very first request (before the cookie
      // round-trips back from the browser).
      headers: new Headers([
        ...Array.from(req.headers.entries()),
        ["x-tiq-session", sessionId],
      ]),
    },
  });

  response.cookies.set(SESSION_COOKIE, sessionId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    httpOnly: false,           // Readable by client JS for display purposes
    sameSite: "lax",
  });

  return response;
}

// Only run on API routes that are rate-limited
export const config = {
  matcher: [
    "/api/analyze/:path*",
    "/api/agent/:path*",
    "/api/evaluate/:path*",
    "/api/experiments/:path*",
    "/api/generate-plan/:path*",
    "/api/patient-chat/:path*",
  ],
};
