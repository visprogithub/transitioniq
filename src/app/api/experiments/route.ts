/**
 * Experiments API - Run A/B experiments and view results
 *
 * GET /api/experiments - List available experiments
 * POST /api/experiments - Run an experiment
 */

import { NextRequest, NextResponse } from "next/server";
import {
  listExperiments,
  getExperiment,
  runExperiment,
  type ExperimentSummary,
} from "@/lib/agents/experiments";
import { listPrompts, getLatestPrompt, getPromptVersion } from "@/lib/agents/prompts";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions } from "@/lib/integrations/fda-client";
import { evaluateCareGaps } from "@/lib/integrations/guidelines-client";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";
import type { Patient } from "@/lib/types/patient";

/**
 * GET /api/experiments
 * Returns available experiments and prompts
 */
export async function GET() {
  return NextResponse.json({
    experiments: listExperiments(),
    prompts: listPrompts(),
    message: "Available experiments and prompts for A/B testing",
  });
}

/**
 * POST /api/experiments
 * Run an experiment
 *
 * Body: { experimentId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { experimentId } = body;

    if (!experimentId) {
      return NextResponse.json(
        { error: "experimentId is required" },
        { status: 400 }
      );
    }

    const experiment = getExperiment(experimentId);
    if (!experiment) {
      return NextResponse.json(
        { error: `Experiment ${experimentId} not found` },
        { status: 404 }
      );
    }

    // Run the experiment
    const summary = await runExperiment(experiment, async (promptVersion, patientId) => {
      // This is the analyze function that runs for each variant
      return await analyzeWithPromptVersion(promptVersion, patientId);
    });

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("Experiment error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Experiment failed" },
      { status: 500 }
    );
  }
}

/**
 * Run discharge analysis with a specific prompt version
 * This simulates what Gemini would return based on the prompt version
 */
async function analyzeWithPromptVersion(
  promptVersion: string,
  patientId: string
): Promise<DischargeAnalysis> {
  const patient = getPatient(patientId);
  if (!patient) {
    throw new Error(`Patient ${patientId} not found`);
  }

  // Get drug interactions
  const interactions = await checkDrugInteractions(patient.medications);

  // Get care gaps
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
      title: `${interaction.drug1} + ${interaction.drug2} Interaction`,
      description: interaction.description,
      source: "FDA",
      actionable: true,
    });
  }

  // Process care gaps
  const unmetGaps = careGaps.filter((g) => g.status === "unmet");
  for (const gap of unmetGaps) {
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

  score = Math.max(0, Math.min(100, score));

  // Determine status
  let status: "ready" | "caution" | "not_ready";
  if (score >= 70) status = "ready";
  else if (score >= 40) status = "caution";
  else status = "not_ready";

  // Enhanced prompt (v1.1) adds confidence score
  const isEnhanced = promptVersion === "1.1.0";
  const baseAnalysis: DischargeAnalysis = {
    patientId,
    score,
    status,
    riskFactors: riskFactors.sort((a, b) => {
      const order = { high: 0, moderate: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    }),
    recommendations: [
      "Review medication regimen with pharmacist",
      "Schedule follow-up within 7-14 days",
      "Ensure patient education completed",
    ],
    analyzedAt: new Date().toISOString(),
  };

  // Add confidence for enhanced prompt
  if (isEnhanced) {
    return {
      ...baseAnalysis,
      // @ts-ignore - confidence is added by enhanced prompt
      confidence: 0.85 + Math.random() * 0.1, // 0.85-0.95 for demo
      readmissionRisk: score < 40 ? "high" : score < 70 ? "moderate" : "low",
    };
  }

  return baseAnalysis;
}
