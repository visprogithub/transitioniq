/**
 * Capabilities API — Lightweight feature-flag endpoint
 *
 * Returns which features are available based on configured API keys.
 * Used by the frontend to hide/disable features that won't work
 * (e.g., voice buttons when OPENAI_API_KEY is missing).
 *
 * This endpoint is intentionally NOT gated by NEXT_PUBLIC_DISABLE_EVALUATION
 * because it's needed for basic UI feature detection, not evaluation.
 */

import { NextResponse } from "next/server";
import {
  getAvailableModels,
  getAllModels,
  getConfiguredProviders,
  getActiveModelId,
  getModelConfig,
} from "@/lib/integrations/llm-provider";

export async function GET() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const availableModels = getAvailableModels();
  const allModels = getAllModels();
  const configuredProviders = getConfiguredProviders();

  // Build per-model info (same shape ModelSelector expects)
  const allModelInfo = allModels.map((modelId) => {
    const config = getModelConfig(modelId);
    return {
      id: modelId,
      provider: config?.provider || "unknown",
      available: availableModels.includes(modelId),
      displayName: modelId,
    };
  });

  return NextResponse.json({
    voice: {
      ttsEnabled: hasOpenAI,
      sttEnabled: hasOpenAI,
      message: hasOpenAI
        ? null
        : "Voice features require OPENAI_API_KEY — add it to .env.local to enable TTS & mic input.",
    },
    models: {
      available: availableModels.length > 0,
      count: availableModels.length,
      providers: configuredProviders,
      activeModel: getActiveModelId(),
      allModels: allModelInfo,
      message:
        availableModels.length > 0
          ? null
          : "No LLM models available — add at least one API key (OPENAI_API_KEY, GEMINI_API_KEY, or HF_API_KEY) to .env.local.",
    },
  });
}
