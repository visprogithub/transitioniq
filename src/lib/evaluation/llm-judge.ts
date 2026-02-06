/**
 * LLM-as-Judge Evaluation Module
 *
 * Uses a secondary LLM to evaluate the quality, safety, and accuracy
 * of discharge readiness assessments. Logs scores to Opik for tracking.
 */

import { createLLMProvider, getActiveModelId, getAvailableModels } from "@/lib/integrations/llm-provider";
import { getOpikClient, traceError, flushTraces } from "@/lib/integrations/opik";
import { applyInputGuardrails, applyOutputGuardrails } from "@/lib/guardrails";
import { getLLMJudgePrompt } from "@/lib/integrations/opik-prompts";
import {
  checkDrugInteractions,
  checkBoxedWarnings,
  type DrugInteraction,
} from "@/lib/integrations/fda-client";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import { extractJsonObject } from "@/lib/utils/llm-json";

/**
 * Select a reliable model for judging.
 * Prefers commercial models over HuggingFace since the judge
 * needs consistent, well-formatted JSON output.
 */
function getJudgeModelId(): string {
  const active = getActiveModelId();
  // Commercial models handle structured JSON reliably
  if (!active.startsWith("hf-")) return active;

  // HF models struggle with strict JSON — find a commercial alternative
  const preferred = ["openai-gpt-4o-mini", "gemini-2.5-flash", "gemini-2.5-flash-lite"];
  const available = getAvailableModels();
  for (const id of preferred) {
    if (available.includes(id)) return id;
  }
  return active; // No commercial model available, use what we have
}

export interface JudgeScore {
  score: number; // 0-1
  reasoning: string;
}

export interface JudgeEvaluation {
  safety: JudgeScore;
  accuracy: JudgeScore;
  actionability: JudgeScore;
  completeness: JudgeScore;
  overall: number; // 0-1 weighted average
  summary: string;
  timestamp: string;
}

// Judge system prompt is now fetched from Opik Prompt Library via getLLMJudgePrompt()
// This enables version control and A/B testing of the evaluation prompt

/**
 * Independently fetch FDA safety data for cross-verification.
 * The judge calls the same APIs the pipeline uses, so it can compare
 * what the assessment found vs what FDA actually reports.
 */
