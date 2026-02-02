/**
 * Opik Experiments API Route
 *
 * POST /api/experiments/opik - Run Opik experiment(s) against selected models
 * GET /api/experiments/opik - Get Opik dashboard URLs
 */

import { NextRequest, NextResponse } from "next/server";
import {
  runOpikExperiment,
  runMultiModelExperiment,
  getOrCreateOpikDataset,
  getOpikExperimentsUrl,
  getOpikTracesUrl,
  EXPERIMENT_DATASET,
  CORE_DATASET,
} from "@/lib/integrations/opik-experiments";
import { getAvailableModels } from "@/lib/integrations/llm-provider";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";

// Cloud uses 3 core patients (~30s/model). Still allow 5 min for multi-model.
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  // Rate limit: expensive multi-model experiment
  const blocked = applyRateLimit(request, "evaluation");
  if (blocked) return blocked;

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

    // Accept multiple models or a single model
    const requestedModels: string[] = body.models || (body.modelId ? [body.modelId] : []);
    const availableModels = getAvailableModels();

    // Filter to only available models, or use all available if none specified
    const modelsToRun = requestedModels.length > 0
      ? requestedModels.filter((m: string) => availableModels.includes(m))
      : availableModels.length > 0
        ? [availableModels[0]]
        : [];

    if (modelsToRun.length === 0) {
      return NextResponse.json(
        {
          error: "No valid models available",
          message: "None of the selected models have API keys configured.",
          availableModels,
        },
        { status: 400 }
      );
    }

    // Optionally create/update the dataset first (cloud uses core 3 patients)
    if (createDataset) {
      try {
        await getOrCreateOpikDataset(undefined, CORE_DATASET);
      } catch (error) {
        console.warn("[Opik] Failed to create dataset:", error);
      }
    }

    // Run experiment(s) with core 3 patients for cloud speed
    if (modelsToRun.length === 1) {
      // Single model - run one experiment
      const result = await runOpikExperiment(experimentName, modelsToRun[0], CORE_DATASET);

      return NextResponse.json({
        success: true,
        experimentName: result.experimentName,
        experimentId: result.experimentId,
        modelId: result.modelId,
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
    } else {
      // Multiple models - run experiments per model for comparison
      const multiResult = await runMultiModelExperiment(experimentName, modelsToRun, CORE_DATASET);

      return NextResponse.json({
        success: true,
        experimentCount: multiResult.experiments.length,
        models: modelsToRun,
        comparison: multiResult.comparison,
        experiments: multiResult.experiments.map((exp) => ({
          experimentName: exp.experimentName,
          experimentId: exp.experimentId,
          modelId: exp.modelId,
          summary: exp.summary,
          results: exp.results.map((r) => ({
            patientId: r.patientId,
            score: r.analysis.score,
            status: r.analysis.status,
            riskFactorCount: r.analysis.riskFactors.length,
            highRiskCount: r.analysis.riskFactors.filter((rf) => rf.severity === "high").length,
            scores: r.scores,
            passed: r.passed,
            latencyMs: r.latencyMs,
          })),
        })),
        opikDashboardUrl: getOpikExperimentsUrl(),
        urls: {
          experiments: getOpikExperimentsUrl(),
          traces: getOpikTracesUrl(),
        },
      });
    }
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

/**
 * PUT /api/experiments/opik - Push/update the evaluation dataset to Opik cloud
 * This allows viewing the dataset in the Opik dashboard without running an experiment.
 */
export async function PUT() {
  try {
    if (!process.env.OPIK_API_KEY) {
      return NextResponse.json(
        {
          error: "OPIK_API_KEY not configured",
          message: "Please set OPIK_API_KEY in your environment variables.",
        },
        { status: 500 }
      );
    }

    const dataset = await getOrCreateOpikDataset(undefined, CORE_DATASET);
    const datasetName = dataset.name || "discharge-readiness-eval";

    return NextResponse.json({
      success: true,
      datasetName,
      itemCount: CORE_DATASET.length,
      totalAvailable: EXPERIMENT_DATASET.length,
      patients: CORE_DATASET.map((tc) => ({
        patientId: tc.patientId,
        patientName: tc.patientName,
        scenario: tc.scenario,
        expectedStatus: tc.expectedStatus,
        expectedScoreRange: tc.expectedScoreRange,
      })),
      message: `Dataset "${datasetName}" pushed to Opik with ${CORE_DATASET.length} core test cases (${EXPERIMENT_DATASET.length} available locally).`,
      urls: {
        experiments: getOpikExperimentsUrl(),
        traces: getOpikTracesUrl(),
      },
    });
  } catch (error) {
    console.error("[Opik Dataset API] Error:", error);
    return NextResponse.json(
      {
        error: "Failed to push dataset",
        message: error instanceof Error ? error.message : "Unknown error",
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
    cloudDatasetSize: CORE_DATASET.length,
    totalDatasetSize: EXPERIMENT_DATASET.length,
    urls: {
      experiments: getOpikExperimentsUrl(),
      traces: getOpikTracesUrl(),
      dashboard: `https://www.comet.com/opik/${projectName}`,
    },
    message: opikConfigured
      ? "Opik is configured. POST to this endpoint to run an experiment. PUT to push the dataset."
      : "OPIK_API_KEY not configured. Set it to enable experiments.",
  });
}
