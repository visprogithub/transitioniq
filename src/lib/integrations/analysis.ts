/**
 * Discharge Analysis Module - LLM-powered patient analysis
 *
 * This module provides discharge readiness analysis using the LLMProvider abstraction.
 * Supports multiple LLM providers (Gemini, OpenAI, Anthropic, HuggingFace).
 * NO FALLBACKS - if the LLM fails, the request fails.
 *
 * Uses the LLMProvider abstraction for model swapping and Opik evaluation.
 */

import type { Patient } from "../types/patient";
import type { DischargeAnalysis, RiskFactor } from "../types/analysis";
import {
  getDischargeAnalysisPrompt,
  formatDischargePrompt,
  getDischargePlanPrompt,
  formatDischargePlanPrompt,
  logPromptUsage,
  initializeOpikPrompts,
} from "./opik-prompts";
import { createLLMProvider, getActiveModelId, type LLMProvider } from "./llm-provider";
import {
  applyInputGuardrails,
  applyOutputGuardrails,
  recordGuardrailStats,
} from "../guardrails";
import { extractJsonObject } from "../utils/llm-json";

// Note: API key validation is now handled by LLMProvider
// Multiple providers are supported (Gemini, OpenAI, Anthropic, HuggingFace)

/**
 * Estimate token cost for Opik tracking.
 * Approximate pricing per 1K tokens (USD).
 */
function estimateTokenCost(
  usage: { promptTokens: number; completionTokens: number; totalTokens: number },
  modelId: string
): number {
  const pricing: Record<string, { input: number; output: number }> = {
    "gemini-2.5-flash": { input: 0.00015, output: 0.00060 },
    "gemini-2.5-flash-lite": { input: 0.000075, output: 0.00030 },
    "openai-gpt-4o-mini": { input: 0.00015, output: 0.00060 },
    "hf-qwen3-8b": { input: 0.0001, output: 0.0002 },
    "hf-qwen3-30b-a3b": { input: 0.0001, output: 0.0002 },
    "claude-3-haiku-20240307": { input: 0.00025, output: 0.00125 },
    "claude-3-sonnet-20240229": { input: 0.00300, output: 0.01500 },
  };
  const p = pricing[modelId];
  if (!p) {
    return (usage.promptTokens * 0.0001 + usage.completionTokens * 0.0002) / 1000;
  }
  return (usage.promptTokens * p.input + usage.completionTokens * p.output) / 1000;
}

// Initialize Opik prompts on first use
let promptsInitialized = false;

/**
 * Get LLM provider for the current active model
 * Always passes the model ID explicitly to avoid module caching issues
 */
function getLLMProvider(): LLMProvider {
  // IMPORTANT: Always get the current activeModelId and pass it explicitly
  // This avoids Next.js module caching issues where the default would be stale
  const modelId = getActiveModelId();
  console.log(`[Analysis] Creating LLM provider for model: ${modelId}`);
  return createLLMProvider(modelId);
}

/**
 * Reset the LLM provider (kept for API compatibility)
 */
export function resetLLMProvider(): void {
  // No-op - we now create fresh providers each time with explicit model ID
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
 * Analyze discharge readiness using selected LLM
 * NO FALLBACK - throws error if LLM unavailable
 */
export async function analyzeDischargeReadiness(
  patient: Patient,
  drugInteractions: DrugInteraction[],
  careGaps: CareGap[],
  costEstimates: CostEstimate[]
): Promise<DischargeAnalysis> {
  // Note: API key validation is handled by LLMProvider for the active model

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

  // Apply input guardrails - check for PII in prompt before sending to LLM
  const inputGuardrail = applyInputGuardrails(prompt, {
    sanitizePII: true,
    usePlaceholders: true,
    blockCriticalPII: true,
    logToOpik: true,
    traceName: "guardrail-discharge-analysis-input",
  });
  recordGuardrailStats(inputGuardrail);

  // If critical PII was detected and blocked, return an error
  if (inputGuardrail.wasBlocked) {
    throw new Error(`Analysis blocked: ${inputGuardrail.error}`);
  }

  // Use sanitized prompt if PII was detected
  const sanitizedPrompt = inputGuardrail.wasSanitized ? inputGuardrail.output : prompt;

  // Call LLM via provider - NO TRY/CATCH - let errors propagate
  const provider = getLLMProvider();
  const llmResponse = await provider.generate(sanitizedPrompt, {
    spanName: "discharge-analysis",
    metadata: {
      patient_id: patient.id,
      prompt_commit: commit,
      prompt_from_opik: fromOpik,
      pii_sanitized: inputGuardrail.wasSanitized,
    },
  });

  // Apply output guardrails - check LLM response for any leaked PII
  const outputGuardrail = applyOutputGuardrails(llmResponse.content, {
    sanitizePII: true,
    usePlaceholders: true,
    logToOpik: true,
    traceName: "guardrail-discharge-analysis-output",
  });
  recordGuardrailStats(outputGuardrail);

  const responseText = outputGuardrail.wasSanitized ? outputGuardrail.output : llmResponse.content;
  const latencyMs = llmResponse.latencyMs;

  // Parse response - strict parsing, no fallback
  const analysis = parseAnalysisResponse(patient.id, responseText);

  // Log to Opik with prompt commit tracking, model info, AND token usage
  const modelId = getActiveModelId();
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
    latencyMs,
    modelId,
    llmResponse.tokenUsage,
    llmResponse.tokenUsage ? estimateTokenCost(llmResponse.tokenUsage, modelId) : undefined
  );

  // Include which model actually produced this analysis
  analysis.modelUsed = llmResponse.model;

  return analysis;
}

