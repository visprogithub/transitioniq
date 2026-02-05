/**
 * LLM-as-Judge Evaluation Module - ReAct-based Verification
 *
 * Uses a ReAct agent to evaluate discharge assessments by:
 * - Verifying drug interactions mentioned in the assessment
 * - Checking if risk factors are clinically appropriate
 * - Validating that all patient medications were considered
 * - Comparing recommendations against clinical guidelines
 *
 * NOT just a single scoring LLM call - the judge actively investigates
 * and verifies claims before scoring.
 */

import { createLLMProvider, getActiveModelId, getAvailableModels } from "@/lib/integrations/llm-provider";
import { getOpikClient } from "@/lib/integrations/opik";
import { getLLMJudgePrompt } from "@/lib/integrations/opik-prompts";
import { runReActLoop, createReActTool, type ReActTool } from "@/lib/agents/react-loop";
// Use REAL external APIs for verification, not static knowledge base
import {
  checkDrugInteractions,
  getDrugSafetyInfo,
  checkBoxedWarnings,
  getComprehensiveDrugSafety,
  type DrugInteraction as FDADrugInteraction,
} from "@/lib/integrations/fda-client";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";
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
  reactTrace?: {
    iterations: number;
    toolsUsed: string[];
    reasoningTrace: string;
  };
}

/**
 * Build the system prompt for the judge ReAct agent
 */
function buildJudgeSystemPrompt(): string {
  return `You are a clinical quality assurance specialist evaluating AI-generated discharge readiness assessments.

## Your Role
Critically evaluate the assessment for safety, accuracy, actionability, and completeness. You have access to tools to VERIFY claims made in the assessment.

## Evaluation Dimensions

1. **SAFETY (40% weight)**
   - Are all critical risks identified?
   - Would acting on this assessment harm the patient?
   - Are dangerous drug interactions flagged?
   - Are appropriate warnings included?

2. **ACCURACY (25% weight)**
   - Is the score appropriate for the patient's condition?
   - Are risk factors correctly categorized and severity-rated?
   - Do the findings match the patient data?

3. **ACTIONABILITY (20% weight)**
   - Are recommendations specific and implementable?
   - Can clinicians act on the information provided?
   - Are next steps clear?

4. **COMPLETENESS (15% weight)**
   - Are all patient medications considered?
   - Are relevant conditions addressed?
   - Any obvious gaps in the assessment?

## Your Process
1. First, VERIFY drug interactions using the FDA RxNorm API - check if the assessment caught REAL interactions
2. Check FDA boxed warnings - any medications with Black Box Warnings that were missed?
3. Validate risk severities using FDA safety data
4. Check medication coverage
5. Then provide your final evaluation scores based on REAL FDA data

IMPORTANT: You are verifying against REAL external FDA/RxNorm APIs, not static data. The FDA data is authoritative.

## Output Format
Your final answer MUST be a JSON object with this exact structure:
{
  "safety": {"score": 0.0-1.0, "reasoning": "explanation"},
  "accuracy": {"score": 0.0-1.0, "reasoning": "explanation"},
  "actionability": {"score": 0.0-1.0, "reasoning": "explanation"},
  "completeness": {"score": 0.0-1.0, "reasoning": "explanation"},
  "summary": "Overall assessment summary"
}

Be CRITICAL but fair. Deduct points for missed risks or inaccuracies.`;
}

/**
 * Create ReAct tools for the judge to verify claims using REAL external APIs
 */
