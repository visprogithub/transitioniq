import { NextRequest, NextResponse } from "next/server";
import { logEvaluationScore } from "@/lib/integrations/opik";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions } from "@/lib/integrations/fda-client";
import { evaluateCareGaps } from "@/lib/integrations/guidelines-client";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";
import type { Patient } from "@/lib/types/patient";

// Ground truth test cases with expected scores
const TEST_CASES = [
  {
    patientId: "demo-polypharmacy",
    expectedScore: 35, // High risk due to drug interactions
    expectedStatus: "not_ready",
    description: "John Smith - 12 meds, warfarin+aspirin+eliquis interactions",
  },
  {
    patientId: "demo-heart-failure",
    expectedScore: 45, // Moderate risk - CHF patient
    expectedStatus: "caution",
    description: "Mary Johnson - CHF + COPD, elevated BNP",
  },
  {
    patientId: "demo-ready",
    expectedScore: 85, // Low risk - simple appendectomy
    expectedStatus: "ready",
    description: "Robert Chen - Post-appendectomy, stable",
  },
];

export async function GET() {
  return NextResponse.json({
    message: "Evaluation endpoint",
    testCases: TEST_CASES,
    usage: "POST to run evaluation with Opik tracking",
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_request: NextRequest) {
  try {
    const results: Array<{
      patientId: string;
      description: string;
      expectedScore: number;
      actualScore: number;
      expectedStatus: string;
      actualStatus: string;
      scoreDiff: number;
      passed: boolean;
    }> = [];

    let totalPassed = 0;
    let totalFailed = 0;

    for (const testCase of TEST_CASES) {
      const patient = getPatient(testCase.patientId);
      if (!patient) continue;

      // Run analysis
      const analysis = await computeAnalysis(patient);

      const scoreDiff = Math.abs(analysis.score - testCase.expectedScore);
      const statusMatch = analysis.status === testCase.expectedStatus;
      const passed = scoreDiff <= 15 && statusMatch;

      if (passed) {
        totalPassed++;
      } else {
        totalFailed++;
      }

      // Log to Opik
      await logEvaluationScore(
        "discharge-score-accuracy",
        testCase.patientId,
        analysis.score,
        testCase.expectedScore,
        {
          expected_status: testCase.expectedStatus,
          actual_status: analysis.status,
          status_match: statusMatch,
          passed,
        }
      );

      results.push({
        patientId: testCase.patientId,
        description: testCase.description,
        expectedScore: testCase.expectedScore,
        actualScore: analysis.score,
        expectedStatus: testCase.expectedStatus,
        actualStatus: analysis.status,
        scoreDiff,
        passed,
      });
    }

    return NextResponse.json({
      summary: {
        totalCases: TEST_CASES.length,
        passed: totalPassed,
        failed: totalFailed,
        passRate: `${Math.round((totalPassed / TEST_CASES.length) * 100)}%`,
      },
      results,
      note: "Evaluation results logged to Opik dashboard",
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
 * Compute analysis for evaluation (simplified version without Gemini)
 */
async function computeAnalysis(patient: Patient): Promise<DischargeAnalysis> {
  // Get drug interactions
  let drugInteractions: Array<{
    drug1: string;
    drug2: string;
    severity: "major" | "moderate" | "minor";
    description: string;
    source: string;
  }> = [];

  try {
    drugInteractions = await checkDrugInteractions(patient.medications);
  } catch {
    // Use known interactions fallback
    drugInteractions = getKnownInteractions(patient);
  }

  // Get care gaps
  const careGaps = evaluateCareGaps(patient);
  const unmetCareGaps = careGaps.filter((g) => g.status === "unmet");

  // Calculate score
  const riskFactors: RiskFactor[] = [];
  let score = 100;

  // Drug interactions
  for (const interaction of drugInteractions) {
    // Map FDA severity to RiskFactor severity
    const fdaSeverity = interaction.severity;
    const severity: "high" | "moderate" | "low" = fdaSeverity === "major" ? "high" : fdaSeverity === "moderate" ? "moderate" : "low";
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
      resolution: "Review medication regimen",
    });
  }

  // Care gaps
  for (const gap of unmetCareGaps) {
    const severity = gap.grade === "A" ? "high" : gap.grade === "B" ? "moderate" : "low";
    const deduction = severity === "high" ? 15 : severity === "moderate" ? 8 : 3;
    score -= deduction;

    riskFactors.push({
      id: `cg-${riskFactors.length}`,
      severity,
      category: "care_gap",
      title: gap.guideline,
      description: gap.recommendation,
      source: "Guidelines",
      actionable: true,
    });
  }

  // Lab abnormalities
  const abnormalLabs = patient.recentLabs?.filter((l) => l.abnormal) || [];
  for (const lab of abnormalLabs) {
    let severity: "high" | "moderate" | "low" = "low";
    let deduction = 5;

    if (lab.name.toLowerCase().includes("inr") && (lab.value > 4 || lab.value < 1.5)) {
      severity = "high";
      deduction = 15;
    } else if (lab.name.toLowerCase().includes("bnp") && lab.value > 500) {
      severity = "moderate";
      deduction = 10;
    }

    score -= deduction;

    riskFactors.push({
      id: `lab-${riskFactors.length}`,
      severity,
      category: "lab_abnormality",
      title: `Abnormal ${lab.name}`,
      description: `${lab.name}: ${lab.value} ${lab.unit} (ref: ${lab.referenceRange})`,
      source: "FHIR",
      actionable: severity !== "low",
    });
  }

  score = Math.max(0, Math.min(100, score));

  let status: "ready" | "caution" | "not_ready";
  if (score >= 70) status = "ready";
  else if (score >= 40) status = "caution";
  else status = "not_ready";

  return {
    patientId: patient.id,
    score,
    status,
    riskFactors: riskFactors.sort((a, b) => {
      const order = { high: 0, moderate: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    }),
    recommendations: [],
    analyzedAt: new Date().toISOString(),
  };
}

function getKnownInteractions(patient: Patient) {
  const interactions: Array<{
    drug1: string;
    drug2: string;
    severity: "major" | "moderate" | "minor";
    description: string;
    source: string;
  }> = [];

  const medNames = patient.medications.map((m) => m.name.toLowerCase());

  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("aspirin"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Aspirin",
      severity: "major",
      description: "Increased bleeding risk",
      source: "Clinical Guidelines",
    });
  }

  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("eliquis"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Eliquis",
      severity: "major",
      description: "Dual anticoagulation - high bleeding risk",
      source: "Clinical Guidelines",
    });
  }

  return interactions;
}
