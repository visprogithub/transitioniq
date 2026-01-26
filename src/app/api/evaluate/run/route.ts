/**
 * Evaluation API - Run Opik evaluations with real datasets and metrics
 *
 * GET /api/evaluate/run - Run full evaluation experiment
 * POST /api/evaluate/run - Run evaluation with custom experiment name
 */

import { NextRequest, NextResponse } from "next/server";
import {
  runEvaluationExperiment,
  createEvaluationDataset,
  EVALUATION_DATASET,
} from "@/lib/agents/evaluation";

/**
 * GET /api/evaluate/run
 * Run evaluation with default experiment name
 */
export async function GET() {
  if (!process.env.OPIK_API_KEY) {
    return NextResponse.json(
      { error: "OPIK_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    // Create/update dataset first
    await createEvaluationDataset();

    // Run the evaluation
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const result = await runEvaluationExperiment(`discharge-eval-${timestamp}`);

    return NextResponse.json({
      success: true,
      experiment: result.experimentName,
      dataset: {
        name: "discharge-readiness-test-cases",
        size: EVALUATION_DATASET.length,
      },
      results: result.results.map((r) => ({
        patientId: r.patientId,
        score: r.analysis.score,
        status: r.analysis.status,
        riskFactors: r.analysis.riskFactors.length,
        highRiskFactors: r.analysis.riskFactors.filter((rf) => rf.severity === "high").length,
        scores: r.scores,
        latencyMs: r.latencyMs,
        passed: r.scores.overall >= 0.7,
      })),
      summary: result.summary,
      opikDashboard: "https://www.comet.com/opik",
    });
  } catch (error) {
    console.error("Evaluation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/evaluate/run
 * Run evaluation with custom experiment name
 */
export async function POST(request: NextRequest) {
  if (!process.env.OPIK_API_KEY) {
    return NextResponse.json(
      { error: "OPIK_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const experimentName = body.experimentName || `discharge-eval-${Date.now()}`;

    // Create/update dataset first
    await createEvaluationDataset();

    // Run the evaluation
    const result = await runEvaluationExperiment(experimentName);

    return NextResponse.json({
      success: true,
      experiment: result.experimentName,
      results: result.results.map((r) => ({
        patientId: r.patientId,
        score: r.analysis.score,
        status: r.analysis.status,
        scores: r.scores,
        latencyMs: r.latencyMs,
        passed: r.scores.overall >= 0.7,
      })),
      summary: result.summary,
    });
  } catch (error) {
    console.error("Evaluation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}
