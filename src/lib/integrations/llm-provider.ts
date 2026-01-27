/**
 * LLM Provider Abstraction - Swappable models for evaluation
 *
 * This module provides a unified interface for different LLM providers,
 * enabling A/B testing and model comparison via Opik.
 *
 * Supported providers:
 * - Gemini (Google) - requires GEMINI_API_KEY
 * - Hugging Face Inference API - requires HF_API_KEY (free tier available)
 * - OpenAI - requires OPENAI_API_KEY
 * - Anthropic - requires ANTHROPIC_API_KEY
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { Opik } from "opik";

// Model configuration
export type ModelProvider = "gemini" | "huggingface" | "openai" | "anthropic";

export interface ModelConfig {
  provider: ModelProvider;
  modelId: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  // HuggingFace specific
  hfEndpoint?: string;
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

/**
 * Error type for rate limits and usage limits
 * Frontend can check error.code to show appropriate UI
 */
export interface RateLimitError extends Error {
  code: "RATE_LIMITED" | "OUT_OF_CREDITS";
  modelId: string;
  provider: ModelProvider;
}

/**
 * Check if an error is a rate limit or usage limit error
 */
export function isModelLimitError(error: unknown): error is RateLimitError {
  return (
    error instanceof Error &&
    "code" in error &&
    ((error as RateLimitError).code === "RATE_LIMITED" ||
     (error as RateLimitError).code === "OUT_OF_CREDITS")
  );
}

// Default model configs
// Includes Gemini 2.0 Flash, HuggingFace, OpenAI GPT-4o Mini, and Anthropic
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  // === GEMINI MODELS (requires GEMINI_API_KEY) ===
  // Free tier: 5 RPM for flash, 15 RPM for flash-lite
  "gemini-2.0-flash": {
    provider: "gemini",
    modelId: "gemini-2.0-flash",
    apiKey: process.env.GEMINI_API_KEY || "",
    temperature: 0.7,
  },
  // Flash-Lite has higher free tier limits (15 RPM vs 5 RPM)
  "gemini-2.0-flash-lite": {
    provider: "gemini",
    modelId: "gemini-2.0-flash-lite",
    apiKey: process.env.GEMINI_API_KEY || "",
    temperature: 0.7,
  },

  // === HUGGING FACE MODELS (requires HF_API_KEY - free tier) ===
  // Get free API key at: https://huggingface.co/settings/tokens
  // Uses router.huggingface.co/v1/chat/completions (OpenAI-compatible endpoint)
  "hf-qwen-7b": {
    provider: "huggingface",
    modelId: "Qwen/Qwen2.5-7B-Instruct",
    apiKey: process.env.HF_API_KEY || "",
    temperature: 0.7,
    maxTokens: 2048,
  },
  "hf-llama-3.2-3b": {
    provider: "huggingface",
    modelId: "meta-llama/Llama-3.2-3B-Instruct",
    apiKey: process.env.HF_API_KEY || "",
    temperature: 0.7,
    maxTokens: 2048,
  },

  // === OPENAI MODELS (requires OPENAI_API_KEY) ===
  // Uses cheapest model (gpt-4o-mini)
  "openai-gpt-4o-mini": {
    provider: "openai",
    modelId: "gpt-4o-mini",
    apiKey: process.env.OPENAI_API_KEY || "",
    temperature: 0.7,
    maxTokens: 4096,
  },

  // === ANTHROPIC MODELS (requires ANTHROPIC_API_KEY) ===
  // Uses cheapest model by default (claude-3-haiku)
  "claude-3-haiku": {
    provider: "anthropic",
    modelId: "claude-3-haiku-20240307",
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    temperature: 0.7,
    maxTokens: 4096,
  },
  "claude-3-sonnet": {
    provider: "anthropic",
    modelId: "claude-3-sonnet-20240229",
    apiKey: process.env.ANTHROPIC_API_KEY || "",
    temperature: 0.7,
    maxTokens: 4096,
  },
};

// Active model storage using globalThis to persist across Next.js module reloads
// This fixes the issue where module-level variables get cached and stale
declare global {
  // eslint-disable-next-line no-var
  var __transitioniq_active_model: string | undefined;
}

