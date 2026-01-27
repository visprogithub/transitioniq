/**
 * Model Evaluation API - Compare different LLM models using Opik
 *
 * This endpoint allows:
 * - Running evaluation experiments across different models
 * - Comparing model outputs for the same patient
 * - Tracking results in Opik for analysis
 */

import { NextRequest, NextResponse } from "next/server";
import { Opik } from "opik";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions } from "@/lib/integrations/fda-client";
import { evaluateCareGaps } from "@/lib/integrations/guidelines-client";
import {
  setActiveModel,
  getAvailableModels,
  getAllModels,
  getActiveModelId,
  getConfiguredProviders,
  getModelConfig,
} from "@/lib/integrations/llm-provider";
import { analyzeDischargeReadiness, resetLLMProvider } from "@/lib/integrations/analysis";
import type { DischargeAnalysis } from "@/lib/types/analysis";

// Test patients for evaluation
const EVAL_PATIENTS = ["demo-polypharmacy", "demo-heart-failure", "demo-ready"];

// Expected outcomes for scoring
const EXPECTED_OUTCOMES: Record<string, { scoreRange: [number, number]; status: string }> = {
  "demo-polypharmacy": { scoreRange: [0, 50], status: "not_ready" },
  "demo-heart-failure": { scoreRange: [30, 70], status: "caution" },
  "demo-ready": { scoreRange: [70, 100], status: "ready" },
};

/**
 * GET - List available models for evaluation
 */
export async function GET() {
  const availableModels = getAvailableModels();
  const allModels = getAllModels();
  const configuredProviders = getConfiguredProviders();

  // Build model info with provider details
  const modelInfo = allModels.map((modelId) => {
    const config = getModelConfig(modelId);
    return {
      id: modelId,
      provider: config?.provider || "unknown",
      available: availableModels.includes(modelId),
      displayName: modelId,
    };
  });

  return NextResponse.json({
    availableModels,
    allModels: modelInfo,
    configuredProviders,
    activeModel: getActiveModelId(),
    testPatients: EVAL_PATIENTS,
    expectedOutcomes: EXPECTED_OUTCOMES,
    apiKeyStatus: {
      gemini: !!process.env.GEMINI_API_KEY,
      groq: !!process.env.GROQ_API_KEY,
      huggingface: !!process.env.HF_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
    },
  });
}

/**
 * POST - Run model evaluation experiment
 *
 * Body:
 * - models: string[] (optional - defaults to all available)
 * - patients: string[] (optional - defaults to EVAL_PATIENTS)
 * - experimentName: string (optional - for Opik tracking)
 */
