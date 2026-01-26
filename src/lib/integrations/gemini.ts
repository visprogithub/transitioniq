/**
 * Gemini LLM Integration - REQUIRED for all analysis
 *
 * This module provides real LLM-powered analysis using Gemini.
 * NO FALLBACKS - if Gemini fails, the request fails.
 *
 * Uses the LLMProvider abstraction for model swapping and Opik evaluation.
 */

import type { Patient } from "../types/patient";
import type { DischargeAnalysis, RiskFactor } from "../types/analysis";
import {
  getDischargeAnalysisPrompt,
  formatDischargePrompt,
  logPromptUsage,
  initializeOpikPrompts,
} from "./opik-prompts";
import { createLLMProvider, getActiveModelId, type LLMProvider } from "./llm-provider";

// Validate API key at module load
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is required - no fallback available");
}

// Initialize Opik prompts on first use
let promptsInitialized = false;

// LLM provider instance (created on first use)
let llmProvider: LLMProvider | null = null;

function getLLMProvider(): LLMProvider {
  if (!llmProvider) {
    llmProvider = createLLMProvider();
  }
  return llmProvider;
}

/**
 * Reset the LLM provider (useful for model switching in evaluations)
 */
export function resetLLMProvider(): void {
  llmProvider = null;
}

interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: "major" | "moderate" | "minor";
  description: string;
  faersCount?: number;
}

interface CareGap {
  guideline: string;
  recommendation: string;
  grade: string;
  status: "met" | "unmet" | "not_applicable";
}

interface CostEstimate {
  medication: string;
  monthlyOOP: number;
  covered: boolean;
}

/**
 * Analyze discharge readiness using Gemini LLM
 * NO FALLBACK - throws error if LLM unavailable
 */
export async function analyzeDischargeReadiness(
  patient: Patient,
  drugInteractions: DrugInteraction[],
  careGaps: CareGap[],
  costEstimates: CostEstimate[]
): Promise<DischargeAnalysis> {
  // Validate API key
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required. Configure it in environment variables.");
  }

  // Initialize Opik prompts if not done
  if (!promptsInitialized) {
    await initializeOpikPrompts();
    promptsInitialized = true;
  }

  const startTime = Date.now();

  // Get prompt from Opik Prompt Library
  const { template, commit, fromOpik } = await getDischargeAnalysisPrompt();

  // Format prompt with patient data
  const prompt = formatDischargePrompt(template, {
    patient_name: patient.name,
    patient_age: patient.age,
    patient_gender: patient.gender === "M" ? "Male" : patient.gender === "F" ? "Female" : "Other",
    admission_date: patient.admissionDate,
    diagnoses: patient.diagnoses.map((d) => d.display).join(", "),
    medication_count: patient.medications.length,
    medications: patient.medications
      .map((m) => `  - ${m.name} ${m.dose} ${m.frequency}`)
      .join("\n"),
    allergies: patient.allergies.length > 0 ? patient.allergies.join(", ") : "None documented",
    drug_interactions:
      drugInteractions.length > 0
        ? drugInteractions
            .map(
              (i) =>
                `- ${i.drug1} + ${i.drug2}: ${i.severity.toUpperCase()} - ${i.description}${
                  i.faersCount ? ` (${i.faersCount} FAERS reports)` : ""
                }`
            )
            .join("\n")
        : "No significant interactions detected",
    care_gaps:
      careGaps.filter((g) => g.status === "unmet").length > 0
        ? careGaps
            .filter((g) => g.status === "unmet")
            .map((g) => `- ${g.guideline} (Grade ${g.grade}): ${g.recommendation}`)
            .join("\n")
        : "All applicable guidelines met",
    cost_barriers:
      costEstimates.filter((c) => c.monthlyOOP > 50).length > 0
        ? costEstimates
            .filter((c) => c.monthlyOOP > 50)
            .map(
              (c) =>
                `- ${c.medication}: $${c.monthlyOOP}/month OOP${!c.covered ? " (NOT COVERED)" : ""}`
            )
            .join("\n")
        : "No significant cost barriers identified",
    lab_results:
      patient.recentLabs && patient.recentLabs.length > 0
        ? patient.recentLabs
            .map(
              (l) =>
                `- ${l.name}: ${l.value} ${l.unit} (ref: ${l.referenceRange})${
                  l.abnormal ? " [ABNORMAL]" : ""
                }`
            )
            .join("\n")
        : "No recent labs available",
  });

  // Call LLM via provider - NO TRY/CATCH - let errors propagate
  const provider = getLLMProvider();
  const llmResponse = await provider.generate(prompt, {
    spanName: "discharge-analysis",
    metadata: {
      patient_id: patient.id,
      prompt_commit: commit,
      prompt_from_opik: fromOpik,
    },
  });
  const responseText = llmResponse.content;
  const latencyMs = llmResponse.latencyMs;

  // Parse response - strict parsing, no fallback
  const analysis = parseAnalysisResponse(patient.id, responseText);

  // Log to Opik with prompt commit tracking
  await logPromptUsage(
    patient.id,
    commit,
    {
      patient_id: patient.id,
      patient_name: patient.name,
      medication_count: patient.medications.length,
      interaction_count: drugInteractions.length,
      care_gap_count: careGaps.filter((g) => g.status === "unmet").length,
      prompt_from_opik: fromOpik,
    },
    {
      score: analysis.score,
      status: analysis.status,
      riskFactors: analysis.riskFactors,
      recommendations: analysis.recommendations,
    },
    latencyMs
  );

  return analysis;
}