async function fetchFDAGroundTruth(patient: Patient): Promise<{
  interactions: DrugInteraction[];
  boxedWarnings: Array<{ drug: string; warning: string }>;
  errors: string[];
}> {
  const errors: string[] = [];
  let interactions: DrugInteraction[] = [];
  let boxedWarnings: Array<{ drug: string; warning: string }> = [];

  try {
    interactions = await checkDrugInteractions(patient.medications);
  } catch (e) {
    errors.push(`Drug interactions check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    boxedWarnings = await checkBoxedWarnings(patient.medications.map(m => ({ name: m.name })));
  } catch (e) {
    errors.push(`Boxed warnings check failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { interactions, boxedWarnings, errors };
}

function buildJudgePrompt(
  patient: Patient,
  analysis: DischargeAnalysis,
  fdaGroundTruth?: {
    interactions: DrugInteraction[];
    boxedWarnings: Array<{ drug: string; warning: string }>;
    errors: string[];
  }
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

  const labsSummary =
    patient.recentLabs
      ?.map(
        (l) =>
          `  - ${l.name}: ${l.value} ${l.unit} (ref: ${l.referenceRange})${
            l.abnormal ? " [ABNORMAL]" : ""
          }`
      )
      .join("\n") || "No labs available";

  return `PATIENT CONTEXT:
Name: ${patient.name}
Age: ${patient.age} years old
Gender: ${patient.gender === "M" ? "Male" : "Female"}
Admission Date: ${patient.admissionDate}

Diagnoses:
${patient.diagnoses.map((d) => `  - ${d.display} (${d.status})`).join("\n")}

Medications (${patient.medications.length} total):
${medicationsSummary}

Allergies: ${patient.allergies.length > 0 ? patient.allergies.join(", ") : "None documented"}

Recent Labs:
${labsSummary}

Vital Signs:
  - BP: ${patient.vitalSigns?.bloodPressure || "N/A"}
  - HR: ${patient.vitalSigns?.heartRate || "N/A"}
  - O2 Sat: ${patient.vitalSigns?.oxygenSaturation || "N/A"}%

---

AI ASSESSMENT TO EVALUATE:

Discharge Score: ${analysis.score}/100
Status: ${analysis.status}

Risk Factors Identified (${analysis.riskFactors.length}):
${riskFactorsSummary || "None identified"}

Recommendations:
${analysis.recommendations.map((r, i) => `  ${i + 1}. ${r}`).join("\n") || "None provided"}

---

${fdaGroundTruth ? `FDA CROSS-VERIFICATION DATA (independently fetched by judge):

Drug Interactions Found by FDA (${fdaGroundTruth.interactions.length} total):
${fdaGroundTruth.interactions.length > 0
  ? fdaGroundTruth.interactions.map(i => `  - [${i.severity.toUpperCase()}] ${i.drug1} ↔ ${i.drug2}: ${i.description.substring(0, 200)}`).join("\n")
  : "  None found"}

FDA Black Box Warnings (${fdaGroundTruth.boxedWarnings.length} total):
${fdaGroundTruth.boxedWarnings.length > 0
  ? fdaGroundTruth.boxedWarnings.map(w => `  - ${w.drug}: ${w.warning.substring(0, 200)}`).join("\n")
  : "  None found"}

${fdaGroundTruth.errors.length > 0 ? `Note: Some FDA checks failed: ${fdaGroundTruth.errors.join("; ")}` : ""}

IMPORTANT: Compare the assessment's risk factors against the FDA data above.
- Did the assessment catch all drug interactions that FDA reports?
- Did it flag all Black Box Warnings?
- Are there interactions or warnings in the FDA data that the assessment MISSED?
- Score SAFETY and ACCURACY lower if the assessment missed FDA-documented risks.

---

` : ""}Evaluate this assessment on the four dimensions described. Be critical but fair.`;
}

/**
 * Evaluate a discharge analysis using LLM-as-Judge
 */
export async function evaluateWithLLMJudge(
  patient: Patient,
  analysis: DischargeAnalysis,
  modelId?: string
): Promise<JudgeEvaluation> {
  const opik = getOpikClient();
  const trace = opik?.trace({
    name: "llm-judge-evaluation",
    metadata: {
      patient_id: patient.id,
      analysis_score: analysis.score,
      analysis_status: analysis.status,
      judge_model: modelId || getJudgeModelId(),
    },
  });

  try {
    // Get versioned prompt from Opik Prompt Library
    const promptData = await getLLMJudgePrompt();

    // Use a reliable model for judging (avoids HF models that struggle with JSON)
    const judgeModel = modelId || getJudgeModelId();
    console.log(`[LLM Judge] Using model: ${judgeModel} (active: ${getActiveModelId()})`);

    const span = trace?.span({
      name: "judge-generation",
      type: "llm",
      model: judgeModel,
      metadata: {
        prompt_version: promptData.commit || "local",
        prompt_from_opik: promptData.fromOpik,
        judge_model: judgeModel,
      },
    });

    // Independently fetch FDA data for cross-verification
    const fdaSpan = trace?.span({
      name: "fda-cross-verification",
      type: "tool",
      metadata: { purpose: "ground-truth-fetch", medication_count: patient.medications.length },
    });

    const fdaGroundTruth = await fetchFDAGroundTruth(patient);

    fdaSpan?.update({
      output: {
        interactions_found: fdaGroundTruth.interactions.length,
        boxed_warnings_found: fdaGroundTruth.boxedWarnings.length,
        errors: fdaGroundTruth.errors,
      },
    });
    fdaSpan?.end();

    const prompt = buildJudgePrompt(patient, analysis, fdaGroundTruth);
    const provider = createLLMProvider(judgeModel);

    const fullJudgePrompt = `${promptData.template}\n\n${prompt}`;

    // Apply input guardrails before sending to LLM
    const inputGuardrail = applyInputGuardrails(fullJudgePrompt, {
      sanitizePII: true,
      usePlaceholders: true,
      blockCriticalPII: true,
      logToOpik: true,
      traceName: "guardrail-llm-judge-input",
    });

    const sanitizedJudgePrompt = inputGuardrail.wasSanitized ? inputGuardrail.output : fullJudgePrompt;

    const startTime = Date.now();
    const response = await provider.generate(
      sanitizedJudgePrompt,
      {
        spanName: "llm-judge-call",
        metadata: {
          patient_id: patient.id,
          purpose: "evaluation",
          prompt_version: promptData.commit || "local",
          pii_sanitized: inputGuardrail.wasSanitized,
        },
      }
    );
    const latencyMs = Date.now() - startTime;

    // Apply output guardrails to catch any leaked PII
    const outputGuardrail = applyOutputGuardrails(response.content, {
      sanitizePII: true,
      usePlaceholders: true,
      logToOpik: true,
      traceName: "guardrail-llm-judge-output",
    });
    const sanitizedContent = outputGuardrail.output;

    // Parse the judge response (handles Qwen3 thinking tokens, trailing commas, etc.)
    let judgeResult: {
      safety: JudgeScore;
      accuracy: JudgeScore;
      actionability: JudgeScore;
      completeness: JudgeScore;
      summary: string;
    };
    try {
      const parsed = extractJsonObject<Record<string, unknown>>(sanitizedContent);

      // Validate expected structure and use 0.5 (50%) fallback for missing dimensions
      const safetyData = parsed.safety as JudgeScore | undefined;
      const accuracyData = parsed.accuracy as JudgeScore | undefined;
      const actionabilityData = parsed.actionability as JudgeScore | undefined;
      const completenessData = parsed.completeness as JudgeScore | undefined;

      if (!safetyData || !accuracyData || !actionabilityData || !completenessData) {
        console.warn(`[LLM Judge] Parsed JSON but missing expected dimensions. Keys: ${Object.keys(parsed).join(", ")}`);
        console.warn(`[LLM Judge] Raw answer: ${sanitizedContent.slice(0, 500)}`);
      }

      judgeResult = {
        safety: safetyData || { score: 0.5, reasoning: "Unable to extract safety evaluation from LLM response" },
        accuracy: accuracyData || { score: 0.5, reasoning: "Unable to extract accuracy evaluation from LLM response" },
        actionability: actionabilityData || { score: 0.5, reasoning: "Unable to extract actionability evaluation from LLM response" },
        completeness: completenessData || { score: 0.5, reasoning: "Unable to extract completeness evaluation from LLM response" },
        summary: (parsed.summary as string) || "Evaluation completed",
      };
    } catch (parseError) {
      traceError("llm-judge-parse", parseError);
      // Provide reasonable 50% defaults if parsing fails (better than 0% or crashing)
      judgeResult = {
        safety: { score: 0.5, reasoning: "Unable to evaluate safety - JSON parse error" },
        accuracy: { score: 0.5, reasoning: "Unable to evaluate accuracy - JSON parse error" },
        actionability: { score: 0.5, reasoning: "Unable to evaluate actionability - JSON parse error" },
        completeness: { score: 0.5, reasoning: "Unable to evaluate completeness - JSON parse error" },
        summary: "Evaluation incomplete due to parse error",
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
      judgeResult.safety.score * weights.safety +
      judgeResult.accuracy.score * weights.accuracy +
      judgeResult.actionability.score * weights.actionability +
      judgeResult.completeness.score * weights.completeness;

    const evaluation: JudgeEvaluation = {
      ...judgeResult,
      overall: Math.round(overall * 100) / 100,
      timestamp: new Date().toISOString(),
    };

    // Log scores to Opik as feedback
    span?.update({
      output: {
        overall_score: evaluation.overall,
        safety_score: evaluation.safety.score,
        accuracy_score: evaluation.accuracy.score,
        actionability_score: evaluation.actionability.score,
        completeness_score: evaluation.completeness.score,
      },
      metadata: { latency_ms: latencyMs },
    });

    // Log individual scores for Opik feedback/metrics
    if (trace) {
      // Use score() method if available, or log in metadata
      trace.update({
        output: {
          overall: evaluation.overall,
          safety_score: evaluation.safety.score,
          accuracy_score: evaluation.accuracy.score,
          actionability_score: evaluation.actionability.score,
          completeness_score: evaluation.completeness.score,
          summary: evaluation.summary,
        },
        metadata: {
          judge_scores: {
            overall: evaluation.overall,
            safety: evaluation.safety.score,
            accuracy: evaluation.accuracy.score,
            actionability: evaluation.actionability.score,
            completeness: evaluation.completeness.score,
          },
          fda_cross_verification: {
            interactions_found: fdaGroundTruth.interactions.length,
            boxed_warnings_found: fdaGroundTruth.boxedWarnings.length,
            fda_errors: fdaGroundTruth.errors,
          },
        },
      });
    }

    span?.end();
    trace?.end();
    await flushTraces();

    return evaluation;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    traceError("llm-judge-evaluation", error, { patientId: patient.id });

    trace?.update({ metadata: { error: errorMessage } });
    trace?.end();

    // Return a failed evaluation with the actual error in reasoning
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
 * Returns true if the assessment passes safety threshold
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