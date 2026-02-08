/**
 * Agent Tools - Executable tools the agent can invoke
 *
 * Tools use the LLM provider abstraction for model-agnostic analysis.
 * The active model can be switched via the ModelSelector UI.
 */

import { getPatient } from "@/lib/data/demo-patients";
import {
  checkDrugInteractions,
  checkBoxedWarnings,
  checkDrugRecalls,
  getComprehensiveDrugSafety,
} from "@/lib/integrations/fda-client";
import {
  analyzeDischargeReadiness as llmAnalyzeReadiness,
  generateDischargePlan as llmGeneratePlan,
} from "@/lib/integrations/analysis";
import { getActiveModelId } from "@/lib/integrations/llm-provider";
import { estimateMedicationCosts } from "@/lib/integrations/cms-client";
import { evaluateCareGaps as ruleBasedCareGaps } from "@/lib/integrations/guidelines-client";
import { getMyHealthfinderCareGaps } from "@/lib/integrations/myhealthfinder-client";
import {
  getCareGapEvaluationPrompt,
  formatCareGapEvaluationPrompt,
  getCostEstimationPrompt,
  formatCostEstimationPrompt,
  getKnowledgeRetrievalPrompt,
  formatKnowledgeRetrievalPrompt,
} from "@/lib/integrations/opik-prompts";
import { retrieveKnowledge, getIndexStats } from "@/lib/knowledge-base/knowledge-index";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import type {
  ToolResult,
  ToolName,
  PatientContext,
  DrugInteractionContext,
  BoxedWarningContext,
  DrugRecallContext,
  ComprehensiveDrugSafetyContext,
  CareGapContext,
  CostContext,
} from "./types";
import { extractJsonArray } from "@/lib/utils/llm-json";
import { traceError } from "@/lib/integrations/opik";

/**
 * Tool Registry - Maps tool names to their implementations
 */
export const TOOLS: Record<ToolName, ToolDefinition> = {
  fetch_patient: {
    name: "fetch_patient",
    description: "Fetch FHIR-structured patient data including demographics, medications, conditions, and labs",
    parameters: ["patientId"],
    execute: fetchPatientTool,
  },
  check_drug_interactions: {
    name: "check_drug_interactions",
    description: "Check for drug-drug interactions using FDA RxNorm database",
    parameters: ["medications"],
    execute: checkDrugInteractionsTool,
  },
  check_boxed_warnings: {
    name: "check_boxed_warnings",
    description: "Check for FDA Black Box Warnings (most serious safety warnings) on patient medications",
    parameters: ["medications"],
    execute: checkBoxedWarningsTool,
  },
  check_drug_recalls: {
    name: "check_drug_recalls",
    description: "Check for recent FDA drug recalls on all patient medications",
    parameters: ["medications"],
    execute: checkDrugRecallsBatchTool,
  },
  evaluate_care_gaps: {
    name: "evaluate_care_gaps",
    description: "Evaluate patient against clinical guidelines (ACC/AHA, ADA, GOLD) to identify care gaps",
    parameters: ["patient"],
    execute: evaluateCareGapsTool,
  },
  estimate_costs: {
    name: "estimate_costs",
    description: "Estimate out-of-pocket medication costs using CMS pricing data",
    parameters: ["medications"],
    execute: estimateCostsTool,
  },
  retrieve_knowledge: {
    name: "retrieve_knowledge",
    description: "Search the clinical knowledge base (drug monographs, interactions, symptom triage, medical terms) using TF-IDF vector retrieval and synthesize findings via LLM",
    parameters: ["patient", "query"],
    execute: retrieveKnowledgeTool,
  },
  analyze_readiness: {
    name: "analyze_readiness",
    description: "Analyze all gathered data using selected LLM to compute discharge readiness score and risk factors",
    parameters: ["patient", "drugInteractions", "careGaps", "costs", "boxedWarnings", "recalls"],
    execute: analyzeReadinessTool,
  },
  generate_plan: {
    name: "generate_plan",
    description: "Generate a discharge planning checklist using selected LLM based on analysis results",
    parameters: ["analysis", "patient"],
    execute: generatePlanTool,
  },
};

