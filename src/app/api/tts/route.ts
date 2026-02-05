/**
 * Text-to-Speech API - OpenAI TTS
 *
 * Converts assistant response text to speech using OpenAI's tts-1 model.
 * Rate-limited via the "voice" category (env-configurable: VOICE_RATE_LIMIT_MAX,
 * VOICE_RATE_LIMIT_WINDOW_MIN).
 *
 * Opik tracing: logs latency, character count, estimated cost, audio size,
 * and errors for every request.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { getOpikClient, traceError, flushTraces } from "@/lib/integrations/opik";

const MAX_TEXT_LENGTH = 4096; // OpenAI TTS max is 4096 chars
const TTS_MODEL = "tts-1";
const TTS_VOICE = "nova";
// OpenAI tts-1 pricing: $15 per 1M characters
const COST_PER_CHAR = 15 / 1_000_000;

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

  const opik = getOpikClient();
  const startTime = Date.now();

  const trace = opik?.trace({
    name: "tts-generation",
    metadata: {
      model: TTS_MODEL,
      voice: TTS_VOICE,
      category: "voice",
    },
  });

  try {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      trace?.update({ output: { error: "missing_text" } });
      trace?.end();
      return NextResponse.json(
        { error: "Missing or empty text" },
        { status: 400 }
      );
    }

    // Truncate to TTS limit
    const truncated = text.slice(0, MAX_TEXT_LENGTH);
    const charCount = truncated.length;
    const estimatedCost = charCount * COST_PER_CHAR;
    const wasTruncated = text.length > MAX_TEXT_LENGTH;

    trace?.update({
      metadata: {
        char_count: charCount,
        original_length: text.length,
        truncated: wasTruncated,
        estimated_cost_usd: estimatedCost,
      },
    });

    // --- OpenAI TTS API call (traced as a span) ---
    const apiSpan = trace?.span({
      name: `openai-${TTS_MODEL}`,
      type: "llm",
      model: TTS_MODEL,
      provider: "openai",
      metadata: {
        voice: TTS_VOICE,
        char_count: charCount,
        response_format: "mp3",
      },
    });

    const apiStartTime = Date.now();

    const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        input: truncated,
        voice: TTS_VOICE,
        response_format: "mp3",
      }),
    });

    const apiLatencyMs = Date.now() - apiStartTime;

    if (!ttsResponse.ok) {
      const errText = await ttsResponse.text();
      console.error("[TTS] OpenAI error:", ttsResponse.status, errText);

      apiSpan?.update({
        metadata: {
          success: false,
          http_status: ttsResponse.status,
          api_latency_ms: apiLatencyMs,
          error: errText.slice(0, 500),
        },
      });
      apiSpan?.end();
      trace?.update({
        output: { error: "openai_api_error", status: ttsResponse.status },
      });
      trace?.end();
      await flushTraces();

      return NextResponse.json(
        { error: "Text-to-speech generation failed" },
        { status: 502 }
      );
    }

    // Stream the audio directly to the client — don't buffer the whole file
    const responseHeaders: Record<string, string> = {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=300",
    };
    // Forward Content-Length if OpenAI provides it (helps browser buffer estimation)
    const contentLength = ttsResponse.headers.get("content-length");
    if (contentLength) {
      responseHeaders["Content-Length"] = contentLength;
    }

    // Complete Opik tracing — finalize spans and flush
    const completeTrace = async () => {
      const totalLatencyMs = Date.now() - startTime;
      apiSpan?.update({
        totalEstimatedCost: estimatedCost,
        metadata: {
          success: true,
          api_latency_ms: apiLatencyMs,
          audio_size_bytes: contentLength ? parseInt(contentLength, 10) : -1,
        },
      });
      apiSpan?.end();
      trace?.update({
        output: {
          success: true,
          char_count: charCount,
          audio_size_bytes: contentLength ? parseInt(contentLength, 10) : -1,
          api_latency_ms: apiLatencyMs,
          total_latency_ms: totalLatencyMs,
          estimated_cost_usd: estimatedCost,
        },
      });
      trace?.end();
      await flushTraces();
    };

    // If the response body is a ReadableStream, pipe it through
    if (ttsResponse.body) {
      // Use Next.js after() to flush Opik traces after the response is sent.
      // This keeps the serverless function alive long enough to complete the flush
      // without blocking the audio stream to the client.
      after(completeTrace);

      return new NextResponse(ttsResponse.body, {
        status: 200,
        headers: responseHeaders,
      });
    }

    // Fallback: buffer if no stream (shouldn't happen with fetch)
    const audioBuffer = await ttsResponse.arrayBuffer();
    await completeTrace();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        ...responseHeaders,
        "Content-Length": String(audioBuffer.byteLength),
      },
    });
  } catch (error) {
    const totalLatencyMs = Date.now() - startTime;
    console.error("[TTS] Error:", error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorInfo = {
      exceptionType: error instanceof Error ? error.name : "Error",
      message: errorMessage,
      traceback: error instanceof Error ? (error.stack ?? errorMessage) : errorMessage,
    };

    trace?.update({
      errorInfo,
      output: { error: errorMessage, total_latency_ms: totalLatencyMs },
    });
    trace?.end();

    await traceError("api-tts", error);

    return NextResponse.json(
      { error: "Failed to generate speech" },
      { status: 500 }
    );
  }
}
