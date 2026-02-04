/**
 * Cookie-based Rate Limiter with Admin Bypass
 *
 * Protects expensive API endpoints when the demo link is shared publicly.
 * Uses a tiq_session cookie to track per-visitor request counts.
 *
 * Admin bypass: set tiq_admin cookie to ADMIN_SECRET value via browser console:
 *   document.cookie = "tiq_admin=YOUR_SECRET; path=/; max-age=86400";
 */

import { NextRequest, NextResponse } from "next/server";
import { getOpikClient, flushTraces } from "../integrations/opik";

// ---------------------------------------------------------------------------
// Rate limit configuration per endpoint category
// ---------------------------------------------------------------------------

export type RateLimitCategory = "evaluation" | "judge" | "analyze" | "generate" | "chat" | "voice";

interface CategoryConfig {
  maxRequests: number;
  windowMs: number;
}

// Voice rate limits are configurable via env to control TTS costs in demos
const VOICE_MAX_REQUESTS = parseInt(process.env.VOICE_RATE_LIMIT_MAX || "20", 10);
const VOICE_WINDOW_MS = parseInt(process.env.VOICE_RATE_LIMIT_WINDOW_MIN || "15", 10) * 60 * 1000;

const CATEGORY_CONFIGS: Record<RateLimitCategory, CategoryConfig> = {
  evaluation: { maxRequests: 3, windowMs: 15 * 60 * 1000 },  // 3 per 15 min
  judge:      { maxRequests: 5, windowMs: 10 * 60 * 1000 },   // 5 per 10 min
  analyze:    { maxRequests: 10, windowMs: 5 * 60 * 1000 },    // 10 per 5 min
  generate:   { maxRequests: 10, windowMs: 5 * 60 * 1000 },    // 10 per 5 min
  chat:       { maxRequests: 20, windowMs: 15 * 60 * 1000 },   // 20 per 15 min
  voice:      { maxRequests: VOICE_MAX_REQUESTS, windowMs: VOICE_WINDOW_MS }, // env-configurable
};

// ---------------------------------------------------------------------------
// In-memory storage (resets on cold start — fine for demo protection)
// ---------------------------------------------------------------------------

interface RequestRecord {
  timestamps: number[];
}

// Key: `${sessionId}:${category}`
const requestLog = new Map<string, RequestRecord>();

// Periodic cleanup to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastCleanup = Date.now();

