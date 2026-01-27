import { NextRequest, NextResponse } from "next/server";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractions, type DrugInteraction } from "@/lib/integrations/fda-client";
import { evaluateCareGaps } from "@/lib/integrations/guidelines-client";
import { analyzeDischargeReadiness } from "@/lib/integrations/analysis";
import { traceDataSourceCall } from "@/lib/integrations/opik";
import { getActiveModelId, isModelLimitError, getAvailableModels } from "@/lib/integrations/llm-provider";
import { runAgent, getSession } from "@/lib/agents/orchestrator";
import type { Patient } from "@/lib/types/patient";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, useAgent = true, sessionId } = body;

    if (!patientId) {
      return NextResponse.json({ error: "patientId required" }, { status: 400 });
    }

    // Get patient data
    const patient = getPatient(patientId);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Use the TypeScript agent orchestrator for multi-turn analysis
    if (useAgent) {
      console.log("[Analyze] Using multi-turn agent orchestrator");

      try {
        // Run the agent with ReAct-style loop
        const agentResponse = await runAgent({
          patientId,
          sessionId,
          message: `Assess discharge readiness for patient ${patientId}`,
        });

        // Get session for additional context
        const session = getSession(agentResponse.sessionId);

        // Return agent response with full context
        return NextResponse.json({
          // Analysis results
          score: agentResponse.analysis?.score,
          status: agentResponse.analysis?.status,
          riskFactors: agentResponse.analysis?.riskFactors || [],
          recommendations: agentResponse.analysis?.recommendations || [],
          analyzedAt: new Date().toISOString(),

          // Agent execution metadata
          modelUsed: getActiveModelId(),
          agentUsed: true,
          sessionId: agentResponse.sessionId,
          message: agentResponse.message,
          toolsUsed: agentResponse.toolsUsed,
          agentGraph: agentResponse.agentGraph,
          suggestedActions: agentResponse.suggestedActions,

          // Session context
          steps: session?.steps || [],
          conversationHistory: session?.context.conversationHistory || [],
        });
      } catch (agentError) {
        console.warn("[Analyze] Agent error, falling back to direct LLM:", agentError);
        // Fall through to direct LLM implementation
      }
    }

    // Fallback: Direct LLM implementation (single-turn)
    console.log("[Analyze] Using direct LLM (single-turn)");

    // Run data gathering in parallel with Opik tracing
    const [drugInteractionsResult, careGapsResult] = await Promise.all([
      traceDataSourceCall("FDA", patientId, async () => {
        try {
          return await checkDrugInteractions(patient.medications);
        } catch (error) {
          console.error("FDA check failed:", error);
          return getKnownInteractionsForPatient(patient);
        }
      }),
      traceDataSourceCall("Guidelines", patientId, async () => {
        return evaluateCareGaps(patient);
      }),
    ]);

    const drugInteractions = drugInteractionsResult.result;
    const careGaps = careGapsResult.result;

    // Get unmet care gaps for analysis
    const unmetCareGaps = careGaps.filter((g) => g.status === "unmet");

    // Build cost estimates from patient medications (simplified)
    const costEstimates = estimateMedicationCosts(patient);

    // REQUIRED: Use real LLM for analysis - no fallback
    // Check if any LLM API key is configured (supports multiple providers)
    const hasLLMKey = process.env.GEMINI_API_KEY ||
                      process.env.OPENAI_API_KEY ||
                      process.env.ANTHROPIC_API_KEY ||
                      process.env.HF_API_KEY;
    if (!hasLLMKey) {
      return NextResponse.json(
        { error: "No LLM API key configured. Set GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or HF_API_KEY." },
        { status: 500 }
      );
    }

    // Run LLM analysis (uses the active model via LLMProvider)
    const analysis = await analyzeDischargeReadiness(
      patient,
      drugInteractions,
      unmetCareGaps.map((g) => ({
        guideline: g.guideline,
        recommendation: g.recommendation,
        grade: g.grade,
        status: g.status,
      })),
      costEstimates
    );

    // Include model info in response
    return NextResponse.json({
      ...analysis,
      modelUsed: getActiveModelId(),
      agentUsed: false,
    });
  } catch (error) {
    console.error("Analysis error:", error);

    // Check if this is a rate limit or usage limit error
    // Return a special response so frontend can prompt user to switch models
    if (isModelLimitError(error)) {
      const availableModels = getAvailableModels();
      const otherModels = availableModels.filter((m) => m !== error.modelId);

      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          modelId: error.modelId,
          provider: error.provider,
          suggestModelSwitch: true,
          availableModels: otherModels,
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

/**
 * Fallback function to get known drug interactions when FDA API fails
 */
function getKnownInteractionsForPatient(patient: Patient): DrugInteraction[] {
  const interactions: DrugInteraction[] = [];
  const medNames = patient.medications.map((m) => m.name.toLowerCase());

  // Check for warfarin + aspirin
  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("aspirin"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Aspirin",
      severity: "major",
      description: "Concurrent use increases bleeding risk significantly. Monitor INR closely and watch for signs of bleeding.",
      source: "Clinical Guidelines",
    });
  }

  // Check for warfarin + eliquis (dual anticoagulation)
  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("eliquis"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Eliquis (Apixaban)",
      severity: "major",
      description: "Dual anticoagulation therapy significantly increases bleeding risk. Generally contraindicated unless specific clinical indication.",
      source: "Clinical Guidelines",
    });
  }

  // Check for ACE inhibitor + potassium
  if ((medNames.some((m) => m.includes("lisinopril")) || medNames.some((m) => m.includes("enalapril"))) &&
      medNames.some((m) => m.includes("potassium"))) {
    interactions.push({
      drug1: "ACE Inhibitor",
      drug2: "Potassium Chloride",
      severity: "moderate",
      description: "ACE inhibitors can increase potassium levels. Combined with potassium supplements, risk of hyperkalemia increases.",
      source: "Clinical Guidelines",
    });
  }

  // Check for digoxin presence (common interaction concerns)
  if (medNames.some((m) => m.includes("digoxin"))) {
    if (medNames.some((m) => m.includes("furosemide"))) {
      interactions.push({
        drug1: "Digoxin",
        drug2: "Furosemide",
        severity: "moderate",
        description: "Loop diuretics can cause hypokalemia, increasing digoxin toxicity risk. Monitor potassium levels.",
        source: "Clinical Guidelines",
      });
    }
  }

  return interactions;
}

/**
 * Estimate medication costs (simplified - would use real CMS pricing API in production)
 */
function estimateMedicationCosts(patient: Patient): Array<{ medication: string; monthlyOOP: number; covered: boolean }> {
  const highCostMeds = [
    { pattern: "eliquis", cost: 500 },
    { pattern: "xarelto", cost: 450 },
    { pattern: "entresto", cost: 550 },
    { pattern: "jardiance", cost: 450 },
    { pattern: "ozempic", cost: 900 },
    { pattern: "humira", cost: 1200 },
    { pattern: "spiriva", cost: 350 },
  ];

  return patient.medications.map((med) => {
    const medNameLower = med.name.toLowerCase();
    const highCost = highCostMeds.find((hc) => medNameLower.includes(hc.pattern));

    if (highCost) {
      return {
        medication: med.name,
        monthlyOOP: highCost.cost,
        covered: false,
      };
    }

    // Default: assume generic/low cost
    return {
      medication: med.name,
      monthlyOOP: 10,
      covered: true,
    };
  });
}

