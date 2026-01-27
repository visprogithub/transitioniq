/**
 * Guardrails Module for TransitionIQ
 *
 * Provides safety and compliance wrappers for LLM interactions,
 * including PII/PHI detection, content filtering, and audit logging.
 */

import {
  detectPII,
  sanitizePII,
  sanitizePIIWithPlaceholders,
  shouldBlockContent,
  getPIIDetectionSummary,
  type PIIDetectionResult,
  type PIIMatch,
  type PIIType,
} from "./pii-detector";
import { getOpikClient } from "@/lib/integrations/opik";

// Re-export PII detector types and functions
export {
  detectPII,
  sanitizePII,
  sanitizePIIWithPlaceholders,
  shouldBlockContent,
  getPIIDetectionSummary,
  type PIIDetectionResult,
  type PIIMatch,
  type PIIType,
};

export interface GuardrailOptions {
  /** Whether to sanitize PII before processing */
  sanitizePII?: boolean;
  /** Whether to use placeholder text instead of redaction characters */
  usePlaceholders?: boolean;
  /** Whether to block content with critical PII */
  blockCriticalPII?: boolean;
  /** Whether to log guardrail actions to Opik */
  logToOpik?: boolean;
  /** Custom trace name for Opik logging */
  traceName?: string;
}

export interface GuardrailResult<T> {
  /** The processed output */
  output: T;
  /** Whether PII was detected */
  piiDetected: boolean;
  /** Whether content was sanitized */
  wasSanitized: boolean;
  /** Whether content was blocked */
  wasBlocked: boolean;
  /** Detection details */
  detection: PIIDetectionResult | null;
  /** Any error that occurred */
  error?: string;
}

const DEFAULT_OPTIONS: GuardrailOptions = {
  sanitizePII: true,
  usePlaceholders: true,
  blockCriticalPII: true,
  logToOpik: true,
  traceName: "guardrail-check",
};

/**
 * Apply guardrails to input text before processing
 */
export function applyInputGuardrails(
  input: string,
  options: GuardrailOptions = {}
): GuardrailResult<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Detect PII
  const detection = detectPII(input);
  const summary = getPIIDetectionSummary(detection);

  // Log to Opik if enabled
  const opik = getOpikClient();
  const trace = opts.logToOpik && opik
    ? opik.trace({
        name: opts.traceName || "guardrail-input",
        metadata: {
          type: "guardrail",
          direction: "input",
        },
      })
    : null;
  const span = trace
    ? trace.span({
        name: "pii-detection",
        metadata: {
          piiDetected: detection.hasPII,
          riskLevel: detection.riskLevel,
          categories: detection.categories,
        },
      })
    : null;

  // Check if content should be blocked
  if (opts.blockCriticalPII) {
    const blockResult = shouldBlockContent(input);
    if (blockResult.block) {
      span?.update({
        output: { blocked: true, reason: blockResult.reason },
      });
      span?.end();
      trace?.end();

      return {
        output: "",
        piiDetected: true,
        wasSanitized: false,
        wasBlocked: true,
        detection,
        error: blockResult.reason,
      };
    }
  }

  // Sanitize if needed
  let processedInput = input;
  let wasSanitized = false;

  if (opts.sanitizePII && detection.hasPII) {
    processedInput = opts.usePlaceholders
      ? sanitizePIIWithPlaceholders(input)
      : sanitizePII(input);
    wasSanitized = true;
  }

  span?.update({
    output: {
      summary,
      wasSanitized,
      matchCount: detection.matches.length,
    },
  });
  span?.end();
  trace?.end();

  return {
    output: processedInput,
    piiDetected: detection.hasPII,
    wasSanitized,
    wasBlocked: false,
    detection,
  };
}

/**
 * Apply guardrails to output text after processing
 */