// Default model priority: OpenAI > HuggingFace > Anthropic > Gemini (Gemini has strict rate limits on free tier)
function getDefaultModelId(): string {
  return process.env.LLM_MODEL ||
    (process.env.OPENAI_API_KEY ? "openai-gpt-4o-mini" :
     process.env.HF_API_KEY ? "hf-qwen-7b" :
     process.env.ANTHROPIC_API_KEY ? "claude-3-haiku" :
     process.env.GEMINI_API_KEY ? "gemini-2.0-flash-lite" : "openai-gpt-4o-mini");
}

// Initialize globalThis storage if not set
if (!globalThis.__transitioniq_active_model) {
  globalThis.__transitioniq_active_model = getDefaultModelId();
}

/**
 * Get the current active model ID
 * Uses globalThis to persist across Next.js module reloads
 */
export function getActiveModelId(): string {
  return globalThis.__transitioniq_active_model || getDefaultModelId();
}

/**
 * Set the active model for evaluation
 * Uses globalThis to persist across Next.js module reloads
 */
export function setActiveModel(modelId: string): void {
  if (!MODEL_CONFIGS[modelId]) {
    throw new Error(`Unknown model: ${modelId}. Available: ${Object.keys(MODEL_CONFIGS).join(", ")}`);
  }
  globalThis.__transitioniq_active_model = modelId;
  console.log(`[LLM] Active model set to: ${modelId} (stored in globalThis)`);
}

/**
 * Get all defined models (including unconfigured ones)
 */
export function getAllModels(): string[] {
  return Object.keys(MODEL_CONFIGS);
}

/**
 * Get only models with valid API keys configured
 */
export function getAvailableModels(): string[] {
  return Object.entries(MODEL_CONFIGS)
    .filter(([, config]) => !!config.apiKey)
    .map(([name]) => name);
}

/**
 * Get model configuration (for display purposes)
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_CONFIGS[modelId];
}

/**
 * Check which providers have API keys configured
 */
export function getConfiguredProviders(): ModelProvider[] {
  const providers = new Set<ModelProvider>();
  if (process.env.GEMINI_API_KEY) providers.add("gemini");
  if (process.env.HF_API_KEY) providers.add("huggingface");
  if (process.env.OPENAI_API_KEY) providers.add("openai");
  if (process.env.ANTHROPIC_API_KEY) providers.add("anthropic");
  return Array.from(providers);
}

/**
 * LLM Provider class with Opik tracing
 */
export class LLMProvider {
  private config: ModelConfig;
  private opik: Opik | null = null;