function cleanupExpiredEntries(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, record] of requestLog.entries()) {
    // Find the category from the key to get the correct window
    const category = key.split(":").pop() as RateLimitCategory;
    const config = CATEGORY_CONFIGS[category];
    if (!config) {
      requestLog.delete(key);
      continue;
    }

    // Remove timestamps older than the window
    record.timestamps = record.timestamps.filter((t) => now - t < config.windowMs);
    if (record.timestamps.length === 0) {
      requestLog.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

const SESSION_COOKIE = "tiq_session";
const ADMIN_COOKIE = "tiq_admin";

function getSessionId(req: NextRequest): string | null {
  // Prefer cookie; fall back to the header injected by Next.js middleware
  // on the very first request (before the cookie round-trips back).
  return (
    req.cookies.get(SESSION_COOKIE)?.value ??
    req.headers.get("x-tiq-session") ??
    null
  );
}

function isAdmin(req: NextRequest): boolean {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return false; // No secret configured — admin bypass disabled
  const adminCookie = req.cookies.get(ADMIN_COOKIE)?.value;
  return adminCookie === adminSecret;
}

function generateSessionId(): string {
  // Crypto-random hex string (16 bytes = 32 hex chars)
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Opik tracing for rate limit events
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: log a rate-limit event to Opik so it appears in the
 * dashboard as an error trace (rate-limit-{category}).
 */
function traceRateLimit(
  category: RateLimitCategory,
  sessionId: string,
  resetInMs: number
): void {
  // Async but we don't await — best effort, never blocks the 429 response
  (async () => {
    try {
      const opik = getOpikClient();
      if (!opik) return;

      const errorInfo = {
        exceptionType: "RateLimitExceeded",
        message: `Rate limit exceeded for category "${category}"`,
        traceback: `Session ${sessionId} exceeded ${CATEGORY_CONFIGS[category].maxRequests} requests in ${CATEGORY_CONFIGS[category].windowMs / 1000}s window. Reset in ${Math.ceil(resetInMs / 1000)}s.`,
      };

      const trace = opik.trace({
        name: `rate-limit-${category}`,
        metadata: {
          category,
          sessionId,
          resetInMs,
          maxRequests: CATEGORY_CONFIGS[category].maxRequests,
          windowMs: CATEGORY_CONFIGS[category].windowMs,
          timestamp: new Date().toISOString(),
        },
      });

      trace.update({ errorInfo });
      trace.end();
      await flushTraces();
    } catch {
      // Never throw from tracing — best-effort utility
    }
  })();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
  isAdmin: boolean;
  sessionId: string;
}

/**
 * Check rate limit for a request in a given category.
 * Returns the result and the sessionId (which may be newly generated).
 *
 * Usage in an API route:
 *   const { response, result } = applyRateLimit(request, "evaluation");
 *   if (response) return response; // 429
 *   // ... continue with handler
 */
export function checkRateLimit(
  req: NextRequest,
  category: RateLimitCategory
): RateLimitResult {
  // Run cleanup opportunistically
  cleanupExpiredEntries();

  // Get or generate session
  let sessionId = getSessionId(req);
  if (!sessionId) {
    sessionId = generateSessionId();
  }

  // Admin bypass
  if (isAdmin(req)) {
    return { allowed: true, remaining: Infinity, resetInMs: 0, isAdmin: true, sessionId };
  }

  const config = CATEGORY_CONFIGS[category];
  const key = `${sessionId}:${category}`;
  const now = Date.now();

  // Get or create record
  let record = requestLog.get(key);
  if (!record) {
    record = { timestamps: [] };
    requestLog.set(key, record);
  }

  // Prune old timestamps outside the window
  record.timestamps = record.timestamps.filter((t) => now - t < config.windowMs);

  // Check limit
  if (record.timestamps.length >= config.maxRequests) {
    // Find when the oldest request in the window will expire
    const oldestInWindow = record.timestamps[0];
    const resetInMs = config.windowMs - (now - oldestInWindow);

    return {
      allowed: false,
      remaining: 0,
      resetInMs: Math.max(0, resetInMs),
      isAdmin: false,
      sessionId,
    };
  }

  // Record this request
  record.timestamps.push(now);

  return {
    allowed: true,
    remaining: config.maxRequests - record.timestamps.length,
    resetInMs: 0,
    isAdmin: false,
    sessionId,
  };
}

/**
 * Convenience: check rate limit and return a 429 response if exceeded,
 * or null if the request is allowed. Also sets the session cookie on the response
 * if it was newly generated.
 *
 * Usage:
 *   const blocked = applyRateLimit(request, "evaluation");
 *   if (blocked) return blocked;
 */
export function applyRateLimit(
  req: NextRequest,
  category: RateLimitCategory
): NextResponse | null {
  const result = checkRateLimit(req, category);

  if (!result.allowed) {
    // Log rate-limit event to Opik (fire-and-forget)
    traceRateLimit(category, result.sessionId, result.resetInMs);

    const retryAfterSeconds = Math.ceil(result.resetInMs / 1000);
    const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);

    const response = NextResponse.json(
      {
        error: "Rate limit exceeded",
        message: `Demo rate limit reached. Try again in ${retryAfterMinutes} minute${retryAfterMinutes === 1 ? "" : "s"}.`,
        retryAfterMs: result.resetInMs,
        retryAfterSeconds,
        remaining: 0,
        category,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(Math.ceil((Date.now() + result.resetInMs) / 1000)),
        },
      }
    );

    // Ensure session cookie is set even on 429
    if (!getSessionId(req)) {
      response.cookies.set(SESSION_COOKIE, result.sessionId, {
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 7 days
        httpOnly: false, // Readable by client JS for display purposes
        sameSite: "lax",
      });
    }

    return response;
  }

  return null;
}

/**
 * Set the session cookie on a successful response if it doesn't exist yet.
 * Call this after your route handler creates its response.
 *
 * Usage:
 *   const result = checkRateLimit(request, "analyze");
 *   // ... build your response ...
 *   return ensureSessionCookie(request, response, result.sessionId);
 */
export function ensureSessionCookie(
  req: NextRequest,
  response: NextResponse,
  sessionId: string
): NextResponse {
  if (!getSessionId(req)) {
    response.cookies.set(SESSION_COOKIE, sessionId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      httpOnly: false,
      sameSite: "lax",
    });
  }
  return response;
}
