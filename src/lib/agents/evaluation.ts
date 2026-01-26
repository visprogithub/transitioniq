/**
 * Opik Evaluation - Proper integration with datasets and scoring metrics
 *
 * This implements the Opik evaluation workflow:
 * 1. Create datasets with test cases
 * 2. Define evaluation tasks
 * 3. Run experiments with scoring metrics
 * 4. Track results in Opik dashboard
 */

import { Opik } from "opik";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions } from "@/lib/integrations/fda-client";
import { evaluateCareGaps } from "@/lib/integrations/guidelines-client";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";
import type { Patient } from "@/lib/types/patient";

let opikClient: Opik | null = null;

function getOpikClient(): Opik {
  if (!opikClient) {
    opikClient = new Opik({
      apiKey: process.env.OPIK_API_KEY!,
      projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
    });
  }
  return opikClient;
}

/**
 * Test dataset for discharge readiness evaluation
 */
export const EVALUATION_DATASET = [
  {
    patientId: "demo-polypharmacy",
    patientName: "John Smith",
    expectedScoreRange: { min: 0, max: 50 }, // High-risk patient
    expectedStatus: "not_ready",
    expectedHighRiskCount: { min: 2, max: 10 },
    description: "Complex polypharmacy patient with multiple interactions",
  },
  {
    patientId: "demo-heart-failure",
    patientName: "Mary Johnson",
    expectedScoreRange: { min: 30, max: 70 },
    expectedStatus: "caution",
    expectedHighRiskCount: { min: 1, max: 5 },
    description: "Heart failure patient with moderate complexity",
  },
  {
    patientId: "demo-ready",
    patientName: "Robert Davis",
    expectedScoreRange: { min: 70, max: 100 },
    expectedStatus: "ready",
    expectedHighRiskCount: { min: 0, max: 2 },
    description: "Stable patient ready for discharge",
  },
];

/**
 * Scoring metric: Score accuracy (is score within expected range?)
 */
function scoreAccuracy(
  actual: number,
  expected: { min: number; max: number }
): { score: number; reason: string } {
  const inRange = actual >= expected.min && actual <= expected.max;
  if (inRange) {
    return { score: 1.0, reason: `Score ${actual} is within expected range [${expected.min}-${expected.max}]` };
  }
  const distance = actual < expected.min ? expected.min - actual : actual - expected.max;
  const penalty = Math.min(1, distance / 50); // Lose up to 1.0 for being 50+ points off
  return {
    score: Math.max(0, 1 - penalty),
    reason: `Score ${actual} is ${distance} points outside expected range [${expected.min}-${expected.max}]`,
  };
}

/**
 * Scoring metric: Status correctness
 */
function statusCorrectness(
  actual: string,
  expected: string
): { score: number; reason: string } {
  if (actual === expected) {
    return { score: 1.0, reason: `Status "${actual}" matches expected` };
  }
  // Partial credit for adjacent statuses
  const statusOrder = ["not_ready", "caution", "ready"];
  const actualIdx = statusOrder.indexOf(actual);
  const expectedIdx = statusOrder.indexOf(expected);
  if (Math.abs(actualIdx - expectedIdx) === 1) {
    return { score: 0.5, reason: `Status "${actual}" is adjacent to expected "${expected}"` };
  }
  return { score: 0.0, reason: `Status "${actual}" does not match expected "${expected}"` };
}

/**
 * Scoring metric: Risk factor coverage
 */
function riskFactorCoverage(
  actualCount: number,
  expected: { min: number; max: number }
): { score: number; reason: string } {
  if (actualCount >= expected.min && actualCount <= expected.max) {
    return { score: 1.0, reason: `Found ${actualCount} high-risk factors (expected ${expected.min}-${expected.max})` };
  }
  if (actualCount < expected.min) {
    return { score: 0.5, reason: `Only found ${actualCount} high-risk factors (expected at least ${expected.min})` };
  }
  return { score: 0.8, reason: `Found ${actualCount} high-risk factors (more than expected max ${expected.max})` };
}

/**
 * Run discharge analysis for a patient
 */
