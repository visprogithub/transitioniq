import { NextRequest, NextResponse } from "next/server";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions, type DrugInteraction } from "@/lib/integrations/fda-client";
import { evaluateCareGaps, type CareGap } from "@/lib/integrations/guidelines-client";
import { analyzeDischargeReadiness } from "@/lib/integrations/gemini";
import { traceGeminiCall, traceDataSourceCall } from "@/lib/integrations/opik";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";
import type { Patient } from "@/lib/types/patient";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId } = body;

    if (!patientId) {
      return NextResponse.json({ error: "patientId required" }, { status: 400 });
    }

    // Get patient data
    const patient = getPatient(patientId);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Run data gathering in parallel with Opik tracing
    const [drugInteractionsResult, careGapsResult] = await Promise.all([
      traceDataSourceCall("FDA", patientId, async () => {
        try {
          return await checkDrugInteractions(patient.medications);
        } catch (error) {
          console.error("FDA check failed:", error);
          return getKnownInteractionsForPatient(patient);
        }
      }),
      traceDataSourceCall("Guidelines", patientId, async () => {
        return evaluateCareGaps(patient);
      }),
    ]);

    const drugInteractions = drugInteractionsResult.result;
    const careGaps = careGapsResult.result;

    // Get unmet care gaps for analysis
    const unmetCareGaps = careGaps.filter((g) => g.status === "unmet");

    // Build cost estimates from patient medications (simplified)
    const costEstimates = estimateMedicationCosts(patient);

    // Try Gemini analysis if API key is available, fall back to computed analysis
    if (process.env.GEMINI_API_KEY) {
      try {
        // Run Gemini analysis with Opik tracing
        const analysisResult = await traceGeminiCall("discharge-analysis", patientId, async () => {
          return await analyzeDischargeReadiness(
            patient,
            drugInteractions,
            unmetCareGaps.map((g) => ({
              guideline: g.guideline,
              recommendation: g.recommendation,
              grade: g.grade,
              status: g.status,
            })),
            costEstimates
          );
        });

        // Add tracing ID to response
        const analysis: DischargeAnalysis = {
          ...analysisResult.result,
          tracingId: analysisResult.traceId,
        };

        return NextResponse.json(analysis);
      } catch (geminiError) {
        console.warn("Gemini analysis failed, using fallback:", geminiError);
        // Fall through to computed analysis
      }
    }

    // Return computed analysis (fallback or when no API key)
    const analysis = computeAnalysisWithoutLLM(
      patient,
      drugInteractions,
      unmetCareGaps,
      costEstimates
    );
    return NextResponse.json(analysis);
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

/**
 * Fallback function to get known drug interactions for common medication combinations
 */
function getKnownInteractionsForPatient(patient: Patient): DrugInteraction[] {
  const interactions: DrugInteraction[] = [];
  const medNames = patient.medications.map((m) => m.name.toLowerCase());

  // Check for warfarin + aspirin
  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("aspirin"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Aspirin",
      severity: "major",
      description: "Concurrent use increases bleeding risk significantly. Monitor INR closely and watch for signs of bleeding.",
      source: "Clinical Guidelines",
    });
  }

  // Check for warfarin + eliquis (dual anticoagulation)
  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("eliquis"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Eliquis (Apixaban)",
      severity: "major",
      description: "Dual anticoagulation therapy significantly increases bleeding risk. Generally contraindicated unless specific clinical indication.",
      source: "Clinical Guidelines",
    });
  }

  // Check for ACE inhibitor + potassium
  if ((medNames.some((m) => m.includes("lisinopril")) || medNames.some((m) => m.includes("enalapril"))) &&
      medNames.some((m) => m.includes("potassium"))) {
    interactions.push({
      drug1: "ACE Inhibitor",
      drug2: "Potassium Chloride",
      severity: "moderate",
      description: "ACE inhibitors can increase potassium levels. Combined with potassium supplements, risk of hyperkalemia increases.",
      source: "Clinical Guidelines",
    });
  }

  // Check for digoxin presence (common interaction concerns)
  if (medNames.some((m) => m.includes("digoxin"))) {
    if (medNames.some((m) => m.includes("furosemide"))) {
      interactions.push({
        drug1: "Digoxin",
        drug2: "Furosemide",
        severity: "moderate",
        description: "Loop diuretics can cause hypokalemia, increasing digoxin toxicity risk. Monitor potassium levels.",
        source: "Clinical Guidelines",
      });
    }
  }

  return interactions;
}

/**
 * Estimate medication costs (simplified - would use real CMS pricing API in production)
 */
function estimateMedicationCosts(patient: Patient): Array<{ medication: string; monthlyOOP: number; covered: boolean }> {
  const highCostMeds = [
    { pattern: "eliquis", cost: 500 },
    { pattern: "xarelto", cost: 450 },
    { pattern: "entresto", cost: 550 },
    { pattern: "jardiance", cost: 450 },
    { pattern: "ozempic", cost: 900 },
    { pattern: "humira", cost: 1200 },
    { pattern: "spiriva", cost: 350 },
  ];

  return patient.medications.map((med) => {
    const medNameLower = med.name.toLowerCase();
    const highCost = highCostMeds.find((hc) => medNameLower.includes(hc.pattern));

    if (highCost) {
      return {
        medication: med.name,
        monthlyOOP: highCost.cost,
        covered: false,
      };
    }

    // Default: assume generic/low cost
    return {
      medication: med.name,
      monthlyOOP: 10,
      covered: true,
    };
  });
}

