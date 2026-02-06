import { NextRequest, NextResponse } from "next/server";
import { createLLMProvider } from "@/lib/integrations/llm-provider";
import { getOpikClient, traceError, flushTraces } from "@/lib/integrations/opik";
import { applyInputGuardrails, applyOutputGuardrails } from "@/lib/guardrails";
import { getPatientSummaryPrompt, formatPatientSummaryPrompt } from "@/lib/integrations/opik-prompts";
import { getPatient } from "@/lib/data/demo-patients";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import { extractJsonObject } from "@/lib/utils/llm-json";

interface PatientSummaryRequest {
  patientId: string;
  analysis: DischargeAnalysis;
}

interface PatientSummary {
  readinessLevel: "good" | "caution" | "needs_attention";
  readinessMessage: string;
  whatYouNeedToKnow: Array<{
    title: string;
    description: string;
    icon: "pill" | "heart" | "calendar" | "alert";
  }>;
  medicationReminders: Array<{
    medication: string;
    instruction: string;
    important?: boolean;
  }>;
  questionsForDoctor: string[];
  nextSteps: Array<{
    task: string;
    completed: boolean;
    priority: "high" | "medium" | "low";
  }>;
}

// Prompt is now fetched from Opik Prompt Library via getPatientSummaryPrompt()
// This enables version control and A/B testing of prompts

