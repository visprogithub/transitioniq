/**
 * A/B Experiments - Compare prompt versions and models via Opik
 *
 * Enables:
 * - Running same patient through different prompt versions
 * - Comparing Gemini vs other models (if added)
 * - Tracking experiment results in Opik dashboard
 * - Statistical analysis of prompt effectiveness
 */

import { Opik } from "opik";
import { PROMPT_REGISTRY, getPromptVersion, fillPrompt, getPromptMetadata, type PromptVersion } from "./prompts";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import type { Patient } from "@/lib/types/patient";

let opikClient: Opik | null = null;

function getOpikClient(): Opik | null {
  if (!process.env.OPIK_API_KEY) return null;
  if (!opikClient) {
    opikClient = new Opik({
      apiKey: process.env.OPIK_API_KEY,
      projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
    });
  }
  return opikClient;
}

export interface ExperimentConfig {
  id: string;
  name: string;
  description: string;
  promptId: string;
  variants: Array<{
    name: string;
    promptVersion: string;
    model?: string; // For future multi-model experiments
  }>;
  testPatientIds: string[];
  metrics: Array<"score_consistency" | "latency" | "confidence" | "risk_coverage">;
}

export interface ExperimentResult {
  experimentId: string;
  variantName: string;
  promptVersion: string;
  patientId: string;
  metrics: {
    score?: number;
    status?: string;
    confidence?: number;
    latencyMs: number;
    riskFactorCount?: number;
    highRiskCount?: number;
  };
  rawOutput?: unknown;
  error?: string;
  timestamp: string;
}

export interface ExperimentSummary {
  experimentId: string;
  name: string;
  totalRuns: number;
  variants: Array<{
    name: string;
    runs: number;
    avgScore: number;
    avgLatency: number;
    avgConfidence: number;
    successRate: number;
  }>;
  winner?: string;
  analysis: string;
}

/**
 * Pre-defined experiments for the hackathon demo
 */
export const EXPERIMENTS: ExperimentConfig[] = [
  {
    id: "prompt-v1-vs-v1.1",
    name: "Discharge Analysis Prompt Comparison",
    description: "Compare original prompt vs enhanced prompt with confidence scores",
    promptId: "discharge-analysis",
    variants: [
      { name: "baseline", promptVersion: "1.0.0" },
      { name: "enhanced", promptVersion: "1.1.0" },
    ],
    testPatientIds: ["demo-polypharmacy", "demo-heart-failure"],
    metrics: ["score_consistency", "latency", "confidence"],
  },
];

/**
 * Run a single experiment variant
 */
export async function runExperimentVariant(
  config: ExperimentConfig,
  variantIndex: number,
  patientId: string,
  analyzeFunction: (promptVersion: string, patientId: string) => Promise<DischargeAnalysis>
): Promise<ExperimentResult> {
  const variant = config.variants[variantIndex];
  const opik = getOpikClient();
  const startTime = Date.now();

  const result: ExperimentResult = {
    experimentId: config.id,
    variantName: variant.name,
    promptVersion: variant.promptVersion,
    patientId,
    metrics: { latencyMs: 0 },
    timestamp: new Date().toISOString(),
  };

  try {
    // Get prompt for tracing metadata
    const prompt = getPromptVersion(config.promptId, variant.promptVersion);

    // Trace the experiment run
    if (opik) {
      const trace = opik.trace({
        name: `experiment-${config.id}`,
        metadata: {
          experiment_id: config.id,
          experiment_name: config.name,
          variant_name: variant.name,
          patient_id: patientId,
          category: "experiment",
          ...(prompt ? getPromptMetadata(prompt) : {}),
        },
      });

      const span = trace.span({
        name: `variant-${variant.name}`,
        metadata: {
          prompt_version: variant.promptVersion,
          model: variant.model || "gemini-2.0-flash",
        },
      });

      // Run the analysis
      const analysis = await analyzeFunction(variant.promptVersion, patientId);
      const latency = Date.now() - startTime;

      // Extract metrics
      result.metrics = {
        score: analysis.score,
        status: analysis.status,
        confidence: (analysis as any).confidence, // If using v1.1 prompt
        latencyMs: latency,
        riskFactorCount: analysis.riskFactors?.length || 0,
        highRiskCount: analysis.riskFactors?.filter((r) => r.severity === "high").length || 0,
      };
      result.rawOutput = analysis;

      // Log metrics to span
      span.update({
        metadata: {
          ...result.metrics,
          success: true,
        },
      });
      span.end();

      // Log evaluation score
      const evalSpan = trace.span({
        name: "experiment-evaluation",
        metadata: {
          metric_type: "experiment_result",
          score: analysis.score,
          latency_ms: latency,
        },
      });
      evalSpan.end();

      trace.end();
    } else {
      // Run without tracing
      const analysis = await analyzeFunction(variant.promptVersion, patientId);
      const latency = Date.now() - startTime;

      result.metrics = {
        score: analysis.score,
        status: analysis.status,
        confidence: (analysis as any).confidence,
        latencyMs: latency,
        riskFactorCount: analysis.riskFactors?.length || 0,
        highRiskCount: analysis.riskFactors?.filter((r) => r.severity === "high").length || 0,
      };
      result.rawOutput = analysis;
    }
  } catch (error) {
    result.metrics.latencyMs = Date.now() - startTime;
    result.error = error instanceof Error ? error.message : "Unknown error";
  }

  return result;
}

