/**
 * Text-to-Speech API - OpenAI TTS
 *
 * Converts assistant response text to speech using OpenAI's tts-1 model.
 * Rate-limited via the "voice" category (env-configurable: VOICE_RATE_LIMIT_MAX,
 * VOICE_RATE_LIMIT_WINDOW_MIN).
 */

import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";

const MAX_TEXT_LENGTH = 4096; // OpenAI TTS max is 4096 chars

export async function POST(request: NextRequest) {
  // Demo rate limit for voice (env-configurable)
  const blocked = applyRateLimit(request, "voice");
  if (blocked) return blocked;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Voice is not configured (missing OPENAI_API_KEY)" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or empty text" },
        { status: 400 }
      );
    }

    // Truncate to TTS limit
    const truncated = text.slice(0, MAX_TEXT_LENGTH);

    const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: truncated,
        voice: "nova", // warm, friendly — good for patient coaching
        response_format: "mp3",
      }),
    });

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text();
      console.error("[TTS] OpenAI error:", ttsResponse.status, errText);
      return NextResponse.json(
        { error: "Text-to-speech generation failed" },
        { status: 502 }
      );
    }

    // Stream the audio back
    const audioBuffer = await ttsResponse.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "private, max-age=300", // cache 5 min — same text = same audio
      },
    });
  } catch (error) {
    console.error("[TTS] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