/**
 * Parse LLM response - strict parsing, throws on failure
 */
function parseAnalysisResponse(patientId: string, responseText: string): DischargeAnalysis {
  // Extract JSON from response (handles Qwen3 thinking tokens, trailing commas, etc.)
  const parsed = extractJsonObject<Record<string, unknown>>(responseText);

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
 * Generate discharge plan using LLM with Opik prompt versioning
 */
export async function generateDischargePlan(
  patient: Patient,
  analysis: DischargeAnalysis
): Promise<string> {
  // Note: API key validation is handled by LLMProvider for the active model

  // Build risk factor context
  const highRisks = analysis.riskFactors.filter((rf) => rf.severity === "high");
  const moderateRisks = analysis.riskFactors.filter((rf) => rf.severity === "moderate");

  // Get prompt from Opik Prompt Library
  const { template, commit, fromOpik } = await getDischargePlanPrompt();

  // Format prompt with patient and analysis data
  const prompt = formatDischargePlanPrompt(template, {
    patient_name: patient.name,
    patient_age: patient.age,
    patient_gender: patient.gender === "M" ? "Male" : "Female",
    score: analysis.score,
    status: analysis.status,
    high_risks: highRisks.length > 0
      ? highRisks.map((rf) => `- ${rf.title}: ${rf.description}`).join("\n")
      : "None identified",
    moderate_risks: moderateRisks.length > 0
      ? moderateRisks.map((rf) => `- ${rf.title}: ${rf.description}`).join("\n")
      : "None identified",
  });

  // Apply input guardrails
  const inputGuardrail = applyInputGuardrails(prompt, {
    sanitizePII: true,
    usePlaceholders: true,
    blockCriticalPII: true,
    logToOpik: true,
    traceName: "guardrail-discharge-plan-input",
  });
  recordGuardrailStats(inputGuardrail);

  if (inputGuardrail.wasBlocked) {
    throw new Error(`Plan generation blocked: ${inputGuardrail.error}`);
  }

  const sanitizedPrompt = inputGuardrail.wasSanitized ? inputGuardrail.output : prompt;

  const provider = getLLMProvider();
  const response = await provider.generate(sanitizedPrompt, {
    spanName: "discharge-plan-generation",
    metadata: {
      patient_id: patient.id,
      analysis_score: analysis.score,
      analysis_status: analysis.status,
      prompt_name: "discharge-plan",
      prompt_commit: commit,
      prompt_from_opik: fromOpik,
      pii_sanitized: inputGuardrail.wasSanitized,
    },
  });

  // Apply output guardrails
  const outputGuardrail = applyOutputGuardrails(response.content, {
    sanitizePII: true,
    usePlaceholders: true,
    logToOpik: true,
    traceName: "guardrail-discharge-plan-output",
  });
  recordGuardrailStats(outputGuardrail);

  console.log(`[Analysis] Discharge plan generated using prompt version: ${commit || "local"} (from Opik: ${fromOpik})`);

  return outputGuardrail.wasSanitized ? outputGuardrail.output : response.content;
}