export async function POST(request: NextRequest) {
  const opik = getOpikClient();
  const trace = opik?.trace({
    name: "patient-summary-generation",
    metadata: { category: "patient-education" },
  });

  try {
    const body: PatientSummaryRequest = await request.json();
    const { patientId, analysis } = body;

    // Get patient data
    const patient = getPatient(patientId);
    if (!patient) {
      trace?.update({ output: { error: "Patient not found" } });
      trace?.end();
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Format risk factors for prompt
    const riskFactorsText = analysis.riskFactors
      .map((rf) => `- [${rf.severity.toUpperCase()}] ${rf.title}: ${rf.description}`)
      .join("\n");

    // Format medications for prompt
    const medicationsText = patient.medications
      .map((med) => `- ${med.name} ${med.dose} (${med.frequency})`)
      .join("\n");

    // Get versioned prompt from Opik Prompt Library
    const promptData = await getPatientSummaryPrompt();

    // Build prompt using versioned template
    const prompt = formatPatientSummaryPrompt(promptData.template, {
      patientName: patient.name,
      patientAge: patient.age,
      score: analysis.score,
      status: analysis.status,
      riskFactors: riskFactorsText || "None identified",
      medications: medicationsText || "None listed",
    });

    // Generate with LLM
    const llmSpan = trace?.span({
      name: "llm-patient-education",
      metadata: {
        purpose: "patient-summary",
        prompt_version: promptData.commit || "local",
        prompt_from_opik: promptData.fromOpik,
      },
    });

    const startTime = Date.now();
    const provider = createLLMProvider();
    const fullPrompt = `You are a patient communication specialist who converts medical information into simple, friendly language.\n\n${prompt}`;

    // Apply input guardrails before sending to LLM
    const inputGuardrail = applyInputGuardrails(fullPrompt, {
      sanitizePII: true,
      usePlaceholders: true,
      blockCriticalPII: true,
      logToOpik: true,
      traceName: "guardrail-patient-summary-input",
    });

    if (inputGuardrail.wasBlocked) {
      trace?.update({ output: { blocked: true, reason: "critical_pii" } });
      trace?.end();
      return NextResponse.json({ error: "Request blocked: critical PII detected" }, { status: 400 });
    }

    const sanitizedPrompt = inputGuardrail.wasSanitized ? inputGuardrail.output : fullPrompt;

    const response = await provider.generate(sanitizedPrompt, {
      spanName: "patient-summary-generation",
      metadata: { purpose: "patient-summary", pii_sanitized: inputGuardrail.wasSanitized },
    });

    // Apply output guardrails to catch any leaked PII
    const outputGuardrail = applyOutputGuardrails(response.content, {
      sanitizePII: true,
      usePlaceholders: true,
      logToOpik: true,
      traceName: "guardrail-patient-summary-output",
    });
    const sanitizedContent = outputGuardrail.output;

    const latencyMs = Date.now() - startTime;

    llmSpan?.update({
      output: { summary: response.content.slice(0, 500) },
      metadata: { latency_ms: latencyMs },
    });
    llmSpan?.end();

    // Parse the response (handles Qwen3 thinking tokens, trailing commas, etc.)
    let summary: PatientSummary;
    try {
      summary = extractJsonObject<PatientSummary>(sanitizedContent);
    } catch (parseError) {
      traceError("api-patient-summary-parse", parseError);
      // Generate fallback summary
      summary = generateFallbackSummary(patient, analysis);
    }

    // Validate and sanitize
    summary = sanitizeSummary(summary, patient, analysis);

    trace?.update({
      output: {
        readinessLevel: summary.readinessLevel,
        itemCounts: {
          needToKnow: summary.whatYouNeedToKnow.length,
          medications: summary.medicationReminders.length,
          questions: summary.questionsForDoctor.length,
          steps: summary.nextSteps.length,
        },
      },
    });
    trace?.end();
    await flushTraces();

    return NextResponse.json({
      summary,
      patientId,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    await traceError("api-patient-summary", error);
    trace?.update({ metadata: { error: String(error) } });
    trace?.end();

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate patient summary" },
      { status: 500 }
    );
  }
}

function generateFallbackSummary(
  patient: { name: string; age: number; medications: Array<{ name: string; dose: string; frequency: string }> },
  analysis: DischargeAnalysis
): PatientSummary {
  const highRisks = analysis.riskFactors.filter((rf) => rf.severity === "high");

  let readinessLevel: "good" | "caution" | "needs_attention";
  let readinessMessage: string;

  if (analysis.score >= 70) {
    readinessLevel = "good";
    readinessMessage = "You're doing great! Just a few things to remember before heading home.";
  } else if (analysis.score >= 40) {
    readinessLevel = "caution";
    readinessMessage = "You're making progress. Let's make sure we cover everything before you go.";
  } else {
    readinessLevel = "needs_attention";
    readinessMessage = "We want to make sure you're ready. Let's go over some important things together.";
  }

  return {
    readinessLevel,
    readinessMessage,
    whatYouNeedToKnow: highRisks.slice(0, 3).map((rf) => ({
      title: rf.title.replace(/Drug Interaction/gi, "Medicine Alert"),
      description: rf.description.slice(0, 150),
      icon: "alert" as const,
    })),
    medicationReminders: patient.medications.map((med) => ({
      medication: med.name,
      instruction: `Take ${med.dose} ${med.frequency}`,
      important: ["warfarin", "insulin", "eliquis", "metformin"].some((name) =>
        med.name.toLowerCase().includes(name)
      ),
    })),
    questionsForDoctor: [
      "When is my follow-up appointment?",
      "What warning signs should I watch for?",
      "Who should I call if I have questions?",
    ],
    nextSteps: [
      { task: "Review discharge papers with nurse", completed: false, priority: "high" },
      { task: "Get all your medications", completed: false, priority: "high" },
      { task: "Schedule follow-up appointment", completed: false, priority: "high" },
      { task: "Arrange ride home", completed: false, priority: "medium" },
    ],
  };
}

function sanitizeSummary(
  summary: PatientSummary,
  patient: { name: string; medications: Array<{ name: string; dose: string; frequency: string }> },
  analysis: DischargeAnalysis
): PatientSummary {
  // Ensure readinessLevel matches score
  if (analysis.score >= 70 && summary.readinessLevel !== "good") {
    summary.readinessLevel = "good";
  } else if (analysis.score >= 40 && analysis.score < 70 && summary.readinessLevel !== "caution") {
    summary.readinessLevel = "caution";
  } else if (analysis.score < 40 && summary.readinessLevel !== "needs_attention") {
    summary.readinessLevel = "needs_attention";
  }

  // Ensure arrays exist and have reasonable lengths
  summary.whatYouNeedToKnow = (summary.whatYouNeedToKnow || []).slice(0, 4);
  summary.questionsForDoctor = (summary.questionsForDoctor || []).slice(0, 5);
  summary.nextSteps = (summary.nextSteps || []).slice(0, 6);
  
  // Backfill any medications the LLM missed — every patient medication must appear
  const llmMedNames = new Set(
    (summary.medicationReminders || []).map((m) => m.medication.toLowerCase())
  );
  const importantDrugs = ["warfarin", "insulin", "eliquis", "metformin", "digoxin", "lithium"];
  for (const med of patient.medications) {
    if (!llmMedNames.has(med.name.toLowerCase())) {
      summary.medicationReminders.push({
        medication: med.name,
        instruction: `Take ${med.dose} ${med.frequency}`,
        important: importantDrugs.some((d) => med.name.toLowerCase().includes(d)),
      });
    }
  }
  summary.medicationReminders = summary.medicationReminders.slice(0, 20);

  // Ensure all nextSteps have completed: false
  summary.nextSteps = summary.nextSteps.map((step) => ({
    ...step,
    completed: false,
  }));

  return summary;
}