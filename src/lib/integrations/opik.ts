import { Opik, Trace, Span } from "opik";
import type { DischargeAnalysis } from "../types/analysis";

let opikClient: Opik | null = null;
let opikDisabled = false; // Flag to disable Opik if it keeps failing

export function getOpikClient(): Opik | null {
  // If Opik has been disabled due to repeated failures, return null
  if (opikDisabled) {
    return null;
  }

  if (!process.env.OPIK_API_KEY) {
    console.warn("OPIK_API_KEY not set - tracing disabled");
    return null;
  }

  if (!opikClient) {
    try {
      opikClient = new Opik({
        apiKey: process.env.OPIK_API_KEY,
        projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
      });
    } catch (e) {
      console.error("[Opik] Failed to initialize client:", e);
      opikDisabled = true;
      return null;
    }
  }

  return opikClient;
}

/**
 * Temporarily disable Opik (e.g., if service is down)
 * The app will continue without tracing
 */
export function disableOpik(): void {
  console.warn("[Opik] Tracing disabled - app will continue without observability");
  opikDisabled = true;
  opikClient = null;
}

/**
 * Re-enable Opik (e.g., after service recovers)
 */
export function enableOpik(): void {
  console.log("[Opik] Tracing re-enabled");
  opikDisabled = false;
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
 *
 * IMPORTANT: This function is designed to NEVER crash the app even if Opik is down.
 * All Opik operations are wrapped in try-catch blocks.
 */
export async function traceAnalysis<T>(
  name: string,
  metadata: TraceMetadata,
  fn: () => Promise<T>,
  options?: { threadId?: string }
): Promise<SpanResult<T>> {
  const startTime = Date.now();

  // Run the actual function FIRST - this is the critical path
  // Opik tracing is secondary and should never block the main operation
  const result = await fn();
  const duration = Date.now() - startTime;

  // Now try to trace to Opik (best effort, never throws)
  const opik = getOpikClient();
  if (!opik) {
    return { result, duration };
  }

  let traceId: string | undefined;

  try {
    const trace = opik.trace({
      name,
      threadId: options?.threadId,
      metadata,
    });

    const span = trace.span({
      name: `${name}-execution`,
      metadata,
    });

    // Update span metadata before ending
    span.update({
      metadata: {
        duration_ms: duration,
        success: true,
        ...extractAnalysisMetrics(result),
      },
    });
    span.end();
    trace.end();

    traceId = trace.data.id;

    // Flush asynchronously - don't wait for it
    flushTraces().catch((e) => {
      console.warn("[Opik] Flush failed:", e);
    });
  } catch (opikError) {
    // Opik failed but we already have the result - just log and continue
    console.warn("[Opik] Tracing failed (non-fatal):", opikError);
  }

  return { result, duration, traceId };
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
  source: "FHIR" | "FDA" | "CMS" | "Guidelines",
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
 *
 * IMPORTANT: This function is designed to NEVER crash the app even if Opik is down.
 * The LLM call runs first, then tracing happens in a best-effort manner.
 */
export async function traceLLMCall<T>(
  operation: string,
  patientId: string,
  llmOptions: LLMTraceOptions,
  fn: () => Promise<T & { tokenUsage?: TokenUsage }>,
  options?: { threadId?: string }
): Promise<SpanResult<T>> {
  const startTime = Date.now();

  // Run the LLM call FIRST - this is the critical path
  const result = await fn();
  const duration = Date.now() - startTime;

  // Now try to trace to Opik (best effort, never throws)
  const opik = getOpikClient();
  if (!opik) {
    return { result, duration };
  }

  // Map provider names to Opik's expected format
  const providerMap: Record<string, string> = {
    gemini: "google_ai",
    groq: "groq",
    huggingface: "huggingface",
    openai: "openai",
    anthropic: "anthropic",
  };

  let traceId: string | undefined;

  try {
    const trace = opik.trace({
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
    const span = trace.span({
      name: `${llmOptions.provider}-${llmOptions.model}`,
      type: "llm",
      model: llmOptions.model,
      provider: providerMap[llmOptions.provider] || llmOptions.provider,
      metadata: {
        patientId,
        operation,
      },
    });

    // Extract token usage from result if available
    const tokenUsage = (result as { tokenUsage?: TokenUsage }).tokenUsage || llmOptions.usage;

    // Update span with token usage — clean camelCase only (TypeScript SDK format)
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

    traceId = trace.data.id;

    // Flush asynchronously - don't wait for it
    flushTraces().catch((e) => {
      console.warn("[Opik] Flush failed:", e);
    });
  } catch (opikError) {
    // Opik failed but we already have the result - just log and continue
    console.warn("[Opik] LLM tracing failed (non-fatal):", opikError);
  }

  return { result, duration, traceId };
}

/**
 * Log a custom evaluation score to Opik
 * Use this for tracking specific metrics like score consistency
 *
 * IMPORTANT: This function never throws - Opik errors are logged and swallowed.
 */
export async function logEvaluationScore(
  name: string,
  patientId: string,
  score: number,
  expectedScore?: number,
  metadata?: Record<string, string | number | boolean>,
  options?: { threadId?: string }
): Promise<void> {
  console.log(`[Evaluation] ${name}: score=${score}, expected=${expectedScore}`);

  const opik = getOpikClient();
  if (!opik) return;

  try {
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

    // Don't await flush - let it happen in background
    flushTraces().catch(() => {});
  } catch (e) {
    console.warn("[Opik] Evaluation logging failed (non-fatal):", e);
  }
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

// Track consecutive flush failures
let flushFailureCount = 0;
const MAX_FLUSH_FAILURES = 3;

/**
 * Flush all pending traces to Opik
 * Call this before shutdown to ensure all data is sent
 *
 * IMPORTANT: This function never throws and includes a timeout to prevent hanging.
 * If Opik service is down, it will disable tracing after repeated failures.
 */
export async function flushTraces(): Promise<void> {
  const opik = getOpikClient();
  if (!opik) return;

  try {
    // Add timeout to prevent hanging if Opik is unresponsive
    const timeoutPromise = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error("Opik flush timeout")), 5000)
    );

    await Promise.race([opik.flush(), timeoutPromise]);

    // Reset failure count on success
    flushFailureCount = 0;
  } catch (e) {
    flushFailureCount++;
    console.warn(`[Opik] Flush failed (attempt ${flushFailureCount}/${MAX_FLUSH_FAILURES}):`, e);

    // Disable Opik after repeated failures to prevent log spam
    if (flushFailureCount >= MAX_FLUSH_FAILURES) {
      console.warn("[Opik] Too many flush failures - disabling tracing for this session");
      disableOpik();
    }
  }
}