export function applyOutputGuardrails(
  output: string,
  options: GuardrailOptions = {}
): GuardrailResult<string> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Detect PII in output
  const detection = detectPII(output);
  const summary = getPIIDetectionSummary(detection);

  // Log to Opik if enabled
  const opik = getOpikClient();
  const trace = opts.logToOpik && opik
    ? opik.trace({
        name: opts.traceName || "guardrail-output",
        metadata: {
          type: "guardrail",
          direction: "output",
        },
      })
    : null;
  const span = trace
    ? trace.span({
        name: "pii-detection",
        metadata: {
          piiDetected: detection.hasPII,
          riskLevel: detection.riskLevel,
          categories: detection.categories,
        },
      })
    : null;

  // Always sanitize output if PII detected (more strict than input)
  let processedOutput = output;
  let wasSanitized = false;

  if (detection.hasPII) {
    processedOutput = opts.usePlaceholders
      ? sanitizePIIWithPlaceholders(output)
      : sanitizePII(output);
    wasSanitized = true;
  }

  span?.update({
    output: {
      summary,
      wasSanitized,
      matchCount: detection.matches.length,
    },
  });
  span?.end();
  trace?.end();

  return {
    output: processedOutput,
    piiDetected: detection.hasPII,
    wasSanitized,
    wasBlocked: false,
    detection,
  };
}

/**
 * Wrapper function that applies guardrails to an async function
 */
export async function withGuardrails<T>(
  inputText: string,
  processFn: (sanitizedInput: string) => Promise<T>,
  options: GuardrailOptions = {}
): Promise<GuardrailResult<T>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const opik = getOpikClient();

  // Create trace for full guardrail workflow
  const trace = opts.logToOpik && opik
    ? opik.trace({
        name: opts.traceName || "guardrail-workflow",
        metadata: { type: "guardrail" },
      })
    : null;

  try {
    // Apply input guardrails
    const inputResult = applyInputGuardrails(inputText, {
      ...opts,
      logToOpik: false, // Disable nested logging
      traceName: "input-check",
    });

    // If input was blocked, return early
    if (inputResult.wasBlocked) {
      trace?.update({
        output: { blocked: true, reason: inputResult.error },
      });
      trace?.end();

      return {
        output: null as unknown as T,
        piiDetected: true,
        wasSanitized: false,
        wasBlocked: true,
        detection: inputResult.detection,
        error: inputResult.error,
      };
    }

    // Log input check
    if (trace) {
      trace.span({
        name: "input-guardrail",
        metadata: {
          piiDetected: inputResult.piiDetected,
          wasSanitized: inputResult.wasSanitized,
        },
      }).end();
    }

    // Process with sanitized input
    const result = await processFn(inputResult.output);

    // Log successful processing
    trace?.update({
      output: {
        piiDetectedInInput: inputResult.piiDetected,
        inputWasSanitized: inputResult.wasSanitized,
      },
    });
    trace?.end();

    return {
      output: result,
      piiDetected: inputResult.piiDetected,
      wasSanitized: inputResult.wasSanitized,
      wasBlocked: false,
      detection: inputResult.detection,
    };
  } catch (error) {
    trace?.update({
      metadata: { error: String(error) },
    });
    trace?.end();

    throw error;
  }
}

/**
 * Check if text is safe to process (quick check without sanitization)
 */
export function isSafeToProcess(text: string): boolean {
  const blockResult = shouldBlockContent(text);
  return !blockResult.block;
}

/**
 * Get guardrail statistics for monitoring
 */
export interface GuardrailStats {
  totalChecks: number;
  piiDetections: number;
  blockedRequests: number;
  sanitizedRequests: number;
  categoryCounts: Record<PIIType, number>;
}

// Simple in-memory stats (could be replaced with proper metrics)
const stats: GuardrailStats = {
  totalChecks: 0,
  piiDetections: 0,
  blockedRequests: 0,
  sanitizedRequests: 0,
  categoryCounts: {} as Record<PIIType, number>,
};

export function recordGuardrailStats(result: GuardrailResult<unknown>): void {
  stats.totalChecks++;
  if (result.piiDetected) stats.piiDetections++;
  if (result.wasBlocked) stats.blockedRequests++;
  if (result.wasSanitized) stats.sanitizedRequests++;

  if (result.detection) {
    for (const category of result.detection.categories) {
      stats.categoryCounts[category] = (stats.categoryCounts[category] || 0) + 1;
    }
  }
}

export function getGuardrailStats(): GuardrailStats {
  return { ...stats };
}

export function resetGuardrailStats(): void {
  stats.totalChecks = 0;
  stats.piiDetections = 0;
  stats.blockedRequests = 0;
  stats.sanitizedRequests = 0;
  stats.categoryCounts = {} as Record<PIIType, number>;
}
