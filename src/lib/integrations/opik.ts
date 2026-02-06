import { Opik, Trace, Span } from "opik";
import type { DischargeAnalysis } from "../types/analysis";

/** Re-export Trace type for use in other modules */
export type OpikTrace = Trace;

let opikClient: Opik | null = null;

export function getOpikClient(): Opik | null {
  if (!process.env.OPIK_API_KEY) {
    console.warn("OPIK_API_KEY not set - tracing disabled");
    return null;
  }

  if (!opikClient) {
    opikClient = new Opik({
      apiKey: process.env.OPIK_API_KEY,
      projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
    });
  }

  return opikClient;
}

export interface TraceMetadata {
  patientId?: string;
  dataSource?: string;
  model?: string;
  provider?: string;
  score?: number;
  status?: string;
  riskFactorCount?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LLMTraceOptions {
  model: string;
  provider: string;
  usage?: TokenUsage;
  totalCost?: number;
}

export interface SpanResult<T> {
  result: T;
  duration: number;
  traceId?: string;
}

/**
 * Core tracing function with enhanced metadata for Opik observability
 */
export async function traceAnalysis<T>(
  name: string,
  metadata: TraceMetadata,
  fn: () => Promise<T>,
  options?: { threadId?: string }
): Promise<SpanResult<T>> {
  const opik = getOpikClient();
  const startTime = Date.now();

  if (!opik) {
    const result = await fn();
    return {
      result,
      duration: Date.now() - startTime,
    };
  }

  let trace: Trace | null = null;
  let span: Span | null = null;

  try {
    trace = opik.trace({
      name,
      threadId: options?.threadId,
      metadata,
    });

    span = trace.span({
      name: `${name}-execution`,
      metadata,
    });

    const result = await fn();
    const duration = Date.now() - startTime;

    // Update span metadata before ending (API changed - end takes no args)
    span.update({
      metadata: {
        duration_ms: duration,
        success: true,
        ...extractAnalysisMetrics(result),
      },
    });
    span.end();
    trace.end();

    // Flush to ensure trace is sent
    await flushTraces();

    return {
      result,
      duration,
      traceId: trace.data.id,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    const errorInfo = {
      exceptionType: error instanceof Error ? error.name : "Error",
      message: errorMessage,
      traceback: error instanceof Error ? (error.stack ?? errorMessage) : errorMessage,
    };

    if (span) {
      span.update({
        metadata: { duration_ms: duration, success: false, error: errorMessage },
        errorInfo,
      });
      span.end();
    }
    if (trace) {
      trace.update({ errorInfo });
      trace.end();
    }

    // Flush even on error
    await flushTraces();

    throw error;
  }
}

/**
 * Extract metrics from analysis results for Opik tracking
 */
function extractAnalysisMetrics(result: unknown): Record<string, number | string | boolean> {
  if (!result || typeof result !== "object") return {};

  const analysis = result as Partial<DischargeAnalysis>;

  if (analysis.score !== undefined) {
    return {
      discharge_score: analysis.score,
      discharge_status: analysis.status || "unknown",
      risk_factor_count: analysis.riskFactors?.length || 0,
      high_risk_count: analysis.riskFactors?.filter(r => r.severity === "high").length || 0,
      moderate_risk_count: analysis.riskFactors?.filter(r => r.severity === "moderate").length || 0,
      recommendation_count: analysis.recommendations?.length || 0,
    };
  }

  return {};
}

/**
 * Trace data source calls (FHIR, FDA, CMS, Guidelines)
 */
export async function traceDataSourceCall<T>(
  source: "FHIR" | "FDA" | "FDA-Interactions" | "FDA-BoxedWarnings" | "FDA-Recalls" | "CMS" | "Guidelines" | "MyHealthfinder",
  patientId: string,
  fn: () => Promise<T>,
  options?: { threadId?: string }
): Promise<SpanResult<T>> {
  return traceAnalysis(
    `data-source-${source.toLowerCase()}`,
    {
      patientId,
      dataSource: source,
      category: "data_fetch",
    },
    fn,
    options
  );
}

/**
 * Trace Gemini LLM calls with model information
 * @deprecated Use traceLLMCall instead for proper token/cost tracking
 */
export async function traceGeminiCall<T>(
  operation: string,
  patientId: string,
  fn: () => Promise<T>,
  options?: { threadId?: string }
): Promise<SpanResult<T>> {
  return traceAnalysis(
    `llm-gemini-${operation}`,
    {
      patientId,
      model: "gemini-2.5-flash",
      category: "llm_call",
      operation,
    },
    fn,
    options
  );
}

/**
 * Trace LLM calls with proper token usage and cost tracking for Opik
 * This creates an "llm" type span which enables Opik's token/cost dashboards
 */
export async function traceLLMCall<T>(
  operation: string,
  patientId: string,
  llmOptions: LLMTraceOptions,
  fn: () => Promise<T & { tokenUsage?: TokenUsage }>,
  options?: { threadId?: string }
): Promise<SpanResult<T>> {
  const opik = getOpikClient();
  const startTime = Date.now();

  if (!opik) {
    const result = await fn();
    return {
      result,
      duration: Date.now() - startTime,
    };
  }

  // Map provider names to Opik's expected format
  const providerMap: Record<string, string> = {
    gemini: "google_ai",
    groq: "groq",
    huggingface: "huggingface",
    openai: "openai",
    anthropic: "anthropic",
  };

  let trace: Trace | null = null;
  let span: Span | null = null;

  try {
    trace = opik.trace({
      name: `llm-${operation}`,
      threadId: options?.threadId,
      metadata: {
        patientId,
        model: llmOptions.model,
        provider: llmOptions.provider,
        category: "llm_call",
        operation,
      },
    });

    // Create LLM-type span for proper token tracking
    span = trace.span({
      name: `${llmOptions.provider}-${llmOptions.model}`,
      type: "llm",
      model: llmOptions.model,
      provider: providerMap[llmOptions.provider] || llmOptions.provider,
      metadata: {
        patientId,
        operation,
      },
    });

    const result = await fn();
    const duration = Date.now() - startTime;

    // Extract token usage from result if available
    const tokenUsage = (result as { tokenUsage?: TokenUsage }).tokenUsage || llmOptions.usage;

    // Update span with token usage — clean camelCase only (TypeScript SDK format)
    // Mixing snake_case + camelCase caused schema validation issues in Opik dashboard
    console.log(`[Opik] traceLLMCall tokenUsage:`, JSON.stringify(tokenUsage));
    span.update({
      usage: tokenUsage ? {
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
      } : undefined,
      totalEstimatedCost: llmOptions.totalCost,
      model: llmOptions.model,
      provider: providerMap[llmOptions.provider] || llmOptions.provider,
      metadata: {
        duration_ms: duration,
        success: true,
        ...extractAnalysisMetrics(result),
      },
    });
    span.end();
    trace.end();

    await flushTraces();

    return {
      result,
      duration,
      traceId: trace.data.id,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    const errorInfo = {
      exceptionType: error instanceof Error ? error.name : "Error",
      message: errorMessage,
      traceback: error instanceof Error ? (error.stack ?? errorMessage) : errorMessage,
    };

    if (span) {
      span.update({
        metadata: { duration_ms: duration, success: false, error: errorMessage },
        errorInfo,
      });
      span.end();
    }
    if (trace) {
      trace.update({ errorInfo });
      trace.end();
    }

    await flushTraces();

    throw error;
  }
}

/**
 * Log a custom evaluation score to Opik
 * Use this for tracking specific metrics like score consistency
 */
export async function logEvaluationScore(
  name: string,
  patientId: string,
  score: number,
  expectedScore?: number,
  metadata?: Record<string, string | number | boolean>,
  options?: { threadId?: string }
): Promise<void> {
  const opik = getOpikClient();
  if (!opik) {
    console.log(`[Evaluation] ${name}: score=${score}, expected=${expectedScore}`);
    return;
  }

  const trace = opik.trace({
    name: `evaluation-${name}`,
    threadId: options?.threadId,
    metadata: {
      patientId,
      category: "evaluation",
      ...metadata,
    },
  });

  const span = trace.span({
    name: `${name}-score`,
    metadata: {
      actual_score: score,
      expected_score: expectedScore,
      score_difference: expectedScore !== undefined ? Math.abs(score - expectedScore) : undefined,
      within_tolerance: expectedScore !== undefined ? Math.abs(score - expectedScore) <= 5 : undefined,
    },
  });

  span.update({
    metadata: {
      evaluation_type: name,
      success: true,
      passed: expectedScore !== undefined ? Math.abs(score - expectedScore) <= 5 : true,
    },
  });
  span.end();
  trace.end();
  await flushTraces();
}

/**
 * Run batch evaluation on test cases
 * Useful for demonstrating Opik evaluation capabilities
 */
export async function runEvaluation(
  testCases: Array<{
    patientId: string;
    expectedScore: number;
    expectedStatus: string;
  }>,
  analyzeFunction: (patientId: string) => Promise<DischargeAnalysis>
): Promise<{
  totalCases: number;
  passed: number;
  failed: number;
  averageScoreDiff: number;
}> {
  let passed = 0;
  let failed = 0;
  let totalScoreDiff = 0;

  for (const testCase of testCases) {
    try {
      const result = await analyzeFunction(testCase.patientId);
      const scoreDiff = Math.abs(result.score - testCase.expectedScore);
      const statusMatch = result.status === testCase.expectedStatus;

      totalScoreDiff += scoreDiff;

      if (scoreDiff <= 10 && statusMatch) {
        passed++;
      } else {
        failed++;
      }

      // Log individual evaluation
      await logEvaluationScore(
        "discharge-score-consistency",
        testCase.patientId,
        result.score,
        testCase.expectedScore,
        {
          status_match: statusMatch,
          expected_status: testCase.expectedStatus,
          actual_status: result.status,
        }
      );
    } catch (error) {
      failed++;
      console.error(`Evaluation failed for ${testCase.patientId}:`, error);
    }
  }

  return {
    totalCases: testCases.length,
    passed,
    failed,
    averageScoreDiff: testCases.length > 0 ? totalScoreDiff / testCases.length : 0,
  };
}

/**
 * Log an error as an Opik trace for observability
 *
 * Lightweight utility for catch blocks — creates a trace + error span,
 * flushes, and NEVER throws (swallows its own errors so callers aren't affected).
 *
 * @param source - Identifier for where the error occurred (e.g. "api-analyze")
 * @param error  - The caught error (unknown type safe)
 * @param metadata - Optional extra metadata (patientId, threadId, etc.)
 */
export async function traceError(
  source: string,
  error: unknown,
  metadata?: TraceMetadata & { threadId?: string }
): Promise<void> {
  try {
    const opik = getOpikClient();
    if (!opik) return;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    const errorInfo = {
      exceptionType: error instanceof Error ? error.name : "Error",
      message: errorMessage,
      traceback: errorStack ?? errorMessage,
    };

    const { threadId, ...restMetadata } = metadata || {};
    const trace = opik.trace({
      name: `error-${source}`,
      threadId,
      metadata: {
        category: "error",
        source,
        ...restMetadata,
      },
    });

    const span = trace.span({
      name: "error-details",
      metadata: {
        success: false,
        error: errorMessage,
        stack: errorStack,
        source,
        timestamp: new Date().toISOString(),
      },
    });

    // Set errorInfo so Opik dashboard counts this as an error trace
    span.update({ errorInfo });
    span.end();
    trace.update({ errorInfo });
    trace.end();

    await flushTraces();
  } catch {
    // Never throw from error tracing — this is a best-effort utility
    console.error(`[Opik] Failed to trace error from ${source}:`, error);
  }
}

/**
 * Flush all pending traces to Opik
 * Call this before shutdown to ensure all data is sent
 */
export async function flushTraces(): Promise<void> {
  const opik = getOpikClient();
  if (!opik) return;

  try {
    await opik.flush();
  } catch (e) {
    console.error("Failed to flush Opik traces:", e);
  }
}
