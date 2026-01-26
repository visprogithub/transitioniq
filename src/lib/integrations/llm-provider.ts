/**
 * LLM Provider Abstraction - Swappable models for evaluation
 *
 * This module provides a unified interface for different LLM providers,
 * enabling A/B testing and model comparison via Opik.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Opik } from "opik";

// Model configuration
export type ModelProvider = "gemini" | "openai" | "anthropic";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: ModelProvider;
  latencyMs: number;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// Default model configs
// Note: Use correct model IDs from Google AI Studio
// See: https://ai.google.dev/gemini-api/docs/models/gemini
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "gemini-2.0-flash-exp": {
    provider: "gemini",
    modelId: "gemini-2.0-flash-exp",
    apiKey: process.env.GEMINI_API_KEY || "",
    temperature: 0.7,
  },
  "gemini-1.5-flash-latest": {
    provider: "gemini",
    modelId: "gemini-1.5-flash-latest",
    apiKey: process.env.GEMINI_API_KEY || "",
    temperature: 0.7,
  },
  "gemini-1.5-pro-latest": {
    provider: "gemini",
    modelId: "gemini-1.5-pro-latest",
    apiKey: process.env.GEMINI_API_KEY || "",
    temperature: 0.7,
  },
};

// Active model (can be changed for A/B testing)
let activeModelId = process.env.LLM_MODEL || "gemini-2.0-flash-exp";

/**
 * Get the current active model ID
 */
export function getActiveModelId(): string {
  return activeModelId;
}

/**
 * Set the active model for evaluation
 */
export function setActiveModel(modelId: string): void {
  if (!MODEL_CONFIGS[modelId]) {
    throw new Error(`Unknown model: ${modelId}. Available: ${Object.keys(MODEL_CONFIGS).join(", ")}`);
  }
  activeModelId = modelId;
  console.log(`[LLM] Active model set to: ${modelId}`);
}

/**
 * Get available models for evaluation
 */
export function getAvailableModels(): string[] {
  return Object.keys(MODEL_CONFIGS);
}

/**
 * LLM Provider class with Opik tracing
 */
export class LLMProvider {
  private config: ModelConfig;
  private opik: Opik | null = null;

  constructor(modelId?: string) {
    const id = modelId || activeModelId;
    const config = MODEL_CONFIGS[id];

    if (!config) {
      throw new Error(`Unknown model: ${id}`);
    }

    if (!config.apiKey) {
      throw new Error(`API key not configured for ${config.provider}. Set GEMINI_API_KEY.`);
    }

    this.config = config;

    // Initialize Opik for tracing
    if (process.env.OPIK_API_KEY) {
      this.opik = new Opik({
        apiKey: process.env.OPIK_API_KEY,
        projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
      });
    }
  }

  /**
   * Generate content with full Opik tracing
   */
  async generate(
    prompt: string,
    options?: {
      traceId?: string;
      spanName?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<LLMResponse> {
    const startTime = Date.now();

    // Create Opik trace for this generation
    const trace = this.opik?.trace({
      name: options?.spanName || "llm-generation",
      input: {
        prompt_length: prompt.length,
        prompt_preview: prompt.slice(0, 500),
        model: this.config.modelId,
        provider: this.config.provider,
        temperature: this.config.temperature,
      },
      metadata: {
        ...options?.metadata,
        model_id: this.config.modelId,
        provider: this.config.provider,
      },
    });

    try {
      let content: string;
      let tokenUsage: LLMResponse["tokenUsage"];

      if (this.config.provider === "gemini") {
        const result = await this.generateGemini(prompt);
        content = result.content;
        tokenUsage = result.tokenUsage;
      } else {
        throw new Error(`Provider ${this.config.provider} not yet implemented`);
      }

      const latencyMs = Date.now() - startTime;

      // Log success to Opik
      if (trace) {
        trace.update({
          output: {
            content_length: content.length,
            content_preview: content.slice(0, 500),
            latency_ms: latencyMs,
            token_usage: tokenUsage,
          },
          metadata: {
            success: true,
            latency_ms: latencyMs,
          },
        });
        trace.end();
        await this.opik?.flush();
      }

      return {
        content,
        model: this.config.modelId,
        provider: this.config.provider,
        latencyMs,
        tokenUsage,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Check for rate limit errors
      const isRateLimited = errorMessage.includes("429") || errorMessage.includes("quota") || errorMessage.includes("Too Many Requests");

      // Log error to Opik
      if (trace) {
        trace.update({
          output: {
            error: errorMessage,
          },
          metadata: {
            success: false,
            error: true,
            rate_limited: isRateLimited,
            latency_ms: latencyMs,
          },
        });
        trace.end();
        await this.opik?.flush();
      }

      // Provide more helpful error message for rate limits
      if (isRateLimited) {
        throw new Error(`Rate limit exceeded for ${this.config.modelId}. Please wait and try again, or use a paid API key.`);
      }

      throw error;
    }
  }

  /**
   * Generate using Gemini
   */
  private async generateGemini(prompt: string): Promise<{
    content: string;
    tokenUsage?: LLMResponse["tokenUsage"];
  }> {
    const genAI = new GoogleGenerativeAI(this.config.apiKey);
    const model = genAI.getGenerativeModel({
      model: this.config.modelId,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxTokens,
      },
    });

    const result = await model.generateContent(prompt);
    const response = result.response;

    // Extract token usage if available
    const usageMetadata = response.usageMetadata;
    const tokenUsage = usageMetadata
      ? {
          promptTokens: usageMetadata.promptTokenCount || 0,
          completionTokens: usageMetadata.candidatesTokenCount || 0,
          totalTokens: usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return {
      content: response.text(),
      tokenUsage,
    };
  }

  /**
   * Get model info
   */
  getModelInfo(): { modelId: string; provider: ModelProvider } {
    return {
      modelId: this.config.modelId,
      provider: this.config.provider,
    };
  }
}

/**
 * Create a provider instance for the active model
 */
export function createLLMProvider(modelId?: string): LLMProvider {
  return new LLMProvider(modelId);
}

/**
 * Reset the LLM provider (for model switching during evaluation)
 */
export function resetLLMProvider(): void {
  // No-op at this level - each call creates a new provider
  // This is here for API compatibility with gemini.ts
}

/**
 * Run a model comparison experiment
 */
export async function runModelComparison(
  prompt: string,
  modelIds: string[],
  metadata?: Record<string, unknown>
): Promise<Array<{ modelId: string; response: LLMResponse | null; error?: string }>> {
  const results: Array<{ modelId: string; response: LLMResponse | null; error?: string }> = [];

  for (const modelId of modelIds) {
    try {
      const provider = new LLMProvider(modelId);
      const response = await provider.generate(prompt, {
        spanName: `comparison-${modelId}`,
        metadata: {
          ...metadata,
          experiment_type: "model_comparison",
          comparing_models: modelIds,
        },
      });
      results.push({ modelId, response });
    } catch (error) {
      results.push({
        modelId,
        response: null,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}
