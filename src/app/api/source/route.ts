import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Self-destruct: Feb 19, 2026 11:59:59 PM EST (UTC-5) = Feb 20 04:59:59 UTC
const EXPIRY_DATE = new Date('2026-02-20T04:59:59Z');

// Cache manifest in memory after first read (per cold start)
let manifestCache: Record<string, unknown> | null = null;

function getManifest() {
  if (!manifestCache) {
    const manifestPath = join(process.cwd(), 'src', 'generated', 'code-manifest.json');
    if (!existsSync(manifestPath)) {
      return null;
    }
    manifestCache = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  }
  return manifestCache;
}

export async function GET() {
  // === KILL SWITCH (scoped to this route only) ===
  // Set CODE_VIEWER_ENABLED=true in Vercel env vars to enable.
  // Remove or set to anything else to instantly nuke access.
  // This does NOT affect any other route in the app.
  if (process.env.CODE_VIEWER_ENABLED !== 'true') {
    return NextResponse.json(
      { error: 'disabled', message: 'Source code viewer is currently disabled.' },
      { status: 403 }
    );
  }

  // === SELF-DESTRUCT TIMER ===
  // Automatically stops serving code after Feb 19, 2026 11:59 PM EST.
  if (new Date() > EXPIRY_DATE) {
    return NextResponse.json(
      { error: 'expired', message: 'Source code access has expired.' },
      { status: 403 }
    );
  }

  // === SERVE MANIFEST ===
  const manifest = getManifest();
  if (!manifest) {
    return NextResponse.json(
      { error: 'not_found', message: 'Code manifest not found. Run the generate script and rebuild.' },
      { status: 404 }
    );
  }

  return NextResponse.json(manifest);
}
