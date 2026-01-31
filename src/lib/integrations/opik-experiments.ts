/**
 * Opik Experiments - Proper integration with Opik cloud experiments
 *
 * Uses the official Opik evaluate() function so experiments appear in the
 * Opik cloud dashboard under "Experiments", not just "Traces".
 *
 * Supports running experiments against multiple LLM models for comparison.
 */

import { Opik, evaluate, BaseMetric, type EvaluationScoreResult } from "opik";
import { z } from "zod";
import type { DischargeAnalysis } from "../types/analysis";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions } from "@/lib/integrations/fda-client";
import { evaluateCareGaps } from "@/lib/integrations/guidelines-client";
import { analyzeDischargeReadiness, resetLLMProvider } from "@/lib/integrations/analysis";
import { setActiveModel, getActiveModelId } from "@/lib/integrations/llm-provider";

let opikClient: Opik | null = null;

function getOpikClient(): Opik | null {
  if (!process.env.OPIK_API_KEY) {
    console.warn("[Opik Experiments] OPIK_API_KEY not set");
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

/**
 * Test dataset for discharge readiness evaluation
 */
export const EXPERIMENT_DATASET = [
  {
    patientId: "demo-polypharmacy",
    patientName: "John Smith",
    scenario: "Complex polypharmacy with drug interactions",
    // 68yo male on 12 meds including warfarin+aspirin+eliquis (triple antithrombotic)
    // Elevated INR, impaired renal function — should score very low
    expectedScoreRange: { min: 5, max: 35 },
    expectedStatus: "not_ready",
    expectedHighRiskCount: { min: 3, max: 8 },
  },
  {
    patientId: "demo-heart-failure",
    patientName: "Mary Johnson",
    scenario: "Heart failure with COPD",
    // 72yo female, CHF + COPD, multiple meds, some care gaps
    // Not as critical as polypharmacy but still concerning
    expectedScoreRange: { min: 35, max: 55 },
    expectedStatus: "caution",
    expectedHighRiskCount: { min: 2, max: 5 },
  },
  {
    patientId: "demo-ready",
    patientName: "Robert Chen",
    scenario: "Post-appendectomy, stable",
    // 45yo male, simple post-surgical, few meds, minimal risk
    // Should score high — genuinely ready for discharge
    expectedScoreRange: { min: 75, max: 95 },
    expectedStatus: "ready",
    expectedHighRiskCount: { min: 0, max: 1 },
  },
  {
    patientId: "demo-pediatric",
    patientName: "Emily Wilson",
    scenario: "Pediatric post-tonsillectomy",
    // 8yo female, simple recovery, 2 meds (amoxicillin + ibuprofen)
    expectedScoreRange: { min: 85, max: 100 },
    expectedStatus: "ready",
    expectedHighRiskCount: { min: 0, max: 1 },
  },
  {
    patientId: "demo-geriatric-fall",
    patientName: "Dorothy Martinez",
    scenario: "Geriatric fall risk with cognitive decline",
    // 88yo female, hip fracture, dementia, 6 meds, high fall risk
    expectedScoreRange: { min: 20, max: 40 },
    expectedStatus: "not_ready",
    expectedHighRiskCount: { min: 2, max: 6 },
  },
  {
    patientId: "demo-pregnancy-gdm",
    patientName: "Sarah Thompson",
    scenario: "Gestational diabetes management",
    // 32yo female, gestational diabetes, 4 meds, moderate complexity
    expectedScoreRange: { min: 50, max: 70 },
    expectedStatus: "caution",
    expectedHighRiskCount: { min: 1, max: 3 },
  },
  {
    patientId: "demo-renal-dialysis",
    patientName: "William Jackson",
    scenario: "CKD Stage 4 approaching dialysis",
    // 65yo male, chronic kidney disease, 7 meds, renal dosing concerns
    expectedScoreRange: { min: 30, max: 50 },
    expectedStatus: "not_ready",
    expectedHighRiskCount: { min: 2, max: 5 },
  },
  {
    patientId: "demo-psychiatric-bipolar",
    patientName: "Jennifer Adams",
    scenario: "Bipolar disorder on lithium",
    // 45yo female, bipolar, lithium + anticonvulsants, drug level monitoring
    expectedScoreRange: { min: 40, max: 60 },
    expectedStatus: "caution",
    expectedHighRiskCount: { min: 1, max: 4 },
  },
  {
    patientId: "demo-oncology-neutropenic",
    patientName: "Michael Brown",
    scenario: "Post-chemotherapy neutropenia",
    // 58yo male, post-chemo, neutropenic, 6 meds, infection risk
    expectedScoreRange: { min: 30, max: 50 },
    expectedStatus: "not_ready",
    expectedHighRiskCount: { min: 2, max: 5 },
  },
  {
    patientId: "demo-simple-surgery",
    patientName: "Lisa Garcia",
    scenario: "Laparoscopic cholecystectomy recovery",
    // 35yo female, simple surgery, 2 meds, minimal risk
    expectedScoreRange: { min: 85, max: 100 },
    expectedStatus: "ready",
    expectedHighRiskCount: { min: 0, max: 1 },
  },
  {
    patientId: "demo-extreme-polypharmacy",
    patientName: "Harold Wilson",
    scenario: "Extreme polypharmacy with 18 medications",
    // 75yo male, 18 meds, 8 comorbidities, very high interaction risk
    expectedScoreRange: { min: 10, max: 30 },
    expectedStatus: "not_ready",
    expectedHighRiskCount: { min: 4, max: 10 },
  },
  {
    patientId: "demo-social-risk",
    patientName: "David Thompson",
    scenario: "Homeless patient with COPD",
    // 52yo male, homeless, COPD, 6 meds, social determinant barriers
    expectedScoreRange: { min: 20, max: 50 },
    expectedStatus: "not_ready",
    expectedHighRiskCount: { min: 2, max: 6 },
  },
];

// ─── Custom Opik Metrics ─────────────────────────────────────────────

/**
 * Score accuracy metric: checks if the discharge score is within expected range
 */
class ScoreAccuracyMetric extends BaseMetric {
  readonly validationSchema = z.object({
    output: z.object({
      score: z.number(),
    }),
    reference: z.object({
      expectedScoreRange: z.object({ min: z.number(), max: z.number() }),
    }),
  });

  constructor() {
    super("score_accuracy");
  }

  score(input: unknown): EvaluationScoreResult {
    const parsed = this.validationSchema.parse(input);
    const actual = parsed.output.score;
    const expected = parsed.reference.expectedScoreRange;
    const inRange = actual >= expected.min && actual <= expected.max;

    if (inRange) {
      return { name: this.name, value: 1.0, reason: `Score ${actual} within [${expected.min}-${expected.max}]` };
    }
    const distance = actual < expected.min ? expected.min - actual : actual - expected.max;
    // Steeper penalty: 25-point window means being 15pts out = 0.4 score
    const penalty = Math.min(1, distance / 25);
    return {
      name: this.name,
      value: Math.max(0, 1 - penalty),
      reason: `Score ${actual} is ${distance}pts outside [${expected.min}-${expected.max}]`,
    };
  }
}

/**
 * Status correctness metric: checks if the status matches expected
 */
class StatusCorrectnessMetric extends BaseMetric {
  readonly validationSchema = z.object({
    output: z.object({
      status: z.string(),
    }),
    reference: z.object({
      expectedStatus: z.string(),
    }),
  });

  constructor() {
    super("status_correctness");
  }

  score(input: unknown): EvaluationScoreResult {
    const parsed = this.validationSchema.parse(input);
    const actual = parsed.output.status;
    const expected = parsed.reference.expectedStatus;

    if (actual === expected) {
      return { name: this.name, value: 1.0, reason: `Status "${actual}" matches expected` };
    }
    const statusOrder = ["not_ready", "caution", "ready"];
    const actualIdx = statusOrder.indexOf(actual);
    const expectedIdx = statusOrder.indexOf(expected);
    if (actualIdx >= 0 && expectedIdx >= 0 && Math.abs(actualIdx - expectedIdx) === 1) {
      return { name: this.name, value: 0.3, reason: `Status "${actual}" adjacent to expected "${expected}"` };
    }
    return { name: this.name, value: 0.0, reason: `Status "${actual}" does not match expected "${expected}"` };
  }
}

/**
 * Risk factor coverage metric: checks high-risk factor count vs expected range
 */
class RiskCoverageMetric extends BaseMetric {
  readonly validationSchema = z.object({
    output: z.object({
      highRiskCount: z.number(),
    }),
    reference: z.object({
      expectedHighRiskCount: z.object({ min: z.number(), max: z.number() }),
    }),
  });

  constructor() {
    super("risk_coverage");
  }

  score(input: unknown): EvaluationScoreResult {
    const parsed = this.validationSchema.parse(input);
    const actual = parsed.output.highRiskCount;
    const expected = parsed.reference.expectedHighRiskCount;

    if (actual >= expected.min && actual <= expected.max) {
      return { name: this.name, value: 1.0, reason: `Found ${actual} high-risk factors (expected ${expected.min}-${expected.max})` };
    }
    if (actual < expected.min) {
      return { name: this.name, value: 0.3, reason: `Only ${actual} high-risk factors (expected at least ${expected.min})` };
    }
    return { name: this.name, value: 0.7, reason: `Found ${actual} high-risk factors (more than expected max ${expected.max})` };
  }
}

// ─── Dataset Management ──────────────────────────────────────────────

/**
 * Create or get the evaluation dataset in Opik
 */
export async function getOrCreateOpikDataset(datasetName: string = "discharge-readiness-eval") {
  const opik = getOpikClient();
  if (!opik) {
    throw new Error("Opik client not initialized - check OPIK_API_KEY");
  }

  const dataset = await opik.getOrCreateDataset(datasetName);

  // Clear and insert fresh test cases
  await dataset.clear();
  await dataset.insert(
    EXPERIMENT_DATASET.map((tc) => ({
      input: {
        patient_id: tc.patientId,
        patient_name: tc.patientName,
        scenario: tc.scenario,
      },
      expected_output: {
        score_range: tc.expectedScoreRange,
        status: tc.expectedStatus,
        high_risk_count_range: tc.expectedHighRiskCount,
      },
      // Store reference data for scoring metrics
      reference: {
        expectedScoreRange: tc.expectedScoreRange,
        expectedStatus: tc.expectedStatus,
        expectedHighRiskCount: tc.expectedHighRiskCount,
      },
    }))
  );

  await opik.flush();
  console.log(`[Opik] Dataset "${datasetName}" created with ${EXPERIMENT_DATASET.length} items`);
  return dataset;
}

// ─── LLM-backed Analysis Task ────────────────────────────────────────

/**
 * Run real LLM-backed discharge analysis for a patient.
 * This calls the actual LLM and returns real analysis results.
 *
 * @param patientId - The patient to analyze
 * @param modelId - Explicitly pin the model to use (re-sets active model before each call
 *   to guard against Opik evaluate() running callbacks in different ticks)
 */
async function analyzePatientWithLLM(patientId: string, modelId?: string): Promise<DischargeAnalysis> {
  // Re-pin the active model before each LLM call to ensure the correct model is used,
  // even if Opik's evaluate() runs callbacks asynchronously
  if (modelId) {
    setActiveModel(modelId);
    resetLLMProvider();
    console.log(`[Opik Experiment] Pinned model to ${modelId} for patient ${patientId}`);
  }

  const patient = getPatient(patientId);
  if (!patient) {
    throw new Error(`Patient ${patientId} not found`);
  }

  const [interactions, careGaps] = await Promise.all([
    checkDrugInteractions(patient.medications).catch(() => []),
    Promise.resolve(evaluateCareGaps(patient)),
  ]);

  const unmetCareGaps = careGaps.filter((g) => g.status === "unmet");
  const costEstimates = patient.medications.map((m) => ({
    medication: m.name,
    monthlyOOP: 10,
    covered: true,
  }));

  // This calls the REAL LLM via the active model
  const analysis = await analyzeDischargeReadiness(
    patient,
    interactions,
    unmetCareGaps.map((g) => ({
      guideline: g.guideline,
      recommendation: g.recommendation,
      grade: g.grade,
      status: g.status,
    })),
    costEstimates
  );

  return analysis;
}

// ─── Main Experiment Runner ──────────────────────────────────────────

export interface OpikExperimentResult {
  experimentName: string;
  experimentId?: string;
  modelId: string;
  opikDashboardUrl: string;
  results: Array<{
    patientId: string;
    analysis: DischargeAnalysis;
    scores: {
      scoreAccuracy: number;
      statusCorrectness: number;
      riskFactorCoverage: number;
      overall: number;
    };
    passed: boolean;
    latencyMs: number;
  }>;
  summary: {
    totalCases: number;
    passedCases: number;
    passRate: number;
    avgScore: number;
    avgLatencyMs: number;
  };
}

/**
 * Run an Opik experiment using the proper evaluate() API.
 * This creates a REAL experiment in the Opik dashboard (not just traces).
 *
 * @param experimentName - Name for the experiment
 * @param modelId - Which LLM model to use for analysis
 */
export async function runOpikExperiment(
  experimentName: string = `discharge-eval-${Date.now()}`,
  modelId?: string,
): Promise<OpikExperimentResult> {
  const opik = getOpikClient();
  if (!opik) {
    throw new Error("Opik client not initialized - check OPIK_API_KEY");
  }

  // Switch to the requested model
  const previousModel = getActiveModelId();
  if (modelId) {
    setActiveModel(modelId);
    resetLLMProvider();
  }
  const activeModel = getActiveModelId();

  const projectName = process.env.OPIK_PROJECT_NAME || "transitioniq";
  const opikDashboardUrl = `https://www.comet.com/opik/${projectName}/experiments`;

  // Get or create the dataset
  const dataset = await getOrCreateOpikDataset();

  // Track results locally for our response
  const localResults: OpikExperimentResult["results"] = [];

  // Define the evaluation task - this calls the REAL LLM
  // Capture activeModel in closure so it's always passed explicitly to each LLM call
  const pinnedModel = activeModel;
  const task = async (datasetItem: Record<string, unknown>) => {
    const input = datasetItem.input as { patient_id: string };
    const startTime = Date.now();

    try {
      const analysis = await analyzePatientWithLLM(input.patient_id, pinnedModel);
      const latencyMs = Date.now() - startTime;
      const highRiskCount = analysis.riskFactors.filter((r) => r.severity === "high").length;

      // Store for local tracking
      const expected = datasetItem.reference as {
        expectedScoreRange: { min: number; max: number };
        expectedStatus: string;
        expectedHighRiskCount: { min: number; max: number };
      };

      // Local scoring mirrors the Opik metric classes (25-pt window, 0.3 adjacent, 0.3 under-detect)
      const scoreDist = analysis.score < expected.expectedScoreRange.min
        ? expected.expectedScoreRange.min - analysis.score
        : analysis.score > expected.expectedScoreRange.max
          ? analysis.score - expected.expectedScoreRange.max
          : 0;
      const scoreAcc = scoreDist === 0 ? 1.0 : Math.max(0, 1 - Math.min(1, scoreDist / 25));

      const statusOrder = ["not_ready", "caution", "ready"];
      const aIdx = statusOrder.indexOf(analysis.status);
      const eIdx = statusOrder.indexOf(expected.expectedStatus);
      const statusCorr = analysis.status === expected.expectedStatus ? 1.0
        : (aIdx >= 0 && eIdx >= 0 && Math.abs(aIdx - eIdx) === 1 ? 0.3 : 0.0);

      const riskCov = (highRiskCount >= expected.expectedHighRiskCount.min && highRiskCount <= expected.expectedHighRiskCount.max)
        ? 1.0
        : (highRiskCount < expected.expectedHighRiskCount.min ? 0.3 : 0.7);

      const overall = scoreAcc * 0.4 + statusCorr * 0.4 + riskCov * 0.2;

      localResults.push({
        patientId: input.patient_id,
        analysis,
        scores: { scoreAccuracy: scoreAcc, statusCorrectness: statusCorr, riskFactorCoverage: riskCov, overall },
        passed: overall >= 0.75,
        latencyMs,
      });

      return {
        score: analysis.score,
        status: analysis.status,
        highRiskCount,
        riskFactorCount: analysis.riskFactors.length,
        latencyMs,
        modelId: activeModel,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      console.error(`[Opik Experiment] LLM analysis failed for ${input.patient_id}:`, error);

      // Return error result - metrics will score this poorly
      return {
        score: -1,
        status: "error",
        highRiskCount: 0,
        riskFactorCount: 0,
        latencyMs,
        modelId: activeModel,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  };

  // Run the experiment using Opik's evaluate() function
  // This creates a proper experiment in the Opik dashboard
  let experimentId: string | undefined;
  try {
    const evalResult = await evaluate({
      dataset,
      task,
      scoringMetrics: [
        new ScoreAccuracyMetric(),
        new StatusCorrectnessMetric(),
        new RiskCoverageMetric(),
      ],
      experimentName: `${experimentName}-${activeModel}`,
      projectName,
      experimentConfig: {
        model: activeModel,
        dataset_size: EXPERIMENT_DATASET.length,
        timestamp: new Date().toISOString(),
      },
      client: opik,
    });

    experimentId = evalResult.experimentId;
    console.log(`[Opik] Experiment "${experimentName}-${activeModel}" created with ID: ${experimentId}`);
  } catch (evalError) {
    console.error("[Opik] evaluate() failed, falling back to manual tracing:", evalError);

    // Fallback: use manual tracing if evaluate() fails
    await runManualTracingFallback(opik, experimentName, activeModel, localResults);
  }

  // Restore previous model
  if (modelId && previousModel !== activeModel) {
    setActiveModel(previousModel);
    resetLLMProvider();
  }

  // Flush to ensure all data is sent
  try {
    await Promise.race([
      opik.flush(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("flush timeout")), 10000)),
    ]);
  } catch {
    console.warn("[Opik] Flush timed out (non-fatal)");
  }

  // Calculate summary
  const passedCases = localResults.filter((r) => r.passed).length;
  const passRate = localResults.length > 0 ? passedCases / localResults.length : 0;
  const avgScore = localResults.length > 0
    ? localResults.reduce((sum, r) => sum + r.scores.overall, 0) / localResults.length
    : 0;
  const avgLatencyMs = localResults.length > 0
    ? localResults.reduce((sum, r) => sum + r.latencyMs, 0) / localResults.length
    : 0;

  console.log(`[Opik Experiment] "${experimentName}-${activeModel}" completed: ${passedCases}/${localResults.length} passed (${(passRate * 100).toFixed(1)}%)`);

  return {
    experimentName: `${experimentName}-${activeModel}`,
    experimentId,
    modelId: activeModel,
    opikDashboardUrl,
    results: localResults,
    summary: {
      totalCases: EXPERIMENT_DATASET.length,
      passedCases,
      passRate,
      avgScore,
      avgLatencyMs,
    },
  };
}

/**
 * Fallback: manual tracing if evaluate() fails (e.g., dataset format issue)
 */
async function runManualTracingFallback(
  opik: Opik,
  experimentName: string,
  modelId: string,
  results: OpikExperimentResult["results"],
) {
  const trace = opik.trace({
    name: `${experimentName}-${modelId}-fallback`,
    input: {
      model: modelId,
      dataset_size: results.length,
      note: "Fallback manual tracing - evaluate() was unavailable",
    },
    metadata: { category: "experiment", model: modelId },
  });

  for (const r of results) {
    const span = trace.span({
      name: `eval-${r.patientId}`,
      input: { patient_id: r.patientId },
      metadata: { model: modelId },
    });
    span.update({
      output: {
        score: r.analysis.score,
        status: r.analysis.status,
        risk_factor_count: r.analysis.riskFactors.length,
      },
      metadata: {
        latency_ms: r.latencyMs,
        overall_score: r.scores.overall,
        passed: r.passed,
      },
    });
    span.score({ name: "score_accuracy", value: r.scores.scoreAccuracy });
    span.score({ name: "status_correctness", value: r.scores.statusCorrectness });
    span.score({ name: "risk_coverage", value: r.scores.riskFactorCoverage });
    span.score({ name: "overall", value: r.scores.overall, reason: r.passed ? "PASSED" : "FAILED" });
    span.end();
  }

  const passRate = results.length > 0 ? results.filter((r) => r.passed).length / results.length : 0;
  trace.score({ name: "experiment_pass_rate", value: passRate });
  trace.end();
}

/**
 * Run experiments across MULTIPLE models.
 * Creates a separate Opik experiment per model for side-by-side comparison.
 */
export async function runMultiModelExperiment(
  experimentName: string,
  modelIds: string[],
): Promise<{
  experiments: OpikExperimentResult[];
  comparison: Record<string, { avgScore: number; passRate: number; avgLatencyMs: number }>;
}> {
  const experiments: OpikExperimentResult[] = [];

  for (const modelId of modelIds) {
    console.log(`[Opik] Running experiment for model: ${modelId}`);
    try {
      const result = await runOpikExperiment(experimentName, modelId);
      experiments.push(result);
    } catch (error) {
      console.error(`[Opik] Experiment failed for model ${modelId}:`, error);
      // Still continue with other models
    }
  }

  // Build comparison summary
  const comparison: Record<string, { avgScore: number; passRate: number; avgLatencyMs: number }> = {};
  for (const exp of experiments) {
    comparison[exp.modelId] = {
      avgScore: exp.summary.avgScore,
      passRate: exp.summary.passRate,
      avgLatencyMs: exp.summary.avgLatencyMs,
    };
  }

  return { experiments, comparison };
}

/**
 * Get the Opik dashboard URL for experiments
 */
export function getOpikExperimentsUrl(): string {
  const projectName = process.env.OPIK_PROJECT_NAME || "transitioniq";
  return `https://www.comet.com/opik/${projectName}/experiments`;
}

/**
 * Get the Opik dashboard URL for traces
 */
export function getOpikTracesUrl(): string {
  const projectName = process.env.OPIK_PROJECT_NAME || "transitioniq";
  return `https://www.comet.com/opik/${projectName}/traces`;
}
