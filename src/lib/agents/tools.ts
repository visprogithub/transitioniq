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
import { retrieveKnowledge } from "@/lib/knowledge-base/knowledge-index";
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
    description: "Check for drug-drug interactions using FDA Drug Label database (official prescribing information)",
    parameters: ["medications"],
    execute: checkDrugInteractionsTool,
  },
  check_boxed_warnings: {
    name: "check_boxed_warnings",
    description: "Check for FDA Black Box Warnings on medications - the most serious safety warnings",
    parameters: ["medications"],
    execute: checkBoxedWarningsTool,
  },
  check_drug_recalls: {
    name: "check_drug_recalls",
    description: "Check for recent FDA drug recalls and enforcement actions",
    parameters: ["drugName"],
    execute: checkDrugRecallsTool,
  },
  get_comprehensive_drug_safety: {
    name: "get_comprehensive_drug_safety",
    description: "Get comprehensive FDA safety profile including FAERS adverse event counts, boxed warnings, recalls, and risk level",
    parameters: ["drugName"],
    execute: getComprehensiveDrugSafetyTool,
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
    parameters: ["patient", "drugInteractions", "careGaps", "costs"],
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
    console.error("[Agent Tool] FDA drug interaction check failed:", error);
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
    console.error("[Agent Tool] FDA boxed warning check failed:", error);
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
    console.error("[Agent Tool] FDA recall check failed:", error);
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
    console.error("[Agent Tool] Comprehensive safety check failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Comprehensive safety check failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Evaluate care gaps using rule-based clinical guidelines data
 *
 * Returns DATA ONLY - no internal LLM call.
 * The ReAct agent synthesizes this data in its reasoning.
 */
async function evaluateCareGapsTool(input: Record<string, unknown>): Promise<ToolResult<CareGapContext[]>> {
  const startTime = Date.now();
  const patient = input.patient as Patient;

  try {
    // Get rule-based care gap data from clinical guidelines
    const ruleResults = ruleBasedCareGaps(patient);

    console.log(`[Agent Tool] Care gaps: ${ruleResults.length} guidelines checked, ${ruleResults.filter((r) => r.status === "unmet").length} unmet`);

    // Return DATA only - ReAct agent does the synthesis
    return {
      success: true,
      data: ruleResults.map((r) => ({
        guideline: r.guideline,
        status: r.status,
        grade: r.grade,
      })),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[Agent Tool] Care gap evaluation failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Care gap evaluation failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Estimate medication costs using CMS pricing data
 *
 * Returns DATA ONLY - no internal LLM call.
 * The ReAct agent synthesizes this data in its reasoning.
 */
async function estimateCostsTool(input: Record<string, unknown>): Promise<ToolResult<CostContext[]>> {
  const startTime = Date.now();
  const medications = input.medications as Patient["medications"];

  try {
    // Get CMS pricing data
    const cmsEstimates = await estimateMedicationCosts(
      medications.map((m) => ({ name: m.name, dose: m.dose, frequency: m.frequency }))
    );

    const totalOOP = cmsEstimates.reduce((s, e) => s + e.estimatedMonthlyOOP, 0);
    console.log(`[Agent Tool] CMS costs: ${cmsEstimates.length} medications, total $${totalOOP}/month`);

    // Return DATA only - ReAct agent does the synthesis
    return {
      success: true,
      data: cmsEstimates.map((e) => ({
        medication: e.drugName,
        monthlyOOP: e.estimatedMonthlyOOP,
        covered: e.coveredByMedicarePartD,
      })),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[Agent Tool] Cost estimation failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Cost estimation failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Knowledge retrieval result - raw search data
 */
interface KnowledgeContext {
  query: string;
  results: {
    title: string;
    type: string;
    content: string;
    score: number;
  }[];
  searchStats: {
    documentsSearched: number;
    resultsFound: number;
    topScore: number;
  };
}

/**
 * Retrieve clinical knowledge using TF-IDF search
 *
 * Returns DATA ONLY - no internal LLM call.
 * The ReAct agent synthesizes this data in its reasoning.
 */
async function retrieveKnowledgeTool(input: Record<string, unknown>): Promise<ToolResult<KnowledgeContext>> {
  const startTime = Date.now();
  const patient = input.patient as Patient;
  const customQuery = input.query as string | undefined;

  try {
    // Build search query from patient context
    const conditions = patient.diagnoses.map((d) => d.display).join(", ");
    const meds = patient.medications.map((m) => m.name).join(", ");
    const searchQuery = customQuery || `${conditions} ${meds}`;

    // TF-IDF retrieval from knowledge base
    const { results, documentCount } = retrieveKnowledge(searchQuery, {
      topK: 8,
    });

    console.log(`[Agent Tool] Knowledge search: ${results.length} results from ${documentCount} documents (top score: ${results[0]?.score?.toFixed(3) || 0})`);

    // Return DATA only - ReAct agent does the synthesis
    return {
      success: true,
      data: {
        query: searchQuery,
        results: results.map((r) => ({
          title: r.document.title,
          type: r.document.type,
          content: r.document.content.slice(0, 500), // Truncate for context efficiency
          score: r.score,
        })),
        searchStats: {
          documentsSearched: documentCount,
          resultsFound: results.length,
          topScore: results[0]?.score || 0,
        },
      },
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[Agent Tool] Knowledge retrieval failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Knowledge retrieval failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Analyze discharge readiness using LLM
 * Uses the currently selected model via LLMProvider
 */
async function analyzeReadinessTool(input: Record<string, unknown>): Promise<ToolResult<DischargeAnalysis>> {
  const startTime = Date.now();

  const patient = input.patient as Patient;
  const drugInteractions = input.drugInteractions as DrugInteractionContext[];
  const careGaps = input.careGaps as CareGapContext[];
  const costs = input.costs as CostContext[];

  console.log(`[Agent Tool] analyze_readiness using model: ${getActiveModelId()}`);

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

    // Use LLM-powered analysis with the selected model
    const analysis = await llmAnalyzeReadiness(
      patient,
      formattedInteractions,
      formattedGaps,
      formattedCosts
    );

    return {
      success: true,
      data: analysis,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[Agent Tool] LLM analysis failed:", error);
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
    console.error("[Agent Tool] LLM plan generation failed:", error);
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

