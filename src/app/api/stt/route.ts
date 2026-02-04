/**
 * Speech-to-Text API — OpenAI Whisper
 *
 * Server-side STT fallback for browsers that don't support the Web Speech API
 * (e.g. Firefox). Accepts a WebM/OGG audio blob and returns the transcript.
 *
 * Rate-limited via the "stt" category (env-configurable: STT_RATE_LIMIT_MAX,
 * STT_RATE_LIMIT_WINDOW_MIN).
 *
 * Opik tracing: logs latency, audio size, estimated cost, and errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { getOpikClient, traceError, flushTraces } from "@/lib/integrations/opik";

const WHISPER_MODEL = "whisper-1";
// OpenAI Whisper pricing: $0.006 per minute of audio
const COST_PER_MINUTE = 0.006;
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB — OpenAI's limit

export async function POST(request: NextRequest) {
  // Demo rate limit for STT (env-configurable)
  const blocked = applyRateLimit(request, "stt");
  if (blocked) return blocked;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Speech recognition is not configured (missing OPENAI_API_KEY)" },
      { status: 503 }
    );
  }

  const opik = getOpikClient();
  const startTime = Date.now();

  const trace = opik?.trace({
    name: "stt-transcription",
    metadata: {
      model: WHISPER_MODEL,
      category: "stt",
    },
  });

  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) {
      trace?.update({ output: { error: "missing_audio" } });
      trace?.end();
      return NextResponse.json(
        { error: "Missing audio file" },
        { status: 400 }
      );
    }

    if (audioFile.size > MAX_AUDIO_SIZE) {
      trace?.update({ output: { error: "audio_too_large", size: audioFile.size } });
      trace?.end();
      return NextResponse.json(
        { error: "Audio file too large (max 25MB)" },
        { status: 413 }
      );
    }

    // Estimate duration from size (rough: ~16kbps for webm/opus)
    const estimatedMinutes = (audioFile.size / (16 * 1024 / 8)) / 60;
    const estimatedCost = estimatedMinutes * COST_PER_MINUTE;

    trace?.update({
      metadata: {
        audio_size_bytes: audioFile.size,
        audio_type: audioFile.type,
        estimated_duration_min: estimatedMinutes,
        estimated_cost_usd: estimatedCost,
      },
    });

    // Build multipart form for OpenAI Whisper API
    const whisperForm = new FormData();
    whisperForm.append("file", audioFile, "recording.webm");
    whisperForm.append("model", WHISPER_MODEL);
    whisperForm.append("language", "en");
    whisperForm.append("response_format", "json");

    const apiSpan = trace?.span({
      name: `openai-${WHISPER_MODEL}`,
      type: "llm",
      model: WHISPER_MODEL,
      provider: "openai",
      metadata: {
        audio_size_bytes: audioFile.size,
        audio_type: audioFile.type,
      },
    });

    const apiStartTime = Date.now();

    const whisperResponse = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: whisperForm,
      }
    );

    const apiLatencyMs = Date.now() - apiStartTime;

    if (!whisperResponse.ok) {
      const errText = await whisperResponse.text();
      console.error("[STT] Whisper error:", whisperResponse.status, errText);

      apiSpan?.update({
        metadata: {
          success: false,
          http_status: whisperResponse.status,
          api_latency_ms: apiLatencyMs,
          error: errText.slice(0, 500),
        },
      });
      apiSpan?.end();
      trace?.update({
        output: { error: "whisper_api_error", status: whisperResponse.status },
      });
      trace?.end();
      await flushTraces();

      return NextResponse.json(
        { error: "Speech recognition failed" },
        { status: 502 }
      );
    }

    const result = await whisperResponse.json();
    const transcript = result.text || "";
    const totalLatencyMs = Date.now() - startTime;

    apiSpan?.update({
      totalEstimatedCost: estimatedCost,
      metadata: {
        success: true,
        api_latency_ms: apiLatencyMs,
        transcript_length: transcript.length,
      },
    });
    apiSpan?.end();

    trace?.update({
      output: {
        success: true,
        transcript_length: transcript.length,
        audio_size_bytes: audioFile.size,
        api_latency_ms: apiLatencyMs,
        total_latency_ms: totalLatencyMs,
        estimated_cost_usd: estimatedCost,
      },
    });
    trace?.end();
    await flushTraces();

    return NextResponse.json({ transcript });
  } catch (error) {
    const totalLatencyMs = Date.now() - startTime;
    console.error("[STT] Error:", error);

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

    await traceError("api-stt", error);

    return NextResponse.json(
      { error: "Failed to transcribe speech" },
      { status: 500 }
    );
  }
}