  constructor(modelId?: string) {
    const id = modelId || getActiveModelId();
    const config = MODEL_CONFIGS[id];

    if (!config) {
      throw new Error(`Unknown model: ${id}`);
    }

    if (!config.apiKey) {
      const envVarMap: Record<ModelProvider, string> = {
        gemini: "GEMINI_API_KEY",
        huggingface: "HF_API_KEY",
        openai: "OPENAI_API_KEY",
        anthropic: "ANTHROPIC_API_KEY",
      };
      throw new Error(`API key not configured for ${config.provider}. Set ${envVarMap[config.provider]}.`);
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
   *
   * Opik expects:
   * - type: "llm" for LLM spans
   * - model: the model ID
   * - provider: the provider name (matches LLMProvider enum)
   * - usage: { prompt_tokens, completion_tokens, total_tokens } (OpenAI format)
   * - totalCost: optional manual cost in USD
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
      },
      metadata: {
        ...options?.metadata,
        model_id: this.config.modelId,
        provider: this.config.provider,
      },
    });

    // Create an LLM span for proper token/cost tracking
    // Opik requires type: "llm", model, and provider for cost calculation
    const llmSpan = trace?.span({
      name: `${this.config.provider}-${this.config.modelId}`,
      type: "llm",
      model: this.config.modelId,
      provider: this.mapProviderToOpik(this.config.provider),
      input: {
        prompt: prompt.slice(0, 1000), // Truncate for display
      },
      metadata: {
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      },
    });

    try {
      let content: string;
      let tokenUsage: LLMResponse["tokenUsage"];

      if (this.config.provider === "gemini") {
        const result = await this.generateGemini(prompt);
        content = result.content;
        tokenUsage = result.tokenUsage;
      } else if (this.config.provider === "huggingface") {
        const result = await this.generateHuggingFace(prompt);
        content = result.content;
        tokenUsage = result.tokenUsage;
      } else if (this.config.provider === "openai") {
        const result = await this.generateOpenAI(prompt);
        content = result.content;
        tokenUsage = result.tokenUsage;
      } else if (this.config.provider === "anthropic") {
        const result = await this.generateAnthropic(prompt);
        content = result.content;
        tokenUsage = result.tokenUsage;
      } else {
        throw new Error(`Provider ${this.config.provider} not yet implemented`);
      }

      const latencyMs = Date.now() - startTime;

      // Calculate estimated cost based on token usage
      const estimatedCost = tokenUsage ? this.estimateCost(tokenUsage) : undefined;

      // Log token usage for debugging Opik dashboards
      if (tokenUsage) {
        console.log(`[LLM] Token usage for ${this.config.modelId}: prompt=${tokenUsage.promptTokens}, completion=${tokenUsage.completionTokens}, total=${tokenUsage.totalTokens}, cost=$${estimatedCost?.toFixed(6) || "N/A"}`);
      } else {
        console.log(`[LLM] No token usage returned from ${this.config.provider} - ${this.config.modelId}`);
      }

      // Update LLM span with usage data (Opik uses camelCase keys)
      if (llmSpan) {
        llmSpan.update({
          output: {
            response: content.slice(0, 1000), // Truncate for display
          },
          // Pass usage in Opik's expected format (camelCase keys)
          // See: https://www.comet.com/docs/opik/tracing/log_traces
          usage: tokenUsage ? {
            promptTokens: tokenUsage.promptTokens,
            completionTokens: tokenUsage.completionTokens,
            totalTokens: tokenUsage.totalTokens,
          } : undefined,
          // Set total estimated cost if we calculated it
          totalEstimatedCost: estimatedCost,
          metadata: {
            success: true,
            latency_ms: latencyMs,
          },
        });
        llmSpan.end();
      }

      // Update trace with summary
      if (trace) {
        trace.update({
          output: {
            content_length: content.length,
            content_preview: content.slice(0, 500),
            latency_ms: latencyMs,
            token_usage: tokenUsage,
            estimated_cost_usd: estimatedCost,
          },
          metadata: {
            success: true,
            latency_ms: latencyMs,
            total_tokens: tokenUsage?.totalTokens,
            estimated_cost_usd: estimatedCost,
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

      // Check for rate limit / quota errors
      const isRateLimited = errorMessage.includes("429") ||
        errorMessage.includes("quota") ||
        errorMessage.includes("Too Many Requests") ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("RESOURCE_EXHAUSTED");

      // Check for out of credits/usage errors
      const isOutOfCredits = errorMessage.includes("insufficient_quota") ||
        errorMessage.includes("billing") ||
        errorMessage.includes("credit") ||
        errorMessage.includes("usage limit");

      // Log error to LLM span
      if (llmSpan) {
        llmSpan.update({
          output: {
            error: errorMessage,
          },
          metadata: {
            success: false,
            error: true,
            rate_limited: isRateLimited,
            out_of_credits: isOutOfCredits,
            latency_ms: latencyMs,
          },
        });
        llmSpan.end();
      }

      // Log error to trace
      if (trace) {
        trace.update({
          output: {
            error: errorMessage,
          },
          metadata: {
            success: false,
            error: true,
            rate_limited: isRateLimited,
            out_of_credits: isOutOfCredits,
            latency_ms: latencyMs,
          },
        });
        trace.end();
        await this.opik?.flush();
      }

      // Provide user-friendly error messages for rate limits and quota issues
      // Include special markers so frontend can detect and prompt user to switch models
      if (isRateLimited) {
        const error = new Error(`Model rate limited (${this.config.modelId}). Please try again later or select a different model.`);
        (error as RateLimitError).code = "RATE_LIMITED";
        (error as RateLimitError).modelId = this.config.modelId;
        (error as RateLimitError).provider = this.config.provider;
        throw error;
      }

      if (isOutOfCredits) {
        const error = new Error(`Model out of usage/credits (${this.config.modelId}). Please add credits or select a different model.`);
        (error as RateLimitError).code = "OUT_OF_CREDITS";
        (error as RateLimitError).modelId = this.config.modelId;
        (error as RateLimitError).provider = this.config.provider;
        throw error;
      }

      throw error;
    }
  }

  /**
   * Map our provider names to Opik's LLMProvider enum values
   * Opik expects specific provider names for cost calculation
   */
  private mapProviderToOpik(provider: ModelProvider): string {
    const providerMap: Record<string, string> = {
      gemini: "google_ai",
      huggingface: "huggingface",
      openai: "openai",
      anthropic: "anthropic",
    };
    return providerMap[provider] || provider;
  }

  /**
   * Estimate cost based on token usage and model
   * Prices are approximate and in USD per 1K tokens
   * Note: HuggingFace free tier has nominal costs for tracking purposes
   */
  private estimateCost(usage: NonNullable<LLMResponse["tokenUsage"]>): number {
    // Pricing per 1K tokens (approximate, as of early 2025)
    // HuggingFace uses nominal pricing for Opik dashboard visibility
    const pricing: Record<string, { input: number; output: number }> = {
      // Gemini
      "gemini-2.0-flash": { input: 0.00010, output: 0.00040 },
      "gemini-2.0-flash-lite": { input: 0.000075, output: 0.00030 },
      // HuggingFace (free tier - using nominal costs for tracking)
      "Qwen/Qwen2.5-7B-Instruct": { input: 0.00005, output: 0.00010 },
      "meta-llama/Llama-3.2-3B-Instruct": { input: 0.00003, output: 0.00006 },
      // OpenAI
      "gpt-4o-mini": { input: 0.00015, output: 0.00060 },
      // Anthropic
      "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
      "claude-3-sonnet-20240229": { input: 0.00300, output: 0.01500 },
    };

    const modelPricing = pricing[this.config.modelId];
    if (!modelPricing) {
      // Default to a small cost for unknown models
      return (usage.promptTokens * 0.0001 + usage.completionTokens * 0.0002) / 1000;
    }

    const inputCost = (usage.promptTokens / 1000) * modelPricing.input;
    const outputCost = (usage.completionTokens / 1000) * modelPricing.output;

    return inputCost + outputCost;
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
   * Generate using HuggingFace Inference Providers API
   * Uses router.huggingface.co/v1/chat/completions (OpenAI-compatible)
   * Docs: https://huggingface.co/docs/inference-providers/en/tasks/chat-completion
   */
  private async generateHuggingFace(prompt: string): Promise<{
    content: string;
    tokenUsage?: LLMResponse["tokenUsage"];
  }> {
    // Use OpenAI-compatible chat completions endpoint
    // The model is specified in the request body, not in the URL
    const endpoint = "https://router.huggingface.co/v1/chat/completions";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.modelId,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 2048,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 503) {
        throw new Error(`HuggingFace model is loading. Please try again in a few seconds.`);
      }
      if (response.status === 404) {
        throw new Error(`HuggingFace model not found or not available for inference: ${this.config.modelId}`);
      }
      throw new Error(`HuggingFace API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const usage = data.usage;

    return {
      content,
      tokenUsage: usage
        ? {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          }
        : undefined,
    };
  }

  /**
   * Generate using OpenAI API
   * Docs: https://platform.openai.com/docs/api-reference/chat
   */
  private async generateOpenAI(prompt: string): Promise<{
    content: string;
    tokenUsage?: LLMResponse["tokenUsage"];
  }> {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.modelId,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 4096,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    const usage = data.usage;

    return {
      content,
      tokenUsage: usage
        ? {
            promptTokens: usage.prompt_tokens || 0,
            completionTokens: usage.completion_tokens || 0,
            totalTokens: usage.total_tokens || 0,
          }
        : undefined,
    };
  }

  /**
   * Generate using Anthropic API
   * Docs: https://docs.anthropic.com/en/api/messages
   */
  private async generateAnthropic(prompt: string): Promise<{
    content: string;
    tokenUsage?: LLMResponse["tokenUsage"];
  }> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.config.modelId,
        max_tokens: this.config.maxTokens || 4096,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    // Anthropic returns content as an array of content blocks
    const content = data.content?.[0]?.text || "";
    const usage = data.usage;

    return {
      content,
      tokenUsage: usage
        ? {
            promptTokens: usage.input_tokens || 0,
            completionTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          }
        : undefined,
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
