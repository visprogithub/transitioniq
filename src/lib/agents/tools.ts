/**
 * Agent Tools - Executable tools the agent can invoke
 *
 * Tools use the LLM provider abstraction for model-agnostic analysis.
 * The active model can be switched via the ModelSelector UI.
 */

import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions } from "@/lib/integrations/fda-client";
import {
  analyzeDischargeReadiness as llmAnalyzeReadiness,
  generateDischargePlan as llmGeneratePlan,
} from "@/lib/integrations/analysis";
import { getActiveModelId } from "@/lib/integrations/llm-provider";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import type { ToolResult, ToolName, PatientContext, DrugInteractionContext, CareGapContext, CostContext } from "./types";

/**
 * Tool Registry - Maps tool names to their implementations
 */
export const TOOLS: Record<ToolName, ToolDefinition> = {
  fetch_patient: {
    name: "fetch_patient",
    description: "Fetch patient data from FHIR including demographics, medications, conditions, and labs",
    parameters: ["patientId"],
    execute: fetchPatientTool,
  },
  check_drug_interactions: {
    name: "check_drug_interactions",
    description: "Check for drug-drug interactions using FDA RxNorm database",
    parameters: ["medications"],
    execute: checkDrugInteractionsTool,
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
 * Evaluate care gaps using LLM reasoning
 * Uses the currently selected model to analyze against clinical guidelines
 */
async function evaluateCareGapsTool(input: Record<string, unknown>): Promise<ToolResult<CareGapContext[]>> {
  const startTime = Date.now();
  const patient = input.patient as Patient;

  console.log(`[Agent Tool] evaluate_care_gaps using model: ${getActiveModelId()}`);

  try {
    // Use LLM to reason about care gaps against clinical guidelines
    const { createLLMProvider } = await import("@/lib/integrations/llm-provider");
    const provider = createLLMProvider(getActiveModelId());

    const patientContext = `
Patient: ${patient.name}, ${patient.age}yo ${patient.gender === "M" ? "Male" : "Female"}
Diagnoses: ${patient.diagnoses.map((d) => d.display).join(", ")}
Medications: ${patient.medications.map((m) => `${m.name} ${m.dose}`).join(", ")}
Labs: ${patient.recentLabs?.map((l) => `${l.name}: ${l.value} ${l.unit}${l.abnormal ? " [ABNORMAL]" : ""}`).join(", ") || "None available"}
Vitals: ${patient.vitalSigns ? `BP ${patient.vitalSigns.bloodPressure}, HR ${patient.vitalSigns.heartRate}` : "Not available"}
`;

    const prompt = `You are a clinical decision support system analyzing a patient against evidence-based clinical guidelines.

${patientContext}

Evaluate this patient against the following major clinical guidelines:
1. ACC/AHA Heart Failure Guidelines (if applicable)
2. ADA Diabetes Standards of Care (if applicable)
3. ACC/AHA/HRS Atrial Fibrillation Guidelines (if applicable)
4. GOLD COPD Guidelines (if applicable)
5. Discharge Planning Standards (CMS/TJC)

For each applicable guideline, determine if the patient meets the recommendation or has a care gap.

Respond with ONLY a JSON array of care gaps found, no other text:
[
  {"guideline": "Guideline Name", "status": "met" or "unmet", "grade": "A" or "B" or "C"},
  ...
]

Notes:
- Grade A = Strong recommendation, high-quality evidence
- Grade B = Moderate recommendation or moderate evidence
- Grade C = Weak recommendation or low-quality evidence
- Only include guidelines that apply to this patient's conditions
- Be thorough but clinically accurate`;

    const response = await provider.generate(prompt, {
      spanName: "care-gap-evaluation",
      metadata: {
        patient_id: patient.id,
        diagnosis_count: patient.diagnoses.length,
        medication_count: patient.medications.length,
      },
    });

    // Parse LLM response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("LLM did not return valid JSON array for care gap evaluation");
    }

    const gaps = JSON.parse(jsonMatch[0]) as CareGapContext[];

    return {
      success: true,
      data: gaps,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[Agent Tool] LLM care gap evaluation failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM care gap evaluation failed",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Estimate medication costs using LLM reasoning
 * Uses the currently selected model to reason about medication costs
 */
async function estimateCostsTool(input: Record<string, unknown>): Promise<ToolResult<CostContext[]>> {
  const startTime = Date.now();
  const medications = input.medications as Patient["medications"];

  console.log(`[Agent Tool] estimate_costs using model: ${getActiveModelId()}`);

  try {
    // Use LLM to reason about medication costs
    const { createLLMProvider } = await import("@/lib/integrations/llm-provider");
    const provider = createLLMProvider(getActiveModelId());

    const medicationList = medications.map((m) => `- ${m.name} ${m.dose} ${m.frequency}`).join("\n");

    const prompt = `Analyze the following medications and estimate their monthly out-of-pocket costs for a typical Medicare Part D patient without supplemental coverage.

Medications:
${medicationList}

For each medication, estimate:
1. The approximate monthly out-of-pocket cost in USD
2. Whether it's typically covered by Medicare Part D (true/false)

Consider:
- Brand vs generic availability
- Typical copay tiers
- High-cost specialty medications (biologics, newer anticoagulants, GLP-1 agonists)
- Common generic medications typically have low costs ($10-30/month)
- Brand-name medications without generics often cost $100-500+/month

Respond with ONLY a JSON array, no other text:
[
  {"medication": "Drug Name", "monthlyOOP": 150, "covered": true},
  ...
]`;

    const response = await provider.generate(prompt, {
      spanName: "cost-estimation",
      metadata: {
        medication_count: medications.length,
      },
    });

    // Parse LLM response
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("LLM did not return valid JSON array for cost estimation");
    }

    const costs = JSON.parse(jsonMatch[0]) as CostContext[];

    return {
      success: true,
      data: costs,
      duration: Date.now() - startTime,
    };
  } catch (error) {
    console.error("[Agent Tool] LLM cost estimation failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "LLM cost estimation failed",
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

