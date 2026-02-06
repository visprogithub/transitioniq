/**
 * API Route Helpers - Common utilities for API route handlers
 * Reduces duplication across analyze, generate-plan, patient-chat routes
 */

import { setActiveModel, resetLLMProvider } from "@/lib/integrations/llm-provider";
import type { OpikTrace } from "@/lib/integrations/opik";

/**
 * Error info structure for Opik tracing
 */
export interface ErrorInfo {
  exceptionType: string;
  message: string;
  traceback: string;
}

/**
 * Build error info object from any error type
 * Used for consistent Opik error logging across all routes
 */
export function buildErrorInfo(error: unknown): ErrorInfo {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return {
    exceptionType: error instanceof Error ? error.name : "Error",
    message: errorMessage,
    traceback: error instanceof Error ? (error.stack ?? errorMessage) : errorMessage,
  };
}

/**
 * Log error to Opik trace with consistent structure
 * Automatically ends the trace after logging
 */
export function logErrorTrace(trace: OpikTrace | undefined | null, error: unknown): void {
  if (!trace) return;

  const errorInfo = buildErrorInfo(error);
  trace.update({
    errorInfo,
    output: { error: errorInfo.message },
  });
  trace.end();
}

/**
 * Pin active model for this request
 * Returns true if pinning succeeded, false if it failed (but continues with current model)
 *
 * @param modelId - Optional model ID to pin
 * @param context - Context string for logging (e.g., "Analyze", "Generate Plan")
 */
export function pinModelForRequest(modelId: string | undefined, context: string): boolean {
  if (!modelId) return true; // No pinning needed

  try {
    setActiveModel(modelId);
    resetLLMProvider();
    console.log(`[${context}] Model pinned to: ${modelId}`);
    return true;
  } catch (error) {
    console.warn(`[${context}] Failed to set model ${modelId}, using current:`, error);
    return false;
  }
}

/**
 * Wrapper for operations that need Opik tracing with automatic error handling
 * Handles trace creation, success logging, error logging, and cleanup
 *
 * @param opik - Opik client instance
 * @param traceName - Name for the trace
 * @param metadata - Metadata object for the trace
 * @param operation - Async function to execute
 * @returns Result of the operation
 */
export async function withOpikTrace<T>(
  opik: ReturnType<typeof import("@/lib/integrations/opik").getOpikClient>,
  traceName: string,
  metadata: Record<string, unknown>,
  operation: (trace: OpikTrace | undefined) => Promise<T>
): Promise<T> {
  const trace = opik?.trace({
    name: traceName,
    metadata,
  });

  try {
    const result = await operation(trace);
    trace?.end();
    return result;
  } catch (error) {
    logErrorTrace(trace, error);
    throw error;
  }
}