/**
 * Compute analysis without LLM (fallback when Gemini API not available)
 */
function computeAnalysisWithoutLLM(
  patient: Patient,
  drugInteractions: DrugInteraction[],
  unmetCareGaps: CareGap[],
  costEstimates: Array<{ medication: string; monthlyOOP: number; covered: boolean }>
): DischargeAnalysis {
  const riskFactors: RiskFactor[] = [];
  let score = 100;

  // Add drug interaction risk factors
  for (const interaction of drugInteractions) {
    // Map FDA severity (major/moderate/minor) to RiskFactor severity (high/moderate/low)
    const fdaSeverity = interaction.severity;
    const severity: "high" | "moderate" | "low" = fdaSeverity === "major" ? "high" : fdaSeverity === "moderate" ? "moderate" : "low";
    const scoreDeduction = severity === "high" ? 20 : severity === "moderate" ? 10 : 5;
    score -= scoreDeduction;

    riskFactors.push({
      id: `di-${riskFactors.length}`,
      severity,
      category: "drug_interaction",
      title: `${interaction.drug1} + ${interaction.drug2} Interaction`,
      description: interaction.description,
      source: "FDA",
      actionable: true,
      resolution: severity === "high"
        ? "Review medication regimen with pharmacist and consider alternatives"
        : "Monitor for adverse effects and adjust as needed",
    });
  }

  // Add care gap risk factors
  for (const gap of unmetCareGaps) {
    const severity = gap.grade === "A" ? "high" : gap.grade === "B" ? "moderate" : "low";
    const scoreDeduction = severity === "high" ? 15 : severity === "moderate" ? 8 : 3;
    score -= scoreDeduction;

    riskFactors.push({
      id: `cg-${riskFactors.length}`,
      severity,
      category: "care_gap",
      title: gap.guideline,
      description: gap.recommendation,
      source: "Guidelines",
      actionable: true,
      resolution: `Address ${gap.guideline} per ${gap.organization} guidelines`,
    });
  }

  // Add lab abnormality risk factors
  const abnormalLabs = patient.recentLabs?.filter((l) => l.abnormal) || [];
  for (const lab of abnormalLabs) {
    let severity: "high" | "moderate" | "low" = "low";
    let scoreDeduction = 5;

    // Flag critical lab values
    if (lab.name.toLowerCase().includes("inr") && (lab.value > 4 || lab.value < 1.5)) {
      severity = "high";
      scoreDeduction = 15;
    } else if (lab.name.toLowerCase().includes("potassium") && (lab.value < 3.0 || lab.value > 5.5)) {
      severity = "high";
      scoreDeduction = 15;
    } else if (lab.name.toLowerCase().includes("creatinine") && lab.value > 2.0) {
      severity = "moderate";
      scoreDeduction = 10;
    }

    score -= scoreDeduction;

    riskFactors.push({
      id: `lab-${riskFactors.length}`,
      severity,
      category: "lab_abnormality",
      title: `Abnormal ${lab.name}`,
      description: `${lab.name} is ${lab.value} ${lab.unit} (reference: ${lab.referenceRange})`,
      source: "FHIR",
      actionable: severity !== "low",
      resolution: severity !== "low" ? `Optimize ${lab.name} before discharge` : undefined,
    });
  }

  // Add cost barrier risk factors
  const highCostMeds = costEstimates.filter((c) => c.monthlyOOP > 100);
  for (const med of highCostMeds) {
    const severity = med.monthlyOOP > 400 ? "moderate" : "low";
    score -= severity === "moderate" ? 5 : 2;

    riskFactors.push({
      id: `cost-${riskFactors.length}`,
      severity,
      category: "cost_barrier",
      title: `High Cost: ${med.medication}`,
      description: `Estimated $${med.monthlyOOP}/month out-of-pocket${!med.covered ? " (may not be covered)" : ""}`,
      source: "CMS",
      actionable: true,
      resolution: "Discuss lower-cost alternatives or patient assistance programs",
    });
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score));

  // Determine status
  let status: "ready" | "caution" | "not_ready";
  if (score >= 70) {
    status = "ready";
  } else if (score >= 40) {
    status = "caution";
  } else {
    status = "not_ready";
  }

  // Generate recommendations based on risk factors
  const recommendations: string[] = [];

  if (drugInteractions.some((i) => i.severity === "major")) {
    recommendations.push("Urgent: Review medication regimen for high-risk drug interactions");
  }

  if (unmetCareGaps.some((g) => g.grade === "A")) {
    recommendations.push("Address Grade A guideline recommendations before discharge");
  }

  if (abnormalLabs.length > 0) {
    recommendations.push("Recheck abnormal lab values and ensure trending toward normal");
  }

  if (highCostMeds.length > 0) {
    recommendations.push("Discuss medication costs and assistance programs with patient");
  }

  // Always recommend follow-up
  recommendations.push("Schedule follow-up appointment with PCP within 7-14 days");
  recommendations.push("Provide written discharge instructions in patient's preferred language");

  return {
    patientId: patient.id,
    score,
    status,
    riskFactors: riskFactors.sort((a, b) => {
      const severityOrder = { high: 0, moderate: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
    recommendations,
    analyzedAt: new Date().toISOString(),
  };
}
