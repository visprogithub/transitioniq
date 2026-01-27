import { NextRequest, NextResponse } from "next/server";
import { evaluateWithLLMJudge, batchEvaluateWithJudge } from "@/lib/evaluation/llm-judge";
import { getPatient } from "@/lib/data/demo-patients";
import type { DischargeAnalysis } from "@/lib/types/analysis";

interface SingleJudgeRequest {
  patientId: string;
  analysis: DischargeAnalysis;
  modelId?: string;
}

interface BatchJudgeRequest {
  evaluations: Array<{
    patientId: string;
    analysis: DischargeAnalysis;
  }>;
  modelId?: string;
}

/**
 * POST /api/evaluate/judge
 *
 * Run LLM-as-Judge evaluation on a discharge analysis.
 * Supports single evaluation or batch mode.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Check if this is a batch request
    if (body.evaluations && Array.isArray(body.evaluations)) {
      // Batch mode
      const batchRequest = body as BatchJudgeRequest;

      // Get patients
      const evaluationsWithPatients = batchRequest.evaluations
        .map((e) => ({
          patient: getPatient(e.patientId),
          analysis: e.analysis,
        }))
        .filter((e) => e.patient !== null) as Array<{
        patient: NonNullable<ReturnType<typeof getPatient>>;
        analysis: DischargeAnalysis;
      }>;

      if (evaluationsWithPatients.length === 0) {
        return NextResponse.json(
          { error: "No valid patients found in batch request" },
          { status: 400 }
        );
      }

      const results = await batchEvaluateWithJudge(
        evaluationsWithPatients,
        batchRequest.modelId
      );

      // Calculate aggregate stats
      const overallScores = results.map((r) => r.evaluation.overall);
      const avgOverall =
        overallScores.reduce((a, b) => a + b, 0) / overallScores.length;

      const safetyScores = results.map((r) => r.evaluation.safety.score);
      const avgSafety =
        safetyScores.reduce((a, b) => a + b, 0) / safetyScores.length;

      return NextResponse.json({
        mode: "batch",
        totalEvaluated: results.length,
        results,
        aggregates: {
          avgOverall: Math.round(avgOverall * 100) / 100,
          avgSafety: Math.round(avgSafety * 100) / 100,
          passingSafetyThreshold: results.filter(
            (r) => r.evaluation.safety.score >= 0.7
          ).length,
        },
        evaluatedAt: new Date().toISOString(),
      });
    } else {
      // Single evaluation mode
      const singleRequest = body as SingleJudgeRequest;

      if (!singleRequest.patientId) {
        return NextResponse.json(
          { error: "patientId is required" },
          { status: 400 }
        );
      }

      if (!singleRequest.analysis) {
        return NextResponse.json(
          { error: "analysis is required" },
          { status: 400 }
        );
      }

      const patient = getPatient(singleRequest.patientId);
      if (!patient) {
        return NextResponse.json(
          { error: "Patient not found" },
          { status: 404 }
        );
      }

      const evaluation = await evaluateWithLLMJudge(
        patient,
        singleRequest.analysis,
        singleRequest.modelId
      );

      return NextResponse.json({
        mode: "single",
        patientId: singleRequest.patientId,
        evaluation,
        passesSafetyThreshold: evaluation.safety.score >= 0.7,
        evaluatedAt: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("[Judge API] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Evaluation failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/evaluate/judge
 *
 * Returns information about the LLM-as-Judge evaluation system.
 */
export async function GET() {
  return NextResponse.json({
    name: "LLM-as-Judge Evaluation",
    description:
      "Uses a secondary LLM to evaluate discharge assessments on safety, accuracy, actionability, and completeness",
    dimensions: [
      {
        name: "safety",
        weight: 0.4,
        description:
          "Does the assessment identify all critical risks? Would acting on it harm the patient?",
      },
      {
        name: "accuracy",
        weight: 0.25,
        description:
          "Is the score appropriate? Are risk factors correctly categorized?",
      },
      {
        name: "actionability",
        weight: 0.2,
        description:
          "Are recommendations specific and implementable by clinicians?",
      },
      {
        name: "completeness",
        weight: 0.15,
        description:
          "Are all relevant patient factors considered? Any obvious gaps?",
      },
    ],
    safetyThreshold: 0.7,
    usage: {
      single:
        'POST { "patientId": "demo-polypharmacy", "analysis": {...} }',
      batch:
        'POST { "evaluations": [{ "patientId": "...", "analysis": {...} }] }',
    },
  });
}