interface ToolDefinition {
  name: ToolName;
  description: string;
  parameters: string[];
  execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Fetch patient data
 */
async function fetchPatientTool(input: Record<string, unknown>): Promise<ToolResult<PatientContext & { raw: Patient }>> {
  const startTime = Date.now();
  const patientId = input.patientId as string;

  try {
    const patient = getPatient(patientId);
    if (!patient) {
      return {
        success: false,
        error: `Patient ${patientId} not found`,
        duration: Date.now() - startTime,
      };
    }

    return {
      success: true,
      data: {
        id: patient.id,
        name: patient.name,
        age: patient.age,
        gender: patient.gender,
        medicationCount: patient.medications.length,
        conditionCount: patient.diagnoses.length,
        raw: patient,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch patient",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Check drug interactions via FDA API
 * No fallbacks - let it fail if FDA API is unavailable
 */
async function checkDrugInteractionsTool(input: Record<string, unknown>): Promise<ToolResult<DrugInteractionContext[]>> {
  const startTime = Date.now();
  const medications = input.medications as Patient["medications"];

  try {
    const interactions = await checkDrugInteractions(medications);
    return {
      success: true,
      data: interactions.map((i) => ({
        drug1: i.drug1,
        drug2: i.drug2,
        severity: i.severity,
        description: i.description,
      })),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-check-drug-interactions", error, { dataSource: "FDA-Interactions" });
    return {
      success: false,
      error: error instanceof Error ? error.message : "FDA drug interaction check failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Check for FDA Black Box Warnings on medications
 * Uses real FDA label data via OpenFDA API
 */
async function checkBoxedWarningsTool(input: Record<string, unknown>): Promise<ToolResult<BoxedWarningContext[]>> {
  const startTime = Date.now();
  const medications = input.medications as Patient["medications"];

  try {
    const warnings = await checkBoxedWarnings(
      medications.map((m) => ({ name: m.name }))
    );

    console.log(`[Agent Tool] FDA boxed warnings: found ${warnings.length} for ${medications.length} medications`);

    return {
      success: true,
      data: warnings.map((w) => ({
        drug: w.drug,
        warning: w.warning,
      })),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-check-boxed-warnings", error, { dataSource: "FDA-BoxedWarnings" });
    return {
      success: false,
      error: error instanceof Error ? error.message : "FDA boxed warning check failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Check for recent FDA drug recalls
 * Uses OpenFDA enforcement API
 */
async function checkDrugRecallsTool(input: Record<string, unknown>): Promise<ToolResult<DrugRecallContext[]>> {
  const startTime = Date.now();
  const drugName = input.drugName as string;

  try {
    const recalls = await checkDrugRecalls(drugName);

    console.log(`[Agent Tool] FDA recalls: found ${recalls.length} for ${drugName}`);

    return {
      success: true,
      data: recalls.map((r) => ({
        drugName: r.drugName,
        recallNumber: r.recallNumber,
        reason: r.reason,
        classification: r.classification,
        status: r.status,
        recallDate: r.recallDate,
      })),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-check-drug-recalls", error, { dataSource: "FDA-Recalls" });
    return {
      success: false,
      error: error instanceof Error ? error.message : "FDA recall check failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Get comprehensive FDA safety profile for a drug
 * Combines FAERS adverse event counts, boxed warnings, recalls, and risk level
 */
async function getComprehensiveDrugSafetyTool(input: Record<string, unknown>): Promise<ToolResult<ComprehensiveDrugSafetyContext>> {
  const startTime = Date.now();
  const drugName = input.drugName as string;

  try {
    const safety = await getComprehensiveDrugSafety(drugName);

    console.log(`[Agent Tool] Comprehensive safety for ${drugName}: FAERS=${safety.faersReportCount}, boxedWarning=${safety.hasBoxedWarning}, recalls=${safety.recentRecalls.length}, risk=${safety.riskLevel}`);

    return {
      success: true,
      data: {
        drugName: safety.drugName,
        faersReportCount: safety.faersReportCount,
        hasBoxedWarning: safety.hasBoxedWarning,
        boxedWarningSummary: safety.boxedWarningSummary,
        recentRecalls: safety.recentRecalls.map((r) => ({
          drugName: r.drugName,
          recallNumber: r.recallNumber,
          reason: r.reason,
          classification: r.classification,
          status: r.status,
          recallDate: r.recallDate,
        })),
        topAdverseReactions: safety.topAdverseReactions,
        riskLevel: safety.riskLevel,
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-comprehensive-safety", error, { dataSource: "FDA" });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Comprehensive safety check failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Check for recent FDA drug recalls across ALL patient medications (batch)
 * Uses OpenFDA enforcement API
 */
async function checkDrugRecallsBatchTool(input: Record<string, unknown>): Promise<ToolResult<DrugRecallContext[]>> {
  const startTime = Date.now();
  const medications = input.medications as Patient["medications"];

  try {
    const recallPromises = medications.map((m) => checkDrugRecalls(m.name));
    const results = await Promise.all(recallPromises);
    const allRecalls = results.flat();

    console.log(`[Agent Tool] FDA recalls: found ${allRecalls.length} across ${medications.length} medications`);

    return {
      success: true,
      data: allRecalls.map((r) => ({
        drugName: r.drugName,
        recallNumber: r.recallNumber,
        reason: r.reason,
        classification: r.classification,
        status: r.status,
        recallDate: r.recallDate,
      })),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-batch-recall-check", error, { dataSource: "FDA-Recalls" });
    return {
      success: false,
      error: error instanceof Error ? error.message : "FDA recall check failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Evaluate care gaps using LLM reasoning augmented with rule-based data
 *
 * AI-first approach: The LLM performs the primary analysis, but receives
 * deterministic rule-based results from guidelines-client.ts as grounding
 * data to reduce hallucinations and improve accuracy.
 */
async function evaluateCareGapsTool(input: Record<string, unknown>): Promise<ToolResult<CareGapContext[]>> {
  const startTime = Date.now();
  const patient = input.patient as Patient;

  console.log(`[Agent Tool] evaluate_care_gaps using model: ${getActiveModelId()}`);

  try {
    // Gather deterministic rule-based data to augment LLM reasoning
    const [ruleResults, myhealthfinderGaps] = await Promise.all([
      Promise.resolve(ruleBasedCareGaps(patient)),
      getMyHealthfinderCareGaps(patient).catch((err) => {
        traceError("tool-myhealthfinder", err, { dataSource: "MyHealthfinder" });
        return [];
      }),
    ]);

    // Merge rule-based + MyHealthfinder gaps (dedup by guideline name)
    const combinedRuleGaps = [...ruleResults];
    const seenNames = new Set(combinedRuleGaps.map((g) => g.guideline.toLowerCase()));
    for (const mhfGap of myhealthfinderGaps) {
      if (!seenNames.has(mhfGap.guideline.toLowerCase())) {
        combinedRuleGaps.push(mhfGap);
        seenNames.add(mhfGap.guideline.toLowerCase());
      }
    }

    const ruleBasedSummary = combinedRuleGaps
      .map((r) => `- ${r.guideline} (${r.organization}, Grade ${r.grade}): ${r.status}${r.status === "unmet" ? ` — ${r.recommendation}` : ""}`)
      .join("\n");

    console.log(`[Agent Tool] Rule-based: ${ruleResults.length} gaps, MyHealthfinder: ${myhealthfinderGaps.length} gaps, combined: ${combinedRuleGaps.length} (after dedup)`);

    // LLM performs primary analysis, augmented with rule-based data
    const { createLLMProvider } = await import("@/lib/integrations/llm-provider");
    const provider = createLLMProvider(getActiveModelId());

    const { template } = await getCareGapEvaluationPrompt();
    const prompt = formatCareGapEvaluationPrompt(template, {
      patientName: patient.name,
      patientAge: patient.age,
      patientGender: patient.gender === "M" ? "Male" : "Female",
      diagnoses: patient.diagnoses.map((d) => d.display).join(", "),
      medications: patient.medications.map((m) => `${m.name} ${m.dose}`).join(", "),
      labs: patient.recentLabs?.map((l) => `${l.name}: ${l.value} ${l.unit}${l.abnormal ? " [ABNORMAL]" : ""}`).join(", ") || "None available",
      vitals: patient.vitalSigns ? `BP ${patient.vitalSigns.bloodPressure}, HR ${patient.vitalSigns.heartRate}` : "Not available",
      existingGaps: ruleBasedSummary || "No rule-based gaps identified",
    });

    const response = await provider.generate(prompt, {
      spanName: "care-gap-evaluation",
      metadata: {
        patient_id: patient.id,
        diagnosis_count: patient.diagnoses.length,
        medication_count: patient.medications.length,
        rule_based_gap_count: ruleResults.length,
        rule_based_unmet_count: ruleResults.filter((r) => r.status === "unmet").length,
        myhealthfinder_gap_count: myhealthfinderGaps.length,
        myhealthfinder_unmet_count: myhealthfinderGaps.filter((g) => g.status === "unmet").length,
      },
    });

    // Parse LLM response (handles Qwen3 thinking tokens, trailing commas, etc.)
    let llmGaps: CareGapContext[] = [];
    try {
      llmGaps = extractJsonArray<CareGapContext[]>(response.content);
    } catch (parseError) {
      traceError("tool-care-gap-parse", parseError, { dataSource: "Guidelines" });
    }

    // Merge rule-based + MyHealthfinder + LLM results, deduplicating by guideline name
    const mergedGaps: CareGapContext[] = combinedRuleGaps.map((r) => ({
      guideline: r.guideline,
      status: r.status,
      grade: r.grade,
    }));

    const existingNames = new Set(mergedGaps.map((g) => g.guideline.toLowerCase()));
    for (const llmGap of llmGaps) {
      if (!existingNames.has(llmGap.guideline.toLowerCase())) {
        mergedGaps.push(llmGap);
        existingNames.add(llmGap.guideline.toLowerCase());
      }
    }

    console.log(`[Agent Tool] Care gap evaluation: ${ruleResults.length} rule-based + ${myhealthfinderGaps.length} MyHealthfinder + ${llmGaps.length} LLM = ${mergedGaps.length} total (after dedup)`);

    return {
      success: true,
      data: mergedGaps,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-evaluate-care-gaps", error, { dataSource: "Guidelines" });

    // Fallback: return rule-based results if LLM fails
    try {
      const fallbackResults = ruleBasedCareGaps(patient);
      return {
        success: true,
        data: fallbackResults.map((r) => ({
          guideline: r.guideline,
          status: r.status,
          grade: r.grade,
        })),
        duration: Date.now() - startTime,
      };
    } catch {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Care gap evaluation failed",
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * Estimate medication costs using CMS data → LLM reasoning
 *
 * All tool data flows through the LLM for reasoning:
 * 1. CMS client provides factual grounding (KNOWN_DRUG_TIERS, NDC API, heuristics)
 * 2. LLM reasons over the CMS data via Opik-versioned prompt
 * 3. Fallback: if LLM fails, use raw CMS data directly
 */
async function estimateCostsTool(input: Record<string, unknown>): Promise<ToolResult<CostContext[]>> {
  const startTime = Date.now();
  const medications = input.medications as Patient["medications"];

  console.log(`[Agent Tool] estimate_costs using model: ${getActiveModelId()}`);

  try {
    // Gather CMS data as grounding for LLM reasoning
    const cmsEstimates = await estimateMedicationCosts(
      medications.map((m) => ({ name: m.name, dose: m.dose, frequency: m.frequency }))
    );

    const cmsDataSummary = cmsEstimates
      .map((e) => `- ${e.drugName}: $${e.estimatedMonthlyOOP}/mo, Tier ${e.tierLevel || "unknown"}, ${e.coveredByMedicarePartD ? "Covered" : "Not covered"}${e.priorAuthRequired ? ", Prior Auth Required" : ""} (Source: ${e.source})`)
      .join("\n");

    console.log(`[Agent Tool] CMS grounding data gathered for ${cmsEstimates.length} medications`);

    // LLM reasons over the CMS data
    const { createLLMProvider } = await import("@/lib/integrations/llm-provider");
    const provider = createLLMProvider(getActiveModelId());

    const { template } = await getCostEstimationPrompt();
    const medicationList = medications.map((m) => `- ${m.name} ${m.dose} ${m.frequency}`).join("\n");
    const prompt = formatCostEstimationPrompt(template, {
      medicationList,
      cmsData: cmsDataSummary,
    });

    const response = await provider.generate(prompt, {
      spanName: "cost-estimation",
      metadata: {
        medication_count: medications.length,
        cms_total_oop: cmsEstimates.reduce((s, e) => s + e.estimatedMonthlyOOP, 0),
      },
    });

    // Parse LLM response (handles Qwen3 thinking tokens, trailing commas, etc.)
    const costs = extractJsonArray<CostContext[]>(response.content);

    console.log(`[Agent Tool] LLM cost analysis: ${costs.length} medications, total $${costs.reduce((s, c) => s + c.monthlyOOP, 0)}/month`);

    return {
      success: true,
      data: costs,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-estimate-costs", error, { dataSource: "CMS" });

    // Fallback: use raw CMS data if LLM fails
    try {
      const fallbackEstimates = await estimateMedicationCosts(
        medications.map((m) => ({ name: m.name, dose: m.dose, frequency: m.frequency }))
      );
      return {
        success: true,
        data: fallbackEstimates.map((e) => ({
          medication: e.drugName,
          monthlyOOP: e.estimatedMonthlyOOP,
          covered: e.coveredByMedicarePartD,
        })),
        duration: Date.now() - startTime,
      };
    } catch {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Cost estimation failed",
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * Knowledge retrieval context type
 */
interface KnowledgeContext {
  summary: string;
  relevantFindings: {
    category: string;
    finding: string;
    importance: string;
  }[];
  patientCounselingPoints: string[];
  monitoringNeeded: string[];
  redFlags: string[];
  searchStats: {
    documentsSearched: number;
    resultsFound: number;
    topScore: number;
  };
}

/**
 * Retrieve and synthesize clinical knowledge using TF-IDF RAG → LLM reasoning
 *
 * Architecture:
 * 1. Build search query from patient context (conditions + medications)
 * 2. TF-IDF search over ~400 knowledge-base documents
 * 3. LLM synthesizes retrieved context for patient-specific relevance
 * 4. Fallback: return raw search results if LLM fails
 */
async function retrieveKnowledgeTool(input: Record<string, unknown>): Promise<ToolResult<KnowledgeContext>> {
  const startTime = Date.now();
  const patient = input.patient as Patient;
  const customQuery = input.query as string | undefined;

  console.log(`[Agent Tool] retrieve_knowledge using model: ${getActiveModelId()}`);

  try {
    // Build search query from patient context
    const conditions = patient.diagnoses.map((d) => d.display).join(", ");
    const meds = patient.medications.map((m) => m.name).join(", ");
    const searchQuery = customQuery || `${conditions} ${meds}`;

    // TF-IDF retrieval from knowledge base
    const { results, formatted, documentCount } = retrieveKnowledge(searchQuery, {
      topK: 8,
    });

    const stats = getIndexStats();
    console.log(`[Agent Tool] Knowledge retrieval: searched ${documentCount} documents, found ${results.length} relevant (top score: ${results[0]?.score?.toFixed(3) || 0})`);
    console.log(`[Agent Tool] Index stats: ${JSON.stringify(stats.documentsByType)}`);

    if (results.length === 0) {
      return {
        success: true,
        data: {
          summary: "No relevant entries found in the clinical knowledge base for this patient's conditions and medications.",
          relevantFindings: [],
          patientCounselingPoints: [],
          monitoringNeeded: [],
          redFlags: [],
          searchStats: { documentsSearched: documentCount, resultsFound: 0, topScore: 0 },
        },
        duration: Date.now() - startTime,
      };
    }

    // LLM synthesizes the retrieved context
    const { createLLMProvider } = await import("@/lib/integrations/llm-provider");
    const provider = createLLMProvider(getActiveModelId());

    const { template } = await getKnowledgeRetrievalPrompt();
    const prompt = formatKnowledgeRetrievalPrompt(template, {
      patientName: patient.name,
      patientAge: patient.age,
      patientGender: patient.gender === "M" ? "Male" : "Female",
      diagnoses: conditions,
      medications: meds,
      query: searchQuery,
      retrievedContext: formatted,
    });

    const response = await provider.generate(prompt, {
      spanName: "knowledge-retrieval",
      metadata: {
        patient_id: patient.id,
        search_query: searchQuery,
        results_found: results.length,
        top_score: results[0]?.score || 0,
        document_types: results.map((r) => r.document.type),
        index_total_docs: documentCount,
        index_vocabulary_size: stats.vocabularySize,
      },
    });

    // Parse LLM response
    const { extractJsonObject } = await import("@/lib/utils/llm-json");
    const synthesis = extractJsonObject<{
      summary: string;
      relevantFindings: { category: string; finding: string; importance: string }[];
      patientCounselingPoints: string[];
      monitoringNeeded: string[];
      redFlags: string[];
    }>(response.content);

    console.log(`[Agent Tool] Knowledge synthesis: ${synthesis.relevantFindings?.length || 0} findings, ${synthesis.redFlags?.length || 0} red flags`);

    return {
      success: true,
      data: {
        summary: synthesis.summary || "Knowledge base search completed.",
        relevantFindings: synthesis.relevantFindings || [],
        patientCounselingPoints: synthesis.patientCounselingPoints || [],
        monitoringNeeded: synthesis.monitoringNeeded || [],
        redFlags: synthesis.redFlags || [],
        searchStats: {
          documentsSearched: documentCount,
          resultsFound: results.length,
          topScore: results[0]?.score || 0,
        },
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-knowledge-retrieval", error, { dataSource: "Guidelines" });

    // Fallback: return raw search results without LLM synthesis
    try {
      const conditions = patient.diagnoses.map((d) => d.display).join(", ");
      const meds = patient.medications.map((m) => m.name).join(", ");
      const { results, documentCount } = retrieveKnowledge(
        customQuery || `${conditions} ${meds}`,
        { topK: 5 }
      );

      return {
        success: true,
        data: {
          summary: results.map((r) => `${r.document.title}: ${r.document.content.slice(0, 200)}`).join("\n"),
          relevantFindings: results.map((r) => ({
            category: r.document.type,
            finding: r.document.title,
            importance: "informational" as const,
          })),
          patientCounselingPoints: [],
          monitoringNeeded: [],
          redFlags: [],
          searchStats: {
            documentsSearched: documentCount,
            resultsFound: results.length,
            topScore: results[0]?.score || 0,
          },
        },
        duration: Date.now() - startTime,
      };
    } catch {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Knowledge retrieval failed",
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * Analyze discharge readiness using LLM
 * Uses the currently selected model via LLMProvider
 */
async function analyzeReadinessTool(input: Record<string, unknown>): Promise<ToolResult<DischargeAnalysis>> {
  const startTime = Date.now();

  const patient = input.patient as Patient;
  const drugInteractions = (input.drugInteractions || []) as DrugInteractionContext[];
  const careGaps = (input.careGaps || []) as CareGapContext[];
  const costs = (input.costs || []) as CostContext[];
  const boxedWarnings = (input.boxedWarnings || []) as BoxedWarningContext[];
  const drugRecalls = (input.recalls || []) as DrugRecallContext[];
  const knowledgeContext = input.knowledgeContext as { summary: string; relevantFindings?: Array<{ category: string; finding: string; importance: string }>; redFlags?: string[]; monitoringNeeded?: string[] } | undefined;

  console.log(`[Agent Tool] analyze_readiness using model: ${getActiveModelId()}`);
  console.log(`[Agent Tool] analyze_readiness inputs: ${drugInteractions.length} interactions, ${boxedWarnings.length} boxed warnings, ${drugRecalls.length} recalls, ${careGaps.length} care gaps, ${costs.length} costs, knowledge: ${knowledgeContext ? 'yes' : 'no'}`);

  try {
    // Convert tool context types to analysis types
    const formattedInteractions = drugInteractions.map((i) => ({
      drug1: i.drug1,
      drug2: i.drug2,
      severity: i.severity as "major" | "moderate" | "minor",
      description: i.description,
    }));

    const formattedGaps = careGaps.map((g) => ({
      guideline: g.guideline,
      recommendation: `Grade ${g.grade} - ${g.status}`,
      grade: g.grade,
      status: g.status,
    }));

    const formattedCosts = costs.map((c) => ({
      medication: c.medication,
      monthlyOOP: c.monthlyOOP,
      covered: c.covered,
    }));

    // Format boxed warnings for analysis
    const formattedWarnings = boxedWarnings.map((w) => ({
      drug: w.drug,
      warning: w.warning,
    }));

    // Format recalls for analysis
    const formattedRecalls = drugRecalls.map((r) => ({
      drugName: r.drugName,
      reason: r.reason,
      classification: r.classification,
    }));

    // Use LLM-powered analysis with the selected model, including FDA safety data and knowledge context
    const analysis = await llmAnalyzeReadiness(
      patient,
      formattedInteractions,
      formattedGaps,
      formattedCosts,
      formattedWarnings.length > 0 ? formattedWarnings : undefined,
      formattedRecalls.length > 0 ? formattedRecalls : undefined,
      knowledgeContext
    );

    return {
      success: true,
      data: analysis,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-analyze-readiness", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM analysis failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Generate discharge plan using LLM
 * Uses the currently selected model via LLMProvider
 */
async function generatePlanTool(input: Record<string, unknown>): Promise<ToolResult<string>> {
  const startTime = Date.now();

  const analysis = input.analysis as DischargeAnalysis;
  const patient = input.patient as Patient;

  console.log(`[Agent Tool] generate_plan using model: ${getActiveModelId()}`);

  try {
    // Use LLM-powered plan generation with the selected model
    const plan = await llmGeneratePlan(patient, analysis);

    return {
      success: true,
      data: plan,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    traceError("tool-generate-plan", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM plan generation failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute a tool by name
 */
export async function executeTool(toolName: ToolName, input: Record<string, unknown>): Promise<ToolResult> {
  const tool = TOOLS[toolName];
  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${toolName}`,
      duration: 0,
    };
  }
  return tool.execute(input);
}

/**
 * Get tool definition
 */
export function getToolDefinition(toolName: ToolName): ToolDefinition | undefined {
  return TOOLS[toolName];
}

/**
 * List all available tools
 */
export function listTools(): ToolDefinition[] {
  return Object.values(TOOLS);
}

