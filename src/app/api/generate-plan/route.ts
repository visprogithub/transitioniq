import { NextRequest, NextResponse } from "next/server";
import { getPatient } from "@/lib/data/demo-patients";
import { generateDischargePlan } from "@/lib/integrations/analysis";
import { getOpikClient, traceAnalysis, traceError, flushTraces } from "@/lib/integrations/opik";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { pinModelForRequest, logErrorTrace } from "@/lib/utils/api-helpers";
import type { DischargeAnalysis } from "@/lib/types/analysis";

export async function POST(request: NextRequest) {
  // Rate limit: plan generation (single LLM call)
  const blocked = applyRateLimit(request, "generate");
  if (blocked) return blocked;

  const opik = getOpikClient();
  const trace = opik?.trace({
    name: "generate-discharge-plan",
    metadata: {
      category: "plan_generation",
    },
  });

  try {
    const body = await request.json();
    const { patientId, analysis, modelId } = body as { patientId: string; analysis: DischargeAnalysis; modelId?: string };

    // Pin the model for this request if explicitly provided
    pinModelForRequest(modelId, "Generate-Plan");

    if (!patientId) {
      return NextResponse.json({ error: "patientId required" }, { status: 400 });
    }

    if (!analysis) {
      return NextResponse.json({ error: "analysis required" }, { status: 400 });
    }

    const patient = getPatient(patientId);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Try Gemini if API key is available, fall back to computed plan
    if (process.env.GEMINI_API_KEY) {
      try {
        // Generate plan with Gemini and Opik tracing
        const planResult = await traceAnalysis("generate-plan", { patientId, category: "plan_generation" }, async () => {
          return await generateDischargePlan(patient, analysis);
        });

        trace?.update({ output: { success: true, source: "gemini" } });
        trace?.end();
        await flushTraces();

        return NextResponse.json({
          plan: planResult.result,
          tracingId: planResult.traceId,
        });
      } catch (geminiError) {
        await traceError("api-generate-plan-llm", geminiError, { patientId });
        // Fall through to computed plan
      }
    }

    // Generate a structured plan without LLM (fallback)
    const plan = generatePlanWithoutLLM(patient.name, analysis);

    trace?.update({ output: { success: true, source: "fallback" } });
    trace?.end();
    await flushTraces();

    return NextResponse.json({ plan });
  } catch (error) {
    // Log error to Opik trace
    logErrorTrace(trace, error);
    await traceError("api-generate-plan", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Plan generation failed" },
      { status: 500 }
    );
  }
}

/**
 * Generate a discharge plan without LLM (fallback)
 */
function generatePlanWithoutLLM(patientName: string, analysis: DischargeAnalysis): string {
  const highRisks = analysis.riskFactors.filter((rf) => rf.severity === "high");
  const moderateRisks = analysis.riskFactors.filter((rf) => rf.severity === "moderate");

  const lines: string[] = [
    `TRANSITION PLANNING CHECKLIST`,
    `Patient: ${patientName}`,
    `Transition Readiness Score: ${analysis.score}/100`,
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "═══════════════════════════════════════════════════════",
    "",
  ];

  // High Priority Items
  if (highRisks.length > 0) {
    lines.push("🔴 HIGH PRIORITY - MUST ADDRESS BEFORE TRANSITION");
    lines.push("-".repeat(50));
    highRisks.forEach((rf, i) => {
      lines.push(`${i + 1}. ${rf.title}`);
      lines.push(`   Issue: ${rf.description}`);
      if (rf.resolution) {
        lines.push(`   Action: ${rf.resolution}`);
      }
      lines.push("");
    });
  }

  // Moderate Priority Items
  if (moderateRisks.length > 0) {
    lines.push("🟡 MODERATE PRIORITY - SHOULD ADDRESS");
    lines.push("-".repeat(50));
    moderateRisks.forEach((rf, i) => {
      lines.push(`${i + 1}. ${rf.title}`);
      lines.push(`   Issue: ${rf.description}`);
      if (rf.resolution) {
        lines.push(`   Action: ${rf.resolution}`);
      }
      lines.push("");
    });
  }

  // Standard Discharge Tasks
  lines.push("📋 STANDARD DISCHARGE TASKS");
  lines.push("-".repeat(50));
  lines.push("□ Medication reconciliation completed");
  lines.push("□ Discharge prescriptions sent to pharmacy");
  lines.push("□ Patient education provided and documented");
  lines.push("□ Follow-up appointment scheduled (7-14 days)");
  lines.push("□ Emergency contact information provided");
  lines.push("□ Written discharge instructions given");
  lines.push("");

  // Follow-up Appointments
  lines.push("📅 RECOMMENDED FOLLOW-UP");
  lines.push("-".repeat(50));
  lines.push("□ Primary Care Provider: Within 7 days");

  const drugInteractions = analysis.riskFactors.filter((rf) => rf.category === "drug_interaction");
  if (drugInteractions.length > 0) {
    lines.push("□ Pharmacy consult: Before transition");
  }

  const careGaps = analysis.riskFactors.filter((rf) => rf.category === "care_gap");
  if (careGaps.some((g) => g.title.toLowerCase().includes("heart"))) {
    lines.push("□ Cardiology: Within 14 days");
  }
  if (careGaps.some((g) => g.title.toLowerCase().includes("diabetes"))) {
    lines.push("□ Endocrinology/Diabetes educator: Within 14 days");
  }

  lines.push("");

  // Warning Signs
  lines.push("⚠️ RETURN PRECAUTIONS - Seek care immediately if:");
  lines.push("-".repeat(50));
  lines.push("• Chest pain or shortness of breath");
  lines.push("• Signs of bleeding (if on anticoagulation)");
  lines.push("• Fever > 101°F (38.3°C)");
  lines.push("• Worsening symptoms");
  lines.push("• Confusion or altered mental status");
  lines.push("");

  // Recommendations from analysis
  if (analysis.recommendations.length > 0) {
    lines.push("💡 ADDITIONAL RECOMMENDATIONS");
    lines.push("-".repeat(50));
    analysis.recommendations.forEach((rec, i) => {
      lines.push(`${i + 1}. ${rec}`);
    });
  }

  return lines.join("\n");
}