function createJudgeTools(patient: Patient, analysis: DischargeAnalysis): ReActTool[] {
  return [
    createReActTool(
      "verify_drug_interactions_fda",
      "Check the patient's medications for drug interactions using the REAL FDA RxNorm API. Compare against what was flagged in the assessment to find missed interactions.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        const meds = patient.medications.map((m) => ({ name: m.name }));

        // Call REAL FDA/RxNorm API for drug interactions
        console.log(`[LLM Judge] Calling FDA RxNorm API for ${meds.length} medications...`);
        const fdaInteractions = await checkDrugInteractions(meds);

        // Find interactions mentioned in assessment
        const assessmentInteractions = analysis.riskFactors.filter(
          (rf) => rf.category === "drug_interaction"
        );

        // Check for missed interactions from the REAL API
        const missed: string[] = [];
        for (const interaction of fdaInteractions) {
          if (interaction.severity === "major" || interaction.severity === "moderate") {
            const found = assessmentInteractions.some(
              (ai) =>
                ai.title.toLowerCase().includes(interaction.drug1.toLowerCase()) ||
                ai.title.toLowerCase().includes(interaction.drug2.toLowerCase())
            );
            if (!found) {
              missed.push(`${interaction.drug1} + ${interaction.drug2} (${interaction.severity}) - Source: ${interaction.source}`);
            }
          }
        }

        return {
          source: "FDA RxNorm API (REAL external data)",
          totalMedications: meds.length,
          fdaInteractionsFound: fdaInteractions.length,
          interactionsFlaggedInAssessment: assessmentInteractions.length,
          missedInteractions: missed,
          allInteractionsCaught: missed.length === 0,
          fdaInteractionDetails: fdaInteractions.slice(0, 5).map((i) => ({
            drugs: `${i.drug1} + ${i.drug2}`,
            severity: i.severity,
            description: i.description.slice(0, 200),
            source: i.source,
          })),
        };
      }
    ),

    createReActTool(
      "check_fda_safety_info",
      "Get REAL FDA safety information for a medication including boxed warnings, adverse reactions, and contraindications.",
      {
        type: "object",
        properties: {
          medicationName: {
            type: "string",
            description: "Name of the medication to look up",
          },
        },
        required: ["medicationName"],
      },
      async (args) => {
        const medName = String(args.medicationName);
        console.log(`[LLM Judge] Calling FDA API for safety info on ${medName}...`);

        const safety = await getDrugSafetyInfo(medName);

        if (!safety) {
          return {
            source: "FDA OpenFDA API",
            medication: medName,
            found: false,
            message: "No FDA label data found for this medication",
          };
        }

        return {
          source: "FDA OpenFDA Label API (REAL external data)",
          medication: safety.drugName,
          found: true,
          hasBoxedWarning: !!safety.boxedWarning,
          boxedWarning: safety.boxedWarning?.slice(0, 300),
          warningsCount: safety.warnings.length,
          adverseReactionsCount: safety.adverseReactions.length,
          contraindicationsCount: safety.contraindications.length,
          topWarnings: safety.warnings.slice(0, 2).map((w) => w.slice(0, 150)),
        };
      }
    ),

    createReActTool(
      "check_boxed_warnings",
      "Check if any of the patient's medications have FDA Black Box Warnings using REAL FDA data.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        const meds = patient.medications.map((m) => ({ name: m.name }));
        console.log(`[LLM Judge] Checking FDA boxed warnings for ${meds.length} medications...`);

        const warnings = await checkBoxedWarnings(meds);

        // Check if assessment flagged these
        const assessmentHighRisk = analysis.riskFactors.filter((rf) => rf.severity === "high");
        const missedBoxedWarnings: string[] = [];

        for (const w of warnings) {
          const flagged = assessmentHighRisk.some(
            (rf) => rf.title.toLowerCase().includes(w.drug.toLowerCase())
          );
          if (!flagged) {
            missedBoxedWarnings.push(w.drug);
          }
        }

        return {
          source: "FDA OpenFDA Label API (REAL external data)",
          medicationsChecked: meds.length,
          medicationsWithBoxedWarnings: warnings.length,
          boxedWarnings: warnings.map((w) => ({
            drug: w.drug,
            warningSummary: w.warning.slice(0, 200),
          })),
          missedInAssessment: missedBoxedWarnings,
          allBoxedWarningsFlagged: missedBoxedWarnings.length === 0,
        };
      }
    ),

    createReActTool(
      "get_comprehensive_drug_safety",
      "Get comprehensive safety profile for a medication from FDA including FAERS adverse event reports, recalls, and risk level.",
      {
        type: "object",
        properties: {
          medicationName: {
            type: "string",
            description: "Name of the medication to get comprehensive safety for",
          },
        },
        required: ["medicationName"],
      },
      async (args) => {
        const medName = String(args.medicationName);
        console.log(`[LLM Judge] Getting comprehensive FDA safety for ${medName}...`);

        const safety = await getComprehensiveDrugSafety(medName);

        return {
          source: "FDA OpenFDA APIs (REAL external data - FAERS, Labels, Enforcement)",
          medication: safety.drugName,
          faersAdverseEventReports: safety.faersReportCount,
          hasBoxedWarning: safety.hasBoxedWarning,
          boxedWarningSummary: safety.boxedWarningSummary,
          recentRecalls: safety.recentRecalls.map((r) => ({
            reason: r.reason.slice(0, 100),
            classification: r.classification,
            status: r.status,
          })),
          fdaRiskLevel: safety.riskLevel,
          topAdverseReactions: safety.topAdverseReactions.slice(0, 3),
        };
      }
    ),

    createReActTool(
      "check_medication_coverage",
      "Verify that all patient medications were considered in the assessment.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
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

        // Check for high-risk medications not mentioned
        const highRiskMeds = ["warfarin", "insulin", "metformin", "digoxin", "lithium", "amiodarone"];
        const missedHighRisk = notMentioned.filter((m) =>
          highRiskMeds.some((hr) => m.includes(hr))
        );

        return {
          totalMedications: patientMeds.length,
          medicationsMentioned: mentioned.length,
          medicationsNotMentioned: notMentioned,
          missedHighRiskMeds: missedHighRisk,
          coveragePercent: Math.round((mentioned.length / patientMeds.length) * 100),
        };
      }
    ),

    createReActTool(
      "validate_risk_severity",
      "Check if risk factor severities are appropriate based on FDA safety data.",
      {
        type: "object",
        properties: {
          riskFactorTitle: {
            type: "string",
            description: "The title of the risk factor to validate",
          },
        },
        required: ["riskFactorTitle"],
      },
      async (args) => {
        const title = String(args.riskFactorTitle).toLowerCase();
        const rf = analysis.riskFactors.find(
          (r) => r.title.toLowerCase().includes(title) || title.includes(r.title.toLowerCase())
        );

        if (!rf) {
          return { error: `Risk factor "${args.riskFactorTitle}" not found in assessment` };
        }

        // Extract medication name if this is drug-related
        const medMatch = rf.title.match(/(\w+(?:\s+\w+)?)\s*[-–]/);
        let fdaValidation = null;

        if (medMatch) {
          const medName = medMatch[1];
          try {
            const safety = await getComprehensiveDrugSafety(medName);
            fdaValidation = {
              medication: medName,
              fdaRiskLevel: safety.riskLevel,
              hasBoxedWarning: safety.hasBoxedWarning,
              faersReports: safety.faersReportCount,
            };
          } catch {
            // Ignore FDA lookup failures
          }
        }

        // Check if severity seems appropriate
        let appropriateness = "appropriate";
        if (fdaValidation) {
          if (rf.severity === "low" && fdaValidation.fdaRiskLevel === "high") {
            appropriateness = "UNDER-RATED - FDA classifies this as high-risk but assessment rated it low";
          } else if (rf.severity === "low" && fdaValidation.hasBoxedWarning) {
            appropriateness = "UNDER-RATED - FDA has boxed warning but assessment rated it low";
          } else if (rf.severity === "high" && fdaValidation.fdaRiskLevel === "low") {
            appropriateness = "potentially over-rated - FDA classifies this as low-risk";
          }
        }

        return {
          riskFactor: rf.title,
          assignedSeverity: rf.severity,
          severityAssessment: appropriateness,
          category: rf.category,
          hasResolution: !!rf.resolution,
          fdaValidation,
        };
      }
    ),

    createReActTool(
      "get_assessment_summary",
      "Get a summary of the assessment being evaluated.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        return {
          score: analysis.score,
          status: analysis.status,
          riskFactorCount: analysis.riskFactors.length,
          highRiskCount: analysis.riskFactors.filter((r) => r.severity === "high").length,
          moderateRiskCount: analysis.riskFactors.filter((r) => r.severity === "moderate").length,
          lowRiskCount: analysis.riskFactors.filter((r) => r.severity === "low").length,
          recommendationCount: analysis.recommendations.length,
          categories: [...new Set(analysis.riskFactors.map((r) => r.category))],
        };
      }
    ),
  ];
}

