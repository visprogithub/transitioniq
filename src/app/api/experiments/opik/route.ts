/**
 * Opik Experiments API Route
 *
 * POST /api/experiments/opik - Run an Opik experiment
 * GET /api/experiments/opik - Get Opik dashboard URLs
 */

import { NextRequest, NextResponse } from "next/server";
import {
  runOpikExperiment,
  getOrCreateOpikDataset,
  getOpikExperimentsUrl,
  getOpikTracesUrl,
} from "@/lib/integrations/opik-experiments";

export async function POST(request: NextRequest) {
  try {
    // Check for Opik API key
    if (!process.env.OPIK_API_KEY) {
      return NextResponse.json(
        {
          error: "OPIK_API_KEY not configured",
          message: "Please set OPIK_API_KEY in your environment variables to run experiments.",
        },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const experimentName = body.experimentName || `discharge-eval-${Date.now()}`;
    const createDataset = body.createDataset !== false;

    // Optionally create/update the dataset first
    if (createDataset) {
      try {
        await getOrCreateOpikDataset();
      } catch (error) {
        console.warn("[Opik] Failed to create dataset:", error);
        // Continue anyway - the experiment can still run
      }
    }

    // Run the experiment
    const result = await runOpikExperiment(experimentName);

    return NextResponse.json({
      success: true,
      experimentName: result.experimentName,
      experimentId: result.experimentId,
      opikDashboardUrl: result.opikDashboardUrl,
      summary: result.summary,
      results: result.results.map((r) => ({
        patientId: r.patientId,
        score: r.analysis.score,
        status: r.analysis.status,
        riskFactorCount: r.analysis.riskFactors.length,
        highRiskCount: r.analysis.riskFactors.filter((rf) => rf.severity === "high").length,
        scores: r.scores,
        passed: r.passed,
        latencyMs: r.latencyMs,
      })),
      urls: {
        experiments: getOpikExperimentsUrl(),
        traces: getOpikTracesUrl(),
      },
    });
  } catch (error) {
    console.error("[Opik Experiment API] Error:", error);
    return NextResponse.json(
      {
        error: "Experiment failed",
        message: error instanceof Error ? error.message : "Unknown error",
        urls: {
          experiments: getOpikExperimentsUrl(),
          traces: getOpikTracesUrl(),
        },
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Return Opik dashboard URLs and status
  const opikConfigured = !!process.env.OPIK_API_KEY;
  const projectName = process.env.OPIK_PROJECT_NAME || "transitioniq";

  return NextResponse.json({
    opikConfigured,
    projectName,
    urls: {
      experiments: getOpikExperimentsUrl(),
      traces: getOpikTracesUrl(),
      dashboard: `https://www.comet.com/opik/${projectName}`,
    },
    message: opikConfigured
      ? "Opik is configured. POST to this endpoint to run an experiment."
      : "OPIK_API_KEY not configured. Set it to enable experiments.",
  });
}