async function analyzePatient(patientId: string): Promise<DischargeAnalysis> {
  const patient = getPatient(patientId);
  if (!patient) {
    throw new Error(`Patient ${patientId} not found`);
  }

  const interactions = await checkDrugInteractions(patient.medications);
  const careGaps = evaluateCareGaps(patient);

  // Build risk factors
  const riskFactors: RiskFactor[] = [];
  let score = 100;

  // Process drug interactions
  for (const interaction of interactions) {
    const severity: "high" | "moderate" | "low" =
      interaction.severity === "major" ? "high" : interaction.severity === "moderate" ? "moderate" : "low";
    const deduction = severity === "high" ? 20 : severity === "moderate" ? 10 : 5;
    score -= deduction;

    riskFactors.push({
      id: `di-${riskFactors.length}`,
      severity,
      category: "drug_interaction",
      title: `${interaction.drug1} + ${interaction.drug2}`,
      description: interaction.description,
      source: "FDA",
      actionable: true,
    });
  }

  // Process care gaps
  for (const gap of careGaps.filter((g) => g.status === "unmet")) {
    const severity: "high" | "moderate" | "low" =
      gap.grade === "A" ? "high" : gap.grade === "B" ? "moderate" : "low";
    const deduction = severity === "high" ? 15 : severity === "moderate" ? 8 : 3;
    score -= deduction;

    riskFactors.push({
      id: `cg-${riskFactors.length}`,
      severity,
      category: "care_gap",
      title: gap.guideline,
      description: `Grade ${gap.grade} recommendation not met`,
      source: "Guidelines",
      actionable: true,
    });
  }

  // Process abnormal labs
  for (const lab of patient.recentLabs?.filter((l) => l.abnormal) || []) {
    score -= 5;
    riskFactors.push({
      id: `lab-${riskFactors.length}`,
      severity: "low",
      category: "lab_abnormality",
      title: `Abnormal ${lab.name}`,
      description: `${lab.name}: ${lab.value} ${lab.unit} (ref: ${lab.referenceRange})`,
      source: "FHIR",
      actionable: false,
    });
  }

  score = Math.max(0, Math.min(100, score));

  let status: "ready" | "caution" | "not_ready";
  if (score >= 70) status = "ready";
  else if (score >= 40) status = "caution";
  else status = "not_ready";

  return {
    patientId,
    score,
    status,
    riskFactors: riskFactors.sort((a, b) => {
      const order = { high: 0, moderate: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    }),
    recommendations: [
      "Review medication regimen",
      "Schedule follow-up within 7-14 days",
      "Complete patient education",
    ],
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Run a full evaluation experiment with Opik
 */
export async function runEvaluationExperiment(
  experimentName: string = "discharge-readiness-eval"
): Promise<{
  experimentName: string;
  results: Array<{
    patientId: string;
    analysis: DischargeAnalysis;
    scores: {
      scoreAccuracy: number;
      statusCorrectness: number;
      riskFactorCoverage: number;
      overall: number;
    };
    latencyMs: number;
  }>;
  summary: {
    avgScore: number;
    avgLatency: number;
    passRate: number;
  };
}> {
  const opik = getOpikClient();
  const results: Array<{
    patientId: string;
    analysis: DischargeAnalysis;
    scores: {
      scoreAccuracy: number;
      statusCorrectness: number;
      riskFactorCoverage: number;
      overall: number;
    };
    latencyMs: number;
  }> = [];

  // Create experiment trace
  const experimentTrace = opik.trace({
    name: experimentName,
    input: {
      dataset_size: EVALUATION_DATASET.length,
      test_cases: EVALUATION_DATASET.map((d) => d.patientId),
    },
    metadata: {
      category: "experiment",
      experiment_type: "discharge_readiness_evaluation",
      dataset_version: "1.0",
    },
  });

  for (const testCase of EVALUATION_DATASET) {
    const startTime = Date.now();

    // Create span for this test case
    const testSpan = experimentTrace.span({
      name: `eval-${testCase.patientId}`,
      input: {
        patient_id: testCase.patientId,
        patient_name: testCase.patientName,
        expected_score_range: testCase.expectedScoreRange,
        expected_status: testCase.expectedStatus,
        description: testCase.description,
      },
      metadata: {
        test_case: testCase.patientId,
      },
    });

    try {
      // Run analysis
      const analysis = await analyzePatient(testCase.patientId);
      const latencyMs = Date.now() - startTime;

      // Calculate scores
      const scoreAccuracyResult = scoreAccuracy(analysis.score, testCase.expectedScoreRange);
      const statusCorrectnessResult = statusCorrectness(analysis.status, testCase.expectedStatus);
      const highRiskCount = analysis.riskFactors.filter((r) => r.severity === "high").length;
      const riskCoverageResult = riskFactorCoverage(highRiskCount, testCase.expectedHighRiskCount);

      const overallScore =
        (scoreAccuracyResult.score * 0.4 +
          statusCorrectnessResult.score * 0.4 +
          riskCoverageResult.score * 0.2);

      // Update span with output and scores
      testSpan.update({
        output: {
          score: analysis.score,
          status: analysis.status,
          risk_factor_count: analysis.riskFactors.length,
          high_risk_count: highRiskCount,
          recommendations: analysis.recommendations,
        },
        metadata: {
          latency_ms: latencyMs,
          score_accuracy: scoreAccuracyResult.score,
          score_accuracy_reason: scoreAccuracyResult.reason,
          status_correctness: statusCorrectnessResult.score,
          status_correctness_reason: statusCorrectnessResult.reason,
          risk_coverage: riskCoverageResult.score,
          risk_coverage_reason: riskCoverageResult.reason,
          overall_score: overallScore,
          passed: overallScore >= 0.7,
        },
      });

      // Log feedback scores
      testSpan.logFeedbackScores([
        { name: "score_accuracy", value: scoreAccuracyResult.score, reason: scoreAccuracyResult.reason },
        { name: "status_correctness", value: statusCorrectnessResult.score, reason: statusCorrectnessResult.reason },
        { name: "risk_coverage", value: riskCoverageResult.score, reason: riskCoverageResult.reason },
        { name: "overall", value: overallScore },
      ]);

      testSpan.end();

      results.push({
        patientId: testCase.patientId,
        analysis,
        scores: {
          scoreAccuracy: scoreAccuracyResult.score,
          statusCorrectness: statusCorrectnessResult.score,
          riskFactorCoverage: riskCoverageResult.score,
          overall: overallScore,
        },
        latencyMs,
      });
    } catch (error) {
      testSpan.update({
        output: { error: error instanceof Error ? error.message : "Unknown error" },
        metadata: { success: false, error: true },
      });
      testSpan.end();
    }
  }

  // Calculate summary
  const avgScore = results.length > 0
    ? results.reduce((sum, r) => sum + r.scores.overall, 0) / results.length
    : 0;
  const avgLatency = results.length > 0
    ? results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length
    : 0;
  const passRate = results.length > 0
    ? results.filter((r) => r.scores.overall >= 0.7).length / results.length
    : 0;

  // Update experiment trace with summary
  experimentTrace.update({
    output: {
      total_cases: EVALUATION_DATASET.length,
      completed_cases: results.length,
      avg_overall_score: avgScore,
      avg_latency_ms: avgLatency,
      pass_rate: passRate,
    },
    metadata: {
      success: true,
      avg_score: avgScore,
      pass_rate: passRate,
    },
  });

  // Log experiment-level feedback
  experimentTrace.logFeedbackScores([
    { name: "avg_overall_score", value: avgScore },
    { name: "pass_rate", value: passRate },
  ]);

  experimentTrace.end();

  // Flush to ensure data is sent
  await opik.flush();

  return {
    experimentName,
    results,
    summary: {
      avgScore,
      avgLatency,
      passRate,
    },
  };
}

/**
 * Create/update the evaluation dataset in Opik
 */
export async function createEvaluationDataset(): Promise<void> {
  const opik = getOpikClient();

  try {
    const dataset = opik.getOrCreateDataset("discharge-readiness-test-cases");

    // Insert test cases
    await dataset.insert(
      EVALUATION_DATASET.map((tc) => ({
        input: {
          patient_id: tc.patientId,
          patient_name: tc.patientName,
          description: tc.description,
        },
        expected_output: {
          score_range: tc.expectedScoreRange,
          status: tc.expectedStatus,
          high_risk_count_range: tc.expectedHighRiskCount,
        },
      }))
    );

    await opik.flush();
    console.log("Dataset created/updated successfully");
  } catch (error) {
    console.error("Failed to create dataset:", error);
  }
}

/**
 * Log a single analysis with full input/output to Opik
 */
export async function logAnalysisTrace(
  patientId: string,
  input: {
    patient: Patient;
    medications: Patient["medications"];
    conditions: string[];
  },
  output: DischargeAnalysis,
  latencyMs: number
): Promise<void> {
  const opik = getOpikClient();

  const trace = opik.trace({
    name: "discharge-analysis",
    input: {
      patient_id: patientId,
      patient_name: input.patient.name,
      patient_age: input.patient.age,
      medication_count: input.medications.length,
      medications: input.medications.map((m) => m.name).join(", "),
      conditions: input.conditions.join(", "),
    },
    output: {
      score: output.score,
      status: output.status,
      risk_factor_count: output.riskFactors.length,
      high_risk_factors: output.riskFactors
        .filter((r) => r.severity === "high")
        .map((r) => r.title)
        .join(", "),
      recommendations: output.recommendations.join("; "),
    },
    metadata: {
      category: "analysis",
      latency_ms: latencyMs,
      score: output.score,
      status: output.status,
    },
  });

  // Add spans for each step
  const dataSpan = trace.span({
    name: "data-collection",
    input: { patient_id: patientId },
    output: { medication_count: input.medications.length },
  });
  dataSpan.end();

  const analysisSpan = trace.span({
    name: "risk-analysis",
    input: { medication_count: input.medications.length },
    output: {
      risk_factors_found: output.riskFactors.length,
      score: output.score,
    },
  });
  analysisSpan.end();

  trace.end();
  await opik.flush();
}
