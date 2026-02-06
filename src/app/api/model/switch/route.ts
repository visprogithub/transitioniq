/**
 * Model Switch API
 *
 * POST /api/model/switch
 * - modelId: string - The model ID to switch to
 *
 * Returns the new active model and confirmation
 */

import { NextRequest, NextResponse } from "next/server";
import {
  setActiveModel,
  getActiveModelId,
  getAvailableModels,
  getModelConfig,
} from "@/lib/integrations/llm-provider";
import { resetLLMProvider } from "@/lib/integrations/analysis";
import { traceError } from "@/lib/integrations/opik";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelId } = body as { modelId?: string };

    if (!modelId) {
      return NextResponse.json(
        { error: "modelId is required" },
        { status: 400 }
      );
    }

    // Check if the model is available
    const availableModels = getAvailableModels();
    if (!availableModels.includes(modelId)) {
      const config = getModelConfig(modelId);
      if (!config) {
        return NextResponse.json(
          { error: `Unknown model: ${modelId}` },
          { status: 400 }
        );
      }
      // Model exists but API key not configured
      return NextResponse.json(
        {
          error: `Model ${modelId} requires ${config.provider.toUpperCase()}_API_KEY to be configured`,
        },
        { status: 400 }
      );
    }

    // Switch the active model
    setActiveModel(modelId);

    // Reset the provider to use the new model
    resetLLMProvider();

    const newActiveModel = getActiveModelId();
    const config = getModelConfig(newActiveModel);

    console.log(`[Model] Switched to: ${newActiveModel} (${config?.provider})`);

    return NextResponse.json({
      success: true,
      activeModel: newActiveModel,
      provider: config?.provider,
      message: `Switched to ${newActiveModel}`,
    });
  } catch (error) {
    await traceError("api-model-switch", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to switch model" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const activeModel = getActiveModelId();
  const config = getModelConfig(activeModel);
  const availableModels = getAvailableModels();

  return NextResponse.json({
    activeModel,
    provider: config?.provider,
    availableModels,
  });
}
