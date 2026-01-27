/**
 * LLM-as-Judge Evaluation Module
 *
 * Uses a secondary LLM to evaluate the quality, safety, and accuracy
 * of discharge readiness assessments. Logs scores to Opik for tracking.
 */

import { createLLMProvider, getActiveModelId } from "@/lib/integrations/llm-provider";
import { getOpikClient } from "@/lib/integrations/opik";
import { getLLMJudgePrompt } from "@/lib/integrations/opik-prompts";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

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

function buildJudgePrompt(patient: Patient, analysis: DischargeAnalysis): string {
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

Evaluate this assessment on the four dimensions described. Be critical but fair.`;
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
      judge_model: modelId || getActiveModelId(),
    },
  });

  try {
    // Get versioned prompt from Opik Prompt Library
    const promptData = await getLLMJudgePrompt();

    const span = trace?.span({
      name: "judge-generation",
      type: "llm",
      metadata: {
        prompt_version: promptData.commit || "local",
        prompt_from_opik: promptData.fromOpik,
      },
    });

    const prompt = buildJudgePrompt(patient, analysis);
    const provider = createLLMProvider(modelId);

    const startTime = Date.now();
    const response = await provider.generate(
      `${promptData.template}\n\n${prompt}`,
      {
        spanName: "llm-judge-call",
        metadata: {
          patient_id: patient.id,
          purpose: "evaluation",
          prompt_version: promptData.commit || "local",
        },
      }
    );
    const latencyMs = Date.now() - startTime;

    // Parse the judge response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Judge LLM did not return valid JSON");
    }

    const judgeResult = JSON.parse(jsonMatch[0]) as {
      safety: JudgeScore;
      accuracy: JudgeScore;
      actionability: JudgeScore;
      completeness: JudgeScore;
      summary: string;
    };

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
        },
      });
    }

    span?.end();
    trace?.end();

    return evaluation;
  } catch (error) {
    trace?.update({ metadata: { error: String(error) } });
    trace?.end();

    // Return a failed evaluation
    return {
      safety: { score: 0, reasoning: "Evaluation failed" },
      accuracy: { score: 0, reasoning: "Evaluation failed" },
      actionability: { score: 0, reasoning: "Evaluation failed" },
      completeness: { score: 0, reasoning: "Evaluation failed" },
      overall: 0,
      summary: `Evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
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
