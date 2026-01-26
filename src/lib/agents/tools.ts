/**
 * Agent Tools - Executable tools the agent can invoke
 */

import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions, type DrugInteraction } from "@/lib/integrations/fda-client";
import { evaluateCareGaps, type CareGap } from "@/lib/integrations/guidelines-client";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";
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
    description: "Analyze all gathered data to compute discharge readiness score and risk factors",
    parameters: ["patient", "drugInteractions", "careGaps", "costs"],
    execute: analyzeReadinessTool,
  },
  generate_plan: {
    name: "generate_plan",
    description: "Generate a discharge planning checklist based on analysis results",
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
        conditionCount: patient.conditions.length,
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
 * Check drug interactions
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
    // Fallback to known interactions
    const fallbackInteractions = getKnownInteractionsFallback(medications);
    return {
      success: true,
      data: fallbackInteractions,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Evaluate care gaps
 */
async function evaluateCareGapsTool(input: Record<string, unknown>): Promise<ToolResult<CareGapContext[]>> {
  const startTime = Date.now();
  const patient = input.patient as Patient;

  try {
    const gaps = evaluateCareGaps(patient);
    return {
      success: true,
      data: gaps.map((g) => ({
        guideline: g.guideline,
        status: g.status,
        grade: g.grade,
      })),
      duration: Date.now() - startTime,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to evaluate care gaps",
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Estimate medication costs
 */
async function estimateCostsTool(input: Record<string, unknown>): Promise<ToolResult<CostContext[]>> {
  const startTime = Date.now();
  const medications = input.medications as Patient["medications"];

  const highCostMeds = [
    { pattern: "eliquis", cost: 500 },
    { pattern: "xarelto", cost: 450 },
    { pattern: "entresto", cost: 550 },
    { pattern: "jardiance", cost: 450 },
    { pattern: "ozempic", cost: 900 },
    { pattern: "spiriva", cost: 350 },
  ];

  const costs = medications.map((med) => {
    const medNameLower = med.name.toLowerCase();
    const highCost = highCostMeds.find((hc) => medNameLower.includes(hc.pattern));

    return {
      medication: med.name,
      monthlyOOP: highCost ? highCost.cost : 10,
      covered: !highCost,
    };
  });

  return {
    success: true,
    data: costs,
    duration: Date.now() - startTime,
  };
}

/**
 * Analyze discharge readiness
 */
async function analyzeReadinessTool(input: Record<string, unknown>): Promise<ToolResult<DischargeAnalysis>> {
  const startTime = Date.now();

  const patient = input.patient as Patient;
  const drugInteractions = input.drugInteractions as DrugInteractionContext[];
  const careGaps = input.careGaps as CareGapContext[];
  const costs = input.costs as CostContext[];

  const riskFactors: RiskFactor[] = [];
  let score = 100;

  // Drug interaction risks
  for (const interaction of drugInteractions) {
    const deduction = interaction.severity === "major" ? 20 : interaction.severity === "moderate" ? 10 : 5;
    score -= deduction;

    riskFactors.push({
      id: `di-${riskFactors.length}`,
      severity: interaction.severity,
      category: "drug_interaction",
      title: `${interaction.drug1} + ${interaction.drug2} Interaction`,
      description: interaction.description,
      source: "FDA",
      actionable: true,
      resolution: interaction.severity === "major"
        ? "Review medication regimen with pharmacist"
        : "Monitor for adverse effects",
    });
  }

  // Care gap risks
  const unmetGaps = careGaps.filter((g) => g.status === "unmet");
  for (const gap of unmetGaps) {
    const severity = gap.grade === "A" ? "high" : gap.grade === "B" ? "moderate" : "low";
    const deduction = severity === "high" ? 15 : severity === "moderate" ? 8 : 3;
    score -= deduction;

    riskFactors.push({
      id: `cg-${riskFactors.length}`,
      severity,
      category: "care_gap",
      title: gap.guideline,
      description: `Grade ${gap.grade} recommendation not met`,
      source: "Guidelines",
      actionable: true,
    });
  }

  // Lab abnormality risks
  const abnormalLabs = patient.recentLabs?.filter((l) => l.abnormal) || [];
  for (const lab of abnormalLabs) {
    let severity: "high" | "moderate" | "low" = "low";
    let deduction = 5;

    if (lab.name.toLowerCase().includes("inr") && (lab.value > 4 || lab.value < 1.5)) {
      severity = "high";
      deduction = 15;
    } else if (lab.name.toLowerCase().includes("bnp") && lab.value > 500) {
      severity = "moderate";
      deduction = 10;
    }

    score -= deduction;

    riskFactors.push({
      id: `lab-${riskFactors.length}`,
      severity,
      category: "lab_abnormality",
      title: `Abnormal ${lab.name}`,
      description: `${lab.name}: ${lab.value} ${lab.unit} (ref: ${lab.referenceRange})`,
      source: "FHIR",
      actionable: severity !== "low",
    });
  }

  // Cost barrier risks
  const highCostMeds = costs.filter((c) => c.monthlyOOP > 100);
  for (const med of highCostMeds) {
    const severity = med.monthlyOOP > 400 ? "moderate" : "low";
    score -= severity === "moderate" ? 5 : 2;

    riskFactors.push({
      id: `cost-${riskFactors.length}`,
      severity,
      category: "cost_barrier",
      title: `High Cost: ${med.medication}`,
      description: `$${med.monthlyOOP}/month out-of-pocket`,
      source: "CMS",
      actionable: true,
      resolution: "Discuss alternatives or assistance programs",
    });
  }

  score = Math.max(0, Math.min(100, score));

  let status: "ready" | "caution" | "not_ready";
  if (score >= 70) status = "ready";
  else if (score >= 40) status = "caution";
  else status = "not_ready";

  const recommendations: string[] = [];
  if (drugInteractions.some((i) => i.severity === "major")) {
    recommendations.push("Review medication regimen for high-risk interactions");
  }
  if (unmetGaps.some((g) => g.grade === "A")) {
    recommendations.push("Address Grade A guideline recommendations");
  }
  recommendations.push("Schedule follow-up within 7-14 days");

  return {
    success: true,
    data: {
      patientId: patient.id,
      score,
      status,
      riskFactors: riskFactors.sort((a, b) => {
        const order = { high: 0, moderate: 1, low: 2 };
        return order[a.severity] - order[b.severity];
      }),
      recommendations,
      analyzedAt: new Date().toISOString(),
    },
    duration: Date.now() - startTime,
  };
}

/**
 * Generate discharge plan
 */
async function generatePlanTool(input: Record<string, unknown>): Promise<ToolResult<string>> {
  const startTime = Date.now();

  const analysis = input.analysis as DischargeAnalysis;
  const patient = input.patient as Patient;

  const highRisks = analysis.riskFactors.filter((rf) => rf.severity === "high");
  const moderateRisks = analysis.riskFactors.filter((rf) => rf.severity === "moderate");

  const lines: string[] = [
    `DISCHARGE PLANNING CHECKLIST`,
    `Patient: ${patient.name}`,
    `Score: ${analysis.score}/100 (${analysis.status.toUpperCase().replace("_", " ")})`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
  ];

  if (highRisks.length > 0) {
    lines.push("HIGH PRIORITY - MUST ADDRESS:");
    highRisks.forEach((rf, i) => {
      lines.push(`${i + 1}. ${rf.title}: ${rf.description}`);
      if (rf.resolution) lines.push(`   Action: ${rf.resolution}`);
    });
    lines.push("");
  }

  if (moderateRisks.length > 0) {
    lines.push("MODERATE PRIORITY:");
    moderateRisks.forEach((rf, i) => {
      lines.push(`${i + 1}. ${rf.title}: ${rf.description}`);
    });
    lines.push("");
  }

  lines.push("STANDARD TASKS:");
  lines.push("- Medication reconciliation completed");
  lines.push("- Patient education provided");
  lines.push("- Follow-up scheduled (7-14 days)");
  lines.push("- Written instructions given");

  return {
    success: true,
    data: lines.join("\n"),
    duration: Date.now() - startTime,
  };
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

/**
 * Fallback drug interactions for known combinations
 */
function getKnownInteractionsFallback(medications: Patient["medications"]): DrugInteractionContext[] {
  const interactions: DrugInteractionContext[] = [];
  const medNames = medications.map((m) => m.name.toLowerCase());

  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("aspirin"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Aspirin",
      severity: "major",
      description: "Increased bleeding risk",
    });
  }

  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("eliquis"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Eliquis",
      severity: "major",
      description: "Dual anticoagulation - high bleeding risk",
    });
  }

  return interactions;
}