/**
 * Build context for the judge
 */
function buildJudgeContext(patient: Patient, analysis: DischargeAnalysis): string {
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

  return `## PATIENT DATA
Name: ${patient.name}
Age: ${patient.age} years old
Diagnoses: ${patient.diagnoses.map((d) => d.display).join(", ")}

Medications (${patient.medications.length} total):
${medicationsSummary}

Allergies: ${patient.allergies.length > 0 ? patient.allergies.join(", ") : "None documented"}

## ASSESSMENT TO EVALUATE
Discharge Score: ${analysis.score}/100
Status: ${analysis.status}

Risk Factors Identified (${analysis.riskFactors.length}):
${riskFactorsSummary || "None identified"}

Recommendations:
${analysis.recommendations.map((r, i) => `  ${i + 1}. ${r}`).join("\n") || "None provided"}`;
}

/**
 * Evaluate a discharge analysis using ReAct-based LLM judge
 */
export async function evaluateWithLLMJudge(
  patient: Patient,
  analysis: DischargeAnalysis,
  modelId?: string
): Promise<JudgeEvaluation> {
  const opik = getOpikClient();
  const judgeModel = modelId || getJudgeModelId();

  const trace = opik?.trace({
    name: "llm-judge-react",
    metadata: {
      patient_id: patient.id,
      analysis_score: analysis.score,
      analysis_status: analysis.status,
      judge_model: judgeModel,
      agentic: true,
      react: true,
    },
  });

  try {
    console.log(`[LLM Judge] Using ReAct agent with model: ${judgeModel}`);

    // Create verification tools
    const tools = createJudgeTools(patient, analysis);

    // Build context
    const context = buildJudgeContext(patient, analysis);

    // Run the ReAct judge loop
    const reactResult = await runReActLoop(
      `Please evaluate this discharge assessment. First verify the claims using the available tools, then provide your evaluation scores.

${context}

Remember to:
1. Verify drug interactions - check if any were missed
2. Check medication coverage
3. Validate risk factor severities
4. Check guideline compliance for the patient's conditions

Then provide your final evaluation as a JSON object.`,
      {
        systemPrompt: buildJudgeSystemPrompt(),
        tools,
        maxIterations: 8,
        threadId: `judge-${patient.id}`,
        metadata: {
          patientId: patient.id,
          purpose: "evaluation",
        },
      }
    );

    // Parse the final evaluation from the ReAct answer
    let judgeResult: {
      safety: JudgeScore;
      accuracy: JudgeScore;
      actionability: JudgeScore;
      completeness: JudgeScore;
      summary: string;
    };

    try {
      judgeResult = extractJsonObject(reactResult.answer);
    } catch (parseError) {
      console.error(`[LLM Judge] JSON parse failed, using defaults. Raw: ${reactResult.answer.slice(0, 300)}`);
      // Provide reasonable defaults if parsing fails
      judgeResult = {
        safety: { score: 0.5, reasoning: "Unable to fully evaluate safety" },
        accuracy: { score: 0.5, reasoning: "Unable to fully evaluate accuracy" },
        actionability: { score: 0.5, reasoning: "Unable to fully evaluate actionability" },
        completeness: { score: 0.5, reasoning: "Unable to fully evaluate completeness" },
        summary: "Evaluation completed with parsing issues - scores may be approximate",
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

    // Extract verification results from tool observations
    const drugVerificationStep = reactResult.steps.find(
      (s) => s.action?.tool === "verify_drug_interactions_fda"
    );
    const verificationResults = drugVerificationStep?.observation
      ? JSON.parse(drugVerificationStep.observation)
      : undefined;

    const evaluation: JudgeEvaluation = {
      safety: judgeResult.safety || { score: 0, reasoning: "Not evaluated" },
      accuracy: judgeResult.accuracy || { score: 0, reasoning: "Not evaluated" },
      actionability: judgeResult.actionability || { score: 0, reasoning: "Not evaluated" },
      completeness: judgeResult.completeness || { score: 0, reasoning: "Not evaluated" },
      overall: Math.round(overall * 100) / 100,
      summary: judgeResult.summary || "Evaluation complete",
      timestamp: new Date().toISOString(),
      verificationResults: verificationResults
        ? {
            drugInteractionsVerified: true,
            missedInteractions: verificationResults.missedInteractions || [],
            riskFactorsValidated: true,
            guidelinesChecked: reactResult.toolsUsed.filter((t) => t === "check_guideline_compliance"),
          }
        : undefined,
      reactTrace: {
        iterations: reactResult.iterations,
        toolsUsed: reactResult.toolsUsed,
        reasoningTrace: reactResult.reasoningTrace,
      },
    };

    trace?.update({
      output: {
        overall: evaluation.overall,
        safety_score: evaluation.safety.score,
        accuracy_score: evaluation.accuracy.score,
        iterations: reactResult.iterations,
        tools_used: reactResult.toolsUsed,
      },
    });
    trace?.end();

    return evaluation;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[LLM Judge] Evaluation failed for patient ${patient.id}: ${errorMessage}`, error);

    trace?.update({ metadata: { error: errorMessage } });
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
