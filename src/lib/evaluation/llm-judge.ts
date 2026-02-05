/**
 * LLM-as-Judge Evaluation Module - Direct LLM Evaluation
 *
 * Uses a direct LLM call (not ReAct) to evaluate discharge assessments:
 * 1. Gather all FDA verification data upfront (interactions, boxed warnings, coverage)
 * 2. Pass everything to the LLM in one comprehensive prompt
 * 3. LLM evaluates and returns structured JSON scores
 *
 * This approach separates concerns:
 * - Data gathering is deterministic (API calls)
 * - Evaluation/judgment is where LLM reasoning matters
 *
 * The ReAct agent creates assessments; this simple LLM judges them.
 */

import { createLLMProvider, getActiveModelId, getAvailableModels } from "@/lib/integrations/llm-provider";
import { getOpikClient } from "@/lib/integrations/opik";
import {
  checkDrugInteractions,
  checkBoxedWarnings,
} from "@/lib/integrations/fda-client";
import { identifyPreventiveCareGaps } from "@/lib/integrations/myhealthfinder-client";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import { extractJsonObject } from "@/lib/utils/llm-json";

/**
 * Select a reliable model for judging.
 */
function getJudgeModelId(): string {
  const active = getActiveModelId();
  if (!active.startsWith("hf-")) return active;

  const preferred = ["openai-gpt-4o-mini", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const available = getAvailableModels();
  for (const id of preferred) {
    if (available.includes(id)) return id;
  }
  return active;
}

export interface JudgeScore {
  score: number;
  reasoning: string;
}

export interface JudgeEvaluation {
  safety: JudgeScore;
  accuracy: JudgeScore;
  actionability: JudgeScore;
  completeness: JudgeScore;
  overall: number;
  summary: string;
  timestamp: string;
  verificationResults?: {
    drugInteractionsVerified: boolean;
    missedInteractions: string[];
    riskFactorsValidated: boolean;
    guidelinesChecked: string[];
  };
  // No longer using ReAct, but keep for API compatibility
  reactTrace?: {
    iterations: number;
    toolsUsed: string[];
    reasoningTrace: string;
  };
}

/**
 * Verification data gathered from FDA APIs and MyHealthfinder before LLM evaluation
 */
interface VerificationData {
  drugInteractions: {
    fdaInteractionsFound: number;
    assessmentInteractionsFlagged: number;
    missedInteractions: string[];
    allCaught: boolean;
    details: Array<{
      drugs: string;
      severity: string;
      description: string;
    }>;
  };
  boxedWarnings: {
    medicationsWithWarnings: number;
    missedInAssessment: string[];
    allFlagged: boolean;
    warnings: Array<{
      drug: string;
      summary: string;
    }>;
  };
  medicationCoverage: {
    total: number;
    mentioned: number;
    notMentioned: string[];
    missedHighRisk: string[];
    coveragePercent: number;
  };
  preventiveCare: {
    gapsIdentified: number;
    gapsAddressedInAssessment: number;
    missedGaps: string[];
    gaps: Array<{
      recommendation: string;
      status: string;
      reason: string;
    }>;
  };
}

/**
 * Gather all verification data from FDA APIs
 */
async function gatherVerificationData(
  patient: Patient,
  analysis: DischargeAnalysis
): Promise<VerificationData> {
  const meds = patient.medications.map((m) => ({ name: m.name }));

  console.log(`[LLM Judge] Gathering FDA and preventive care verification data for ${meds.length} medications...`);

  // Gather data in parallel
  const [fdaInteractions, boxedWarnings, preventiveCareGaps] = await Promise.all([
    checkDrugInteractions(meds),
    checkBoxedWarnings(meds),
    identifyPreventiveCareGaps(patient),
  ]);

  // Analyze drug interactions
  const assessmentInteractions = analysis.riskFactors.filter(
    (rf) => rf.category === "drug_interaction"
  );

  const missedInteractions: string[] = [];
  for (const interaction of fdaInteractions) {
    if (interaction.severity === "major" || interaction.severity === "moderate") {
      const found = assessmentInteractions.some(
        (ai) =>
          ai.title.toLowerCase().includes(interaction.drug1.toLowerCase()) ||
          ai.title.toLowerCase().includes(interaction.drug2.toLowerCase())
      );
      if (!found) {
        missedInteractions.push(
          `${interaction.drug1} + ${interaction.drug2} (${interaction.severity})`
        );
      }
    }
  }

  // Analyze boxed warnings
  const assessmentHighRisk = analysis.riskFactors.filter((rf) => rf.severity === "high");
  const missedBoxedWarnings: string[] = [];

  for (const w of boxedWarnings) {
    const flagged = assessmentHighRisk.some(
      (rf) => rf.title.toLowerCase().includes(w.drug.toLowerCase())
    );
    if (!flagged) {
      missedBoxedWarnings.push(w.drug);
    }
  }

  // Check medication coverage
  const patientMeds = patient.medications.map((m) => m.name.toLowerCase());
  const assessmentText = JSON.stringify(analysis).toLowerCase();

  const mentioned: string[] = [];
  const notMentioned: string[] = [];

  for (const med of patientMeds) {
    if (assessmentText.includes(med)) {
      mentioned.push(med);
    } else {
      notMentioned.push(med);
    }
  }

  const highRiskMeds = ["warfarin", "insulin", "metformin", "digoxin", "lithium", "amiodarone"];
  const missedHighRisk = notMentioned.filter((m) =>
    highRiskMeds.some((hr) => m.includes(hr))
  );

  // Analyze preventive care gaps (reuse assessmentText from medication coverage check above)
  const missedPreventiveGaps: string[] = [];
  const gapsAddressedCount = preventiveCareGaps.filter((g) => {
    const keywords = g.recommendation.title.toLowerCase().split(" ");
    const addressed = keywords.some((kw) => kw.length > 4 && assessmentText.includes(kw));
    if (!addressed) {
      missedPreventiveGaps.push(g.recommendation.title);
    }
    return addressed;
  }).length;

  return {
    drugInteractions: {
      fdaInteractionsFound: fdaInteractions.length,
      assessmentInteractionsFlagged: assessmentInteractions.length,
      missedInteractions,
      allCaught: missedInteractions.length === 0,
      details: fdaInteractions.slice(0, 5).map((i) => ({
        drugs: `${i.drug1} + ${i.drug2}`,
        severity: i.severity,
        description: i.description.slice(0, 200),
      })),
    },
    boxedWarnings: {
      medicationsWithWarnings: boxedWarnings.length,
      missedInAssessment: missedBoxedWarnings,
      allFlagged: missedBoxedWarnings.length === 0,
      warnings: boxedWarnings.map((w) => ({
        drug: w.drug,
        summary: w.warning.slice(0, 200),
      })),
    },
    medicationCoverage: {
      total: patientMeds.length,
      mentioned: mentioned.length,
      notMentioned,
      missedHighRisk,
      coveragePercent: Math.round((mentioned.length / patientMeds.length) * 100),
    },
    preventiveCare: {
      gapsIdentified: preventiveCareGaps.length,
      gapsAddressedInAssessment: gapsAddressedCount,
      missedGaps: missedPreventiveGaps,
      gaps: preventiveCareGaps.map((g) => ({
        recommendation: g.recommendation.title,
        status: g.status,
        reason: g.reason,
      })),
    },
  };
}

/**
 * Build the evaluation prompt with all context and verification data
 */
function buildEvaluationPrompt(
  patient: Patient,
  analysis: DischargeAnalysis,
  verification: VerificationData
): string {
  const riskFactorsSummary = analysis.riskFactors
    .map(
      (rf) =>
        `  - [${rf.severity.toUpperCase()}] ${rf.title}: ${rf.description}${
          rf.actionable ? " (Actionable)" : ""
        }`
    )
    .join("\n");

  const medicationsSummary = patient.medications
    .map((m) => `  - ${m.name} ${m.dose} ${m.frequency}`)
    .join("\n");

  return `You are a clinical quality assurance specialist. Evaluate this AI-generated discharge assessment.

## PATIENT DATA
Name: ${patient.name}
Age: ${patient.age} years old
Diagnoses: ${patient.diagnoses.map((d) => d.display).join(", ")}

Medications (${patient.medications.length} total):
${medicationsSummary}

Allergies: ${patient.allergies.length > 0 ? patient.allergies.join(", ") : "None documented"}

## ASSESSMENT BEING EVALUATED
Discharge Score: ${analysis.score}/100
Status: ${analysis.status}

Risk Factors Identified (${analysis.riskFactors.length}):
${riskFactorsSummary || "None identified"}

Recommendations:
${analysis.recommendations.map((r, i) => `  ${i + 1}. ${r}`).join("\n") || "None provided"}

## FDA VERIFICATION DATA (Ground Truth)

### Drug Interactions (from FDA Drug Label API)
- FDA found ${verification.drugInteractions.fdaInteractionsFound} interactions
- Assessment flagged ${verification.drugInteractions.assessmentInteractionsFlagged} interactions
- Missed interactions: ${verification.drugInteractions.missedInteractions.length > 0 ? verification.drugInteractions.missedInteractions.join(", ") : "None - all caught"}
${verification.drugInteractions.details.length > 0 ? `- Details:\n${verification.drugInteractions.details.map((d) => `    * ${d.drugs} (${d.severity}): ${d.description}`).join("\n")}` : ""}

### Boxed Warnings (from FDA OpenFDA API)
- ${verification.boxedWarnings.medicationsWithWarnings} medications have FDA Black Box Warnings
- Missed in assessment: ${verification.boxedWarnings.missedInAssessment.length > 0 ? verification.boxedWarnings.missedInAssessment.join(", ") : "None - all flagged"}
${verification.boxedWarnings.warnings.length > 0 ? `- Warnings:\n${verification.boxedWarnings.warnings.map((w) => `    * ${w.drug}: ${w.summary}`).join("\n")}` : ""}

### Medication Coverage
- ${verification.medicationCoverage.coveragePercent}% of medications mentioned in assessment
- Not mentioned: ${verification.medicationCoverage.notMentioned.length > 0 ? verification.medicationCoverage.notMentioned.join(", ") : "All mentioned"}
- Missed high-risk medications: ${verification.medicationCoverage.missedHighRisk.length > 0 ? verification.medicationCoverage.missedHighRisk.join(", ") : "None"}

### Preventive Care Gaps (from MyHealthfinder/USPSTF)
- ${verification.preventiveCare.gapsIdentified} preventive care gaps identified for this patient's age/gender
- ${verification.preventiveCare.gapsAddressedInAssessment} addressed in the assessment
- Missed gaps: ${verification.preventiveCare.missedGaps.length > 0 ? verification.preventiveCare.missedGaps.join(", ") : "None - all addressed"}
${verification.preventiveCare.gaps.length > 0 ? `- Details:\n${verification.preventiveCare.gaps.map((g) => `    * ${g.recommendation} (${g.status}): ${g.reason}`).join("\n")}` : ""}

## YOUR TASK

Evaluate the assessment on these dimensions:

1. **SAFETY (40% weight)** - Did the assessment identify critical risks? Would acting on it harm the patient? Were dangerous drug interactions and boxed warnings properly flagged?

2. **ACCURACY (25% weight)** - Is the score appropriate? Are risk factors correctly categorized? Do findings match patient data?

3. **ACTIONABILITY (20% weight)** - Are recommendations specific and implementable? Are next steps clear?

4. **COMPLETENESS (15% weight)** - Were all medications considered? Were preventive care gaps identified? Any obvious gaps?

## RESPONSE FORMAT

Respond with ONLY this JSON object (no other text):

{
  "safety": {
    "score": 0.0-1.0,
    "reasoning": "Specific explanation referencing the FDA verification data"
  },
  "accuracy": {
    "score": 0.0-1.0,
    "reasoning": "Specific explanation"
  },
  "actionability": {
    "score": 0.0-1.0,
    "reasoning": "Specific explanation"
  },
  "completeness": {
    "score": 0.0-1.0,
    "reasoning": "Specific explanation referencing medication coverage"
  },
  "summary": "One sentence overall assessment"
}

Be CRITICAL. Deduct points for:
- Missed drug interactions (major safety issue)
- Missed boxed warnings (major safety issue)
- Low medication coverage
- Missed preventive care gaps (completeness issue)
- Vague or non-actionable recommendations`;
}

/**
 * Evaluate a discharge analysis using direct LLM call
 */
export async function evaluateWithLLMJudge(
  patient: Patient,
  analysis: DischargeAnalysis,
  modelId?: string
): Promise<JudgeEvaluation> {
  const opik = getOpikClient();
  const judgeModel = modelId || getJudgeModelId();

  const trace = opik?.trace({
    name: "llm-judge-direct",
    metadata: {
      patient_id: patient.id,
      analysis_score: analysis.score,
      analysis_status: analysis.status,
      judge_model: judgeModel,
      approach: "direct-llm", // Not ReAct
    },
  });

  try {
    console.log(`[LLM Judge] Using direct LLM evaluation with model: ${judgeModel}`);

    // Step 1: Gather all FDA verification data upfront
    const verification = await gatherVerificationData(patient, analysis);

    console.log(`[LLM Judge] Verification data gathered - ${verification.drugInteractions.fdaInteractionsFound} interactions, ${verification.boxedWarnings.medicationsWithWarnings} boxed warnings, ${verification.preventiveCare.gapsIdentified} preventive care gaps`);

    // Step 2: Build comprehensive prompt
    const prompt = buildEvaluationPrompt(patient, analysis, verification);

    // Step 3: Single LLM call for evaluation
    const provider = createLLMProvider();
    const response = await provider.generate(prompt, {
      spanName: "judge-evaluation",
      metadata: {
        patientId: patient.id,
        purpose: "evaluation",
      },
    });

    console.log(`[LLM Judge] LLM response received (${response.content.length} chars)`);

    // Step 4: Parse the JSON response
    let judgeResult: {
      safety: JudgeScore;
      accuracy: JudgeScore;
      actionability: JudgeScore;
      completeness: JudgeScore;
      summary: string;
    };

    try {
      judgeResult = extractJsonObject(response.content);
      console.log(`[LLM Judge] Successfully parsed evaluation JSON`);
    } catch (parseError) {
      console.error(`[LLM Judge] JSON parse failed. Raw response: ${response.content.slice(0, 500)}`);
      // Provide reasonable defaults if parsing fails
      judgeResult = {
        safety: { score: 0.5, reasoning: "Unable to parse LLM response" },
        accuracy: { score: 0.5, reasoning: "Unable to parse LLM response" },
        actionability: { score: 0.5, reasoning: "Unable to parse LLM response" },
        completeness: { score: 0.5, reasoning: "Unable to parse LLM response" },
        summary: "Evaluation completed with parsing issues",
      };
    }

    // Calculate weighted overall score
    const weights = {
      safety: 0.4,
      accuracy: 0.25,
      actionability: 0.2,
      completeness: 0.15,
    };

    const overall =
      (judgeResult.safety?.score || 0) * weights.safety +
      (judgeResult.accuracy?.score || 0) * weights.accuracy +
      (judgeResult.actionability?.score || 0) * weights.actionability +
      (judgeResult.completeness?.score || 0) * weights.completeness;

    const evaluation: JudgeEvaluation = {
      safety: judgeResult.safety || { score: 0, reasoning: "Not evaluated" },
      accuracy: judgeResult.accuracy || { score: 0, reasoning: "Not evaluated" },
      actionability: judgeResult.actionability || { score: 0, reasoning: "Not evaluated" },
      completeness: judgeResult.completeness || { score: 0, reasoning: "Not evaluated" },
      overall: Math.round(overall * 100) / 100,
      summary: judgeResult.summary || "Evaluation complete",
      timestamp: new Date().toISOString(),
      verificationResults: {
        drugInteractionsVerified: true,
        missedInteractions: verification.drugInteractions.missedInteractions,
        riskFactorsValidated: true,
        guidelinesChecked: [],
      },
    };

    trace?.update({
      output: {
        overall: evaluation.overall,
        safety_score: evaluation.safety.score,
        accuracy_score: evaluation.accuracy.score,
        completeness_score: evaluation.completeness.score,
        missed_interactions: verification.drugInteractions.missedInteractions.length,
        missed_boxed_warnings: verification.boxedWarnings.missedInAssessment.length,
        medication_coverage: verification.medicationCoverage.coveragePercent,
        preventive_care_gaps: verification.preventiveCare.gapsIdentified,
        preventive_care_missed: verification.preventiveCare.missedGaps.length,
      },
    });
    trace?.end();

    console.log(`[LLM Judge] Evaluation complete - overall: ${evaluation.overall}, safety: ${evaluation.safety.score}`);

    return evaluation;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[LLM Judge] Evaluation failed for patient ${patient.id}: ${errorMessage}`, error);

    // Set errorInfo so Opik dashboard counts this as an error trace
    const errorInfo = {
      exceptionType: error instanceof Error ? error.name : "Error",
      message: errorMessage,
      traceback: errorStack ?? errorMessage,
    };
    trace?.update({ errorInfo, metadata: { error: errorMessage } });
    trace?.end();

    return {
      safety: { score: 0, reasoning: `Evaluation failed: ${errorMessage}` },
      accuracy: { score: 0, reasoning: `Evaluation failed: ${errorMessage}` },
      actionability: { score: 0, reasoning: `Evaluation failed: ${errorMessage}` },
      completeness: { score: 0, reasoning: `Evaluation failed: ${errorMessage}` },
      overall: 0,
      summary: `Evaluation failed: ${errorMessage}`,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Batch evaluate multiple analyses
 */
export async function batchEvaluateWithJudge(
  evaluations: Array<{ patient: Patient; analysis: DischargeAnalysis }>,
  modelId?: string
): Promise<Array<{ patientId: string; evaluation: JudgeEvaluation }>> {
  const results = await Promise.all(
    evaluations.map(async ({ patient, analysis }) => {
      const evaluation = await evaluateWithLLMJudge(patient, analysis, modelId);
      return {
        patientId: patient.id,
        evaluation,
      };
    })
  );

  return results;
}

/**
 * Get a quick safety check using the judge
 */
export async function quickSafetyCheck(
  patient: Patient,
  analysis: DischargeAnalysis,
  threshold = 0.7
): Promise<{ passes: boolean; score: number; reasoning: string }> {
  const evaluation = await evaluateWithLLMJudge(patient, analysis);

  return {
    passes: evaluation.safety.score >= threshold,
    score: evaluation.safety.score,
    reasoning: evaluation.safety.reasoning,
  };
}