/**
 * Parse LLM response - strict parsing, throws on failure
 */
function parseAnalysisResponse(patientId: string, responseText: string): DischargeAnalysis {
  // Extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("LLM response did not contain valid JSON. Raw response: " + responseText.slice(0, 500));
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error("Failed to parse LLM JSON response: " + (e as Error).message);
  }

  // Validate required fields
  if (typeof parsed.score !== "number") {
    throw new Error("LLM response missing 'score' field");
  }
  if (!["ready", "caution", "not_ready"].includes(parsed.status as string)) {
    throw new Error(`Invalid status '${parsed.status}' - must be ready, caution, or not_ready`);
  }
  if (!Array.isArray(parsed.riskFactors)) {
    throw new Error("LLM response missing 'riskFactors' array");
  }

  // Parse risk factors with validation
  const riskFactors: RiskFactor[] = (parsed.riskFactors as Record<string, unknown>[]).map(
    (rf, index) => {
      if (!["high", "moderate", "low"].includes(rf.severity as string)) {
        throw new Error(`Invalid severity '${rf.severity}' in risk factor ${index}`);
      }

      return {
        id: `rf-${index}`,
        severity: rf.severity as RiskFactor["severity"],
        category: (rf.category as RiskFactor["category"]) || "care_gap",
        title: (rf.title as string) || "Unnamed risk",
        description: (rf.description as string) || "",
        source: (rf.source as RiskFactor["source"]) || "Internal",
        actionable: (rf.actionable as boolean) ?? true,
        resolution: rf.resolution as string | undefined,
      };
    }
  );

  return {
    patientId,
    score: Math.max(0, Math.min(100, parsed.score)),
    status: parsed.status as DischargeAnalysis["status"],
    riskFactors,
    recommendations: (parsed.recommendations as string[]) || [],
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Generate discharge plan using Gemini LLM
 */
export async function generateDischargePlan(
  patient: Patient,
  analysis: DischargeAnalysis
): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is required");
  }

  const prompt = `Based on the discharge analysis for ${patient.name} (score: ${analysis.score}/100, status: ${analysis.status}), generate a detailed discharge checklist.

Patient: ${patient.name}, ${patient.age}${patient.gender}, admitted ${patient.admissionDate}

Risk factors identified:
${analysis.riskFactors.map((rf) => `- [${rf.severity.toUpperCase()}] ${rf.title}: ${rf.description}`).join("\n")}

Generate a practical discharge checklist with:
1. HIGH PRIORITY - Must complete before discharge (based on high-severity risk factors)
2. MODERATE PRIORITY - Should complete (based on moderate-severity risk factors)
3. STANDARD TASKS - Routine discharge items
4. FOLLOW-UP - Appointments and monitoring needed
5. PATIENT EDUCATION - Key teaching points

Format as a clear, actionable checklist that can be printed for the care team.`;

  const provider = getLLMProvider();
  const response = await provider.generate(prompt, {
    spanName: "discharge-plan-generation",
    metadata: {
      patient_id: patient.id,
      analysis_score: analysis.score,
      analysis_status: analysis.status,
    },
  });
  return response.content;
}