/**
 * Run a complete experiment across all variants and patients
 */
export async function runExperiment(
  config: ExperimentConfig,
  analyzeFunction: (promptVersion: string, patientId: string) => Promise<DischargeAnalysis>
): Promise<ExperimentSummary> {
  const opik = getOpikClient();
  const allResults: ExperimentResult[] = [];

  // Log experiment start
  if (opik) {
    const trace = opik.trace({
      name: `experiment-suite-${config.id}`,
      metadata: {
        experiment_id: config.id,
        experiment_name: config.name,
        category: "experiment_suite",
        variant_count: config.variants.length,
        patient_count: config.testPatientIds.length,
        total_runs: config.variants.length * config.testPatientIds.length,
      },
    });
    trace.end();
  }

  // Run each variant against each patient
  for (const patientId of config.testPatientIds) {
    for (let i = 0; i < config.variants.length; i++) {
      const result = await runExperimentVariant(config, i, patientId, analyzeFunction);
      allResults.push(result);
    }
  }

  // Compute summary statistics
  const variantStats = config.variants.map((variant) => {
    const variantResults = allResults.filter((r) => r.variantName === variant.name);
    const successfulResults = variantResults.filter((r) => !r.error);

    const scores = successfulResults.map((r) => r.metrics.score || 0);
    const latencies = successfulResults.map((r) => r.metrics.latencyMs);
    const confidences = successfulResults.map((r) => r.metrics.confidence || 0);

    return {
      name: variant.name,
      runs: variantResults.length,
      avgScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
      avgLatency: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      avgConfidence: confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0,
      successRate: variantResults.length > 0 ? successfulResults.length / variantResults.length : 0,
    };
  });

  // Determine winner based on combined metrics
  // Weight: success rate (40%) + confidence (30%) + lower latency (30%)
  const scored = variantStats.map((v) => ({
    ...v,
    combinedScore: v.successRate * 0.4 + v.avgConfidence * 0.3 + (1 - v.avgLatency / 10000) * 0.3,
  }));
  scored.sort((a, b) => b.combinedScore - a.combinedScore);
  const winner = scored[0]?.name;

  // Generate analysis text
  const analysis = generateExperimentAnalysis(config, variantStats, winner);

  // Log final summary to Opik
  if (opik) {
    const summaryTrace = opik.trace({
      name: `experiment-summary-${config.id}`,
      metadata: {
        experiment_id: config.id,
        category: "experiment_summary",
        winner,
        total_runs: allResults.length,
        ...Object.fromEntries(
          variantStats.flatMap((v) => [
            [`${v.name}_avg_score`, v.avgScore],
            [`${v.name}_avg_latency`, v.avgLatency],
            [`${v.name}_success_rate`, v.successRate],
          ])
        ),
      },
    });
    summaryTrace.end();
  }

  return {
    experimentId: config.id,
    name: config.name,
    totalRuns: allResults.length,
    variants: variantStats,
    winner,
    analysis,
  };
}

/**
 * Generate human-readable experiment analysis
 */
function generateExperimentAnalysis(
  config: ExperimentConfig,
  stats: ExperimentSummary["variants"],
  winner?: string
): string {
  const lines: string[] = [];

  lines.push(`## Experiment: ${config.name}`);
  lines.push(`Description: ${config.description}`);
  lines.push("");

  lines.push("### Results by Variant");
  for (const stat of stats) {
    lines.push(`**${stat.name}** (${stat.runs} runs)`);
    lines.push(`- Success Rate: ${(stat.successRate * 100).toFixed(1)}%`);
    lines.push(`- Avg Score: ${stat.avgScore.toFixed(1)}`);
    lines.push(`- Avg Latency: ${stat.avgLatency.toFixed(0)}ms`);
    if (stat.avgConfidence > 0) {
      lines.push(`- Avg Confidence: ${(stat.avgConfidence * 100).toFixed(1)}%`);
    }
    lines.push("");
  }

  if (winner) {
    lines.push(`### Winner: **${winner}**`);
    const winnerStats = stats.find((s) => s.name === winner);
    if (winnerStats) {
      lines.push(
        `The ${winner} variant performed best with ${(winnerStats.successRate * 100).toFixed(1)}% success rate.`
      );
    }
  }

  return lines.join("\n");
}

/**
 * Get available experiments
 */
export function listExperiments(): ExperimentConfig[] {
  return EXPERIMENTS;
}

/**
 * Get a specific experiment by ID
 */
export function getExperiment(id: string): ExperimentConfig | undefined {
  return EXPERIMENTS.find((e) => e.id === id);
}
