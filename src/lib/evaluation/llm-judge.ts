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
import { checkMultipleDrugInteractions, getDrugMonograph, searchKnowledgeBase } from "@/lib/knowledge-base";
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
1. First, VERIFY the drug interactions - check if the assessment caught real interactions
2. Check if any interactions were MISSED that should have been flagged
3. Validate that risk factors are clinically appropriate
4. Check recommendations against guidelines
5. Then provide your final evaluation scores

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
 * Create ReAct tools for the judge to verify claims
 */
function createJudgeTools(patient: Patient, analysis: DischargeAnalysis): ReActTool[] {
  return [
    createReActTool(
      "verify_drug_interactions",
      "Check the patient's medications for drug interactions. Compare against what was flagged in the assessment to find missed interactions.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        const medNames = patient.medications.map((m) => m.name);
        const actualInteractions = checkMultipleDrugInteractions(medNames);

        // Find interactions mentioned in assessment
        const assessmentInteractions = analysis.riskFactors.filter(
          (rf) => rf.category === "drug_interaction"
        );

        // Check for missed interactions
        const missed: string[] = [];
        for (const interaction of actualInteractions) {
          if (interaction.severity === "major" || interaction.severity === "moderate") {
            const found = assessmentInteractions.some(
              (ai) =>
                ai.title.toLowerCase().includes(interaction.drug1.genericName.toLowerCase()) ||
                ai.title.toLowerCase().includes(interaction.drug2.genericName.toLowerCase())
            );
            if (!found) {
              missed.push(`${interaction.drug1.genericName} + ${interaction.drug2.genericName} (${interaction.severity})`);
            }
          }
        }

        return {
          totalMedications: medNames.length,
          actualInteractionsFound: actualInteractions.length,
          interactionsFlaggedInAssessment: assessmentInteractions.length,
          missedInteractions: missed,
          allInteractionsCaught: missed.length === 0,
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
      "Check if risk factor severities are appropriate. Look up specific risk factors to validate their severity rating.",
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

        // Check if severity seems appropriate based on keywords
        const highSeverityIndicators = [
          "bleeding", "stroke", "heart attack", "death", "fatal", "emergency",
          "life-threatening", "critical", "severe", "major interaction"
        ];
        const lowSeverityIndicators = [
          "mild", "minor", "routine", "follow-up", "monitor", "cosmetic"
        ];

        const descLower = rf.description.toLowerCase();
        const hasHighIndicators = highSeverityIndicators.some((i) => descLower.includes(i));
        const hasLowIndicators = lowSeverityIndicators.some((i) => descLower.includes(i));

        let appropriateness = "appropriate";
        if (rf.severity === "low" && hasHighIndicators) {
          appropriateness = "UNDER-RATED - contains high-severity indicators but rated low";
        } else if (rf.severity === "high" && hasLowIndicators && !hasHighIndicators) {
          appropriateness = "potentially over-rated - contains low-severity indicators";
        }

        return {
          riskFactor: rf.title,
          assignedSeverity: rf.severity,
          severityAssessment: appropriateness,
          category: rf.category,
          hasResolution: !!rf.resolution,
        };
      }
    ),

    createReActTool(
      "check_guideline_compliance",
      "Check if recommendations align with clinical guidelines for a specific condition.",
      {
        type: "object",
        properties: {
          condition: {
            type: "string",
            description: "The condition to check guidelines for",
          },
        },
        required: ["condition"],
      },
      async (args) => {
        const condition = String(args.condition);
        const results = searchKnowledgeBase(`${condition} discharge guidelines recommendations`, { topK: 3 });

        // Check if assessment recommendations align with guidelines
        const guidelineKeywords: Record<string, string[]> = {
          "heart failure": ["daily weight", "sodium", "fluid", "cardiology follow-up"],
          diabetes: ["blood glucose", "a1c", "foot care", "diet"],
          "atrial fibrillation": ["anticoagulation", "rate control", "stroke prevention"],
          hypertension: ["blood pressure", "medication adherence", "lifestyle"],
        };

        const assessmentText = JSON.stringify(analysis.recommendations).toLowerCase();
        const key = Object.keys(guidelineKeywords).find((k) =>
          condition.toLowerCase().includes(k)
        );

        if (key) {
          const keywords = guidelineKeywords[key];
          const found = keywords.filter((kw) => assessmentText.includes(kw));
          const missing = keywords.filter((kw) => !assessmentText.includes(kw));

          return {
            condition,
            guidelineKeywords: keywords,
            keywordsFound: found,
            keywordsMissing: missing,
            complianceScore: Math.round((found.length / keywords.length) * 100),
            knowledgeBaseResults: results.length,
          };
        }

        return {
          condition,
          message: "No specific guidelines found for this condition",
          knowledgeBaseResults: results.length,
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
      (s) => s.action?.tool === "verify_drug_interactions"
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