export async function POST(request: NextRequest) {
  const availableModels = getAvailableModels();
  if (availableModels.length === 0) {
    return NextResponse.json(
      {
        error: "No LLM API keys configured. Set at least one of: GEMINI_API_KEY, GROQ_API_KEY, or HF_API_KEY",
        hint: "GROQ_API_KEY is recommended - free tier at https://console.groq.com/",
      },
      { status: 500 }
    );
  }

  const body = await request.json();
  const modelsToEval = body.models || getAvailableModels();
  const patientsToEval = body.patients || EVAL_PATIENTS;
  const experimentName = body.experimentName || `model-eval-${Date.now()}`;

  // Initialize Opik for experiment tracking
  let opik: Opik | null = null;
  if (process.env.OPIK_API_KEY) {
    opik = new Opik({
      apiKey: process.env.OPIK_API_KEY,
      projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
    });
  }

  // Create experiment trace
  const experimentTrace = opik?.trace({
    name: experimentName,
    input: {
      models: modelsToEval,
      patients: patientsToEval,
      expected_outcomes: EXPECTED_OUTCOMES,
    },
    metadata: {
      category: "model_evaluation",
      experiment_type: "model_comparison",
    },
  });

  const results: Array<{
    model: string;
    patient: string;
    analysis: DischargeAnalysis | null;
    error?: string;
    latencyMs: number;
    scores: {
      scoreAccuracy: number;
      statusMatch: boolean;
      overall: number;
    } | null;
  }> = [];

  // Run evaluation for each model and patient combination
  for (const modelId of modelsToEval) {
    // Set the active model
    try {
      setActiveModel(modelId);
      resetLLMProvider(); // Reset to pick up new model
    } catch (e) {
      console.error(`Failed to set model ${modelId}:`, e);
      continue;
    }

    for (const patientId of patientsToEval) {
      const startTime = Date.now();

      // Create span for this evaluation
      const evalSpan = experimentTrace?.span({
        name: `eval-${modelId}-${patientId}`,
        input: {
          model: modelId,
          patient_id: patientId,
          expected: EXPECTED_OUTCOMES[patientId],
        },
        metadata: {
          model_id: modelId,
          patient_id: patientId,
        },
      });

      try {
        // Get patient data
        const patient = getPatient(patientId);
        if (!patient) {
          throw new Error(`Patient ${patientId} not found`);
        }

        // Get supporting data
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

        // Run analysis with current model
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

        const latencyMs = Date.now() - startTime;

        // Calculate scores
        const expected = EXPECTED_OUTCOMES[patientId];
        const scoreInRange = analysis.score >= expected.scoreRange[0] && analysis.score <= expected.scoreRange[1];
        const statusMatch = analysis.status === expected.status;
        const scoreAccuracy = scoreInRange ? 1.0 : Math.max(0, 1 - Math.abs(analysis.score - (expected.scoreRange[0] + expected.scoreRange[1]) / 2) / 50);
        const overall = (scoreAccuracy * 0.5) + (statusMatch ? 0.5 : 0);

        // Update span with results
        evalSpan?.update({
          output: {
            score: analysis.score,
            status: analysis.status,
            risk_factor_count: analysis.riskFactors.length,
            recommendations: analysis.recommendations,
          },
          metadata: {
            latency_ms: latencyMs,
            score_accuracy: scoreAccuracy,
            status_match: statusMatch,
            overall_score: overall,
            passed: overall >= 0.7,
          },
        });
        evalSpan?.end();

        results.push({
          model: modelId,
          patient: patientId,
          analysis,
          latencyMs,
          scores: {
            scoreAccuracy,
            statusMatch,
            overall,
          },
        });
      } catch (error) {
        const latencyMs = Date.now() - startTime;

        evalSpan?.update({
          output: {
            error: error instanceof Error ? error.message : "Unknown error",
          },
          metadata: {
            success: false,
            error: true,
            latency_ms: latencyMs,
          },
        });
        evalSpan?.end();

        results.push({
          model: modelId,
          patient: patientId,
          analysis: null,
          error: error instanceof Error ? error.message : "Unknown error",
          latencyMs,
          scores: null,
        });
      }
    }
  }

  // Calculate summary statistics per model
  const modelSummaries: Record<string, {
    avgScore: number;
    avgLatency: number;
    passRate: number;
    errorCount: number;
  }> = {};

  for (const modelId of modelsToEval) {
    const modelResults = results.filter((r) => r.model === modelId);
    const successfulResults = modelResults.filter((r) => r.scores !== null);

    modelSummaries[modelId] = {
      avgScore: successfulResults.length > 0
        ? successfulResults.reduce((sum, r) => sum + (r.scores?.overall || 0), 0) / successfulResults.length
        : 0,
      avgLatency: modelResults.length > 0
        ? modelResults.reduce((sum, r) => sum + r.latencyMs, 0) / modelResults.length
        : 0,
      passRate: successfulResults.length > 0
        ? successfulResults.filter((r) => (r.scores?.overall || 0) >= 0.7).length / successfulResults.length
        : 0,
      errorCount: modelResults.filter((r) => r.error).length,
    };
  }

  // Update experiment trace with summary
  experimentTrace?.update({
    output: {
      total_evaluations: results.length,
      successful_evaluations: results.filter((r) => r.scores !== null).length,
      model_summaries: modelSummaries,
    },
    metadata: {
      success: true,
    },
  });
  experimentTrace?.end();

  // Flush Opik data
  if (opik) {
    await opik.flush();
  }

  return NextResponse.json({
    experimentName,
    models: modelsToEval,
    patients: patientsToEval,
    results,
    modelSummaries,
    opikDashboardUrl: process.env.OPIK_API_KEY
      ? `https://www.comet.com/opik/${process.env.OPIK_PROJECT_NAME || "transitioniq"}`
      : null,
  });
}
