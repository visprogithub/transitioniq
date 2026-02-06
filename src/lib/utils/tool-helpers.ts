/**
 * Tool Helpers - Generic fallback chain executor with metrics
 * Reduces duplication in patient-coach-tools.ts (3 tools, ~500 lines)
 */

export interface ToolCallResult {
  toolName: string;
  result: unknown;
  success: boolean;
  error?: string;
}

export interface FallbackStrategy<T> {
  name: string;
  execute: () => Promise<T | null>;
}

/**
 * Metrics for fallback usage
 * Tracks which strategies succeed/fail for each tool
 */
interface FallbackMetrics {
  toolName: string;
  strategyUsed: string;
  durationMs: number;
  timestamp: number;
}

const fallbackMetrics: FallbackMetrics[] = [];
const MAX_METRICS = 1000; // Keep last 1000 metrics

/**
 * Record a fallback metric
 */
function recordMetric(toolName: string, strategyUsed: string, durationMs: number) {
  fallbackMetrics.push({
    toolName,
    strategyUsed,
    durationMs,
    timestamp: Date.now(),
  });

  // Keep metrics bounded
  if (fallbackMetrics.length > MAX_METRICS) {
    fallbackMetrics.shift();
  }
}

/**
 * Get fallback metrics for analysis
 * Returns stats like: "LLM_FALLBACK used 23% of the time for lookupMedication"
 */
export function getFallbackMetrics(toolName?: string) {
  const relevantMetrics = toolName
    ? fallbackMetrics.filter((m) => m.toolName === toolName)
    : fallbackMetrics;

  if (relevantMetrics.length === 0) {
    return {
      total: 0,
      byStrategy: {},
      avgDuration: {},
    };
  }

  const byStrategy: Record<string, number> = {};
  const durationByStrategy: Record<string, number[]> = {};

  for (const metric of relevantMetrics) {
    byStrategy[metric.strategyUsed] = (byStrategy[metric.strategyUsed] || 0) + 1;
    if (!durationByStrategy[metric.strategyUsed]) {
      durationByStrategy[metric.strategyUsed] = [];
    }
    durationByStrategy[metric.strategyUsed].push(metric.durationMs);
  }

  // Calculate average durations
  const avgDuration: Record<string, number> = {};
  for (const [strategy, durations] of Object.entries(durationByStrategy)) {
    avgDuration[strategy] = durations.reduce((a, b) => a + b, 0) / durations.length;
  }

  return {
    total: relevantMetrics.length,
    byStrategy,
    avgDuration,
  };
}

/**
 * Log fallback metrics to console (for debugging/monitoring)
 */
export function logFallbackMetrics() {
  const allMetrics = getFallbackMetrics();
  console.log("\n=== Tool Fallback Metrics ===");
  console.log(`Total tool calls: ${allMetrics.total}`);

  const toolNames = [...new Set(fallbackMetrics.map((m) => m.toolName))];
  for (const toolName of toolNames) {
    const toolMetrics = getFallbackMetrics(toolName);
    console.log(`\n${toolName}:`);
    for (const [strategy, count] of Object.entries(toolMetrics.byStrategy)) {
      const percentage = ((count / toolMetrics.total) * 100).toFixed(1);
      const avgDur = toolMetrics.avgDuration[strategy].toFixed(0);
      console.log(`  ${strategy}: ${count} (${percentage}%) - avg ${avgDur}ms`);
    }
  }
  console.log("============================\n");
}

/**
 * Generic fallback chain executor with metrics
 * Tries multiple strategies in order until one succeeds
 *
 * @param toolName - Name of the tool (for metrics)
 * @param strategies - Ordered list of strategies to try
 * @param finalFallback - Final fallback value if all strategies fail
 * @returns ToolCallResult with the successful result and source
 */
export async function executeWithFallback<T>(
  toolName: string,
  strategies: FallbackStrategy<T>[],
  finalFallback: T
): Promise<ToolCallResult> {
  for (const strategy of strategies) {
    const startTime = Date.now();
    try {
      console.log(`[${toolName}] Trying ${strategy.name}...`);
      const result = await strategy.execute();

      if (result !== null) {
        const durationMs = Date.now() - startTime;
        recordMetric(toolName, strategy.name, durationMs);
        console.log(`[${toolName}] ✓ Success with ${strategy.name} (${durationMs}ms)`);

        return {
          toolName,
          result: { ...result, source: strategy.name },
          success: true,
        };
      }

      console.log(`[${toolName}] ${strategy.name} returned null, trying next...`);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      console.error(`[${toolName}] ${strategy.name} failed (${durationMs}ms):`, error);
      // Continue to next strategy
    }
  }

  // All strategies failed - use final fallback
  const fallbackDuration = 0; // Fallback is instant
  recordMetric(toolName, "FALLBACK", fallbackDuration);
  console.log(`[${toolName}] All strategies failed, using final fallback`);

  return {
    toolName,
    result: { ...finalFallback, source: "FALLBACK" },
    success: true,
  };
}
