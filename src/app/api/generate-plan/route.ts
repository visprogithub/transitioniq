/**
 * Discharge Plan Generator API - ReAct-based Agentic Plan Creation
 *
 * This endpoint uses a ReAct agent to generate comprehensive discharge plans by:
 * - Researching patient-specific guidelines and recommendations
 * - Looking up medication instructions and warnings
 * - Checking for condition-specific follow-up requirements
 * - Synthesizing everything into a personalized discharge plan
 *
 * NOT just a single LLM call - the agent reasons about what information
 * it needs and gathers it before generating the final plan.
 */

import { NextRequest, NextResponse } from "next/server";
import { getPatient } from "@/lib/data/demo-patients";
import { setActiveModel, resetLLMProvider, getActiveModelId } from "@/lib/integrations/llm-provider";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { getOpikClient, traceError } from "@/lib/integrations/opik";
import {
  runReActLoop,
  runReActLoopStreaming,
  createReActSSEStream,
  createReActTool,
  type ReActTool,
} from "@/lib/agents/react-loop";
import { getPatientDrugInfo, checkMultipleDrugInteractions, searchKnowledgeBase } from "@/lib/knowledge-base";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import type { Patient } from "@/lib/types/patient";

/**
 * Build the system prompt for the discharge plan generator agent
 */
function buildPlanGeneratorSystemPrompt(patient: Patient, analysis: DischargeAnalysis): string {
  return `You are a clinical discharge planning specialist creating a comprehensive discharge plan for ${patient.name}.

## Your Goal
Create a thorough, personalized discharge planning checklist that addresses all identified risks and ensures safe transition from hospital to home.

## Patient Summary
- Name: ${patient.name}
- Age: ${patient.age} years old
- Discharge Readiness Score: ${analysis.score}/100
- Status: ${analysis.status.toUpperCase().replace("_", " ")}
- Medications: ${patient.medications.length} total
- Key Conditions: ${patient.diagnoses.map((d) => d.display).join(", ")}

## Risk Factors to Address
${analysis.riskFactors.map((rf) => `- [${rf.severity.toUpperCase()}] ${rf.title}: ${rf.description}`).join("\n")}

## Your Process
1. First, gather specific information about the patient's medications and conditions
2. Look up any relevant clinical guidelines for their specific situation
3. Check for drug-specific instructions that should be included
4. Generate a comprehensive, actionable discharge plan

## Plan Requirements
Your final plan MUST include these sections:
1. HIGH PRIORITY items that must be addressed before discharge
2. MEDICATION instructions with specific timing and warnings
3. FOLLOW-UP appointments with timeframes
4. WARNING SIGNS that require immediate medical attention
5. ACTIVITY RESTRICTIONS specific to their conditions
6. DIETARY guidelines if applicable

## OUTPUT FORMAT - CRITICAL
Your final_answer MUST be a MARKDOWN CHECKLIST, not JSON. Use this exact format with **bold** for medication names, dosages, key terms, warning signs, and important details:

**High Priority - Must Complete Before Discharge**
- [ ] Schedule **follow-up appointment** with **cardiologist within 7 days**
- [ ] Confirm patient can identify **warning signs** that require **immediate care**

**Medication Instructions**
- [ ] **Furosemide 80mg**: Take in the **morning**. Watch for **low potassium** symptoms (weakness, irregular heartbeat).
- [ ] **Lisinopril 10mg**: Take in the **morning**. May cause **dry cough** - report if persistent.

**Follow-Up Appointments**
- [ ] **Cardiology** appointment within **7 days** - call **555-0100** to schedule
- [ ] **Primary care** visit within **14 days** for medication review

**Warning Signs - Seek Immediate Care If**
- [ ] **Shortness of breath** or **chest pain**
- [ ] **Sudden weight gain** of **2-3 lbs in one day** or **5 lbs in a week**

**Activity Restrictions**
- [ ] Limit to **light activity** for first **week** - no **heavy lifting over 10 lbs**

**Dietary Guidelines**
- [ ] **Low sodium diet** (under **2000mg/day**) - avoid **processed foods**, **canned soups**, **deli meats**

IMPORTANT:
- Output ONLY the markdown checklist. NO JSON.
- Each section uses **Bold Headers** and - [ ] checkbox items
- Use **bold** throughout for medication names, dosages, timeframes, warning signs, and key terms
- Be specific and actionable in every item`;
}

/**
 * Create ReAct tools for discharge plan generation
 */
function createPlanGeneratorTools(patient: Patient, analysis: DischargeAnalysis): ReActTool[] {
  return [
    createReActTool(
      "lookup_medication_instructions",
      "Get detailed patient instructions for a specific medication including timing, food interactions, and warnings. Use this for each important medication in the patient's list.",
      {
        type: "object",
        properties: {
          medicationName: {
            type: "string",
            description: "The name of the medication to look up",
          },
        },
        required: ["medicationName"],
      },
      async (args) => {
        const medName = String(args.medicationName).toLowerCase();
        const info = getPatientDrugInfo(medName);
        if (info) {
          return {
            medication: medName,
            purpose: info.purpose,
            patientTips: info.patientTips,
            warnings: info.warnings,
            sideEffects: info.sideEffects,
          };
        }
        return {
          medication: medName,
          purpose: "Prescribed by your doctor for your condition",
          patientTips: ["Take as directed", "Do not stop without consulting your doctor"],
          warnings: [],
        };
      }
    ),

    createReActTool(
      "check_drug_interactions_for_plan",
      "Check for drug interactions that should be mentioned in discharge instructions. Returns specific warnings to include.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        const medNames = patient.medications.map((m) => m.name);
        const interactions = checkMultipleDrugInteractions(medNames);

        if (interactions.length === 0) {
          return { interactions: [], message: "No significant drug interactions to note." };
        }

        return {
          interactions: interactions.map((i) => ({
            drugs: `${i.drug1.genericName} + ${i.drug2.genericName}`,
            severity: i.severity,
            warning: i.patientCounseling || i.clinicalEffect,
          })),
        };
      }
    ),

    createReActTool(
      "get_condition_guidelines",
      "Get clinical guidelines and recommendations for a specific condition. Use this to ensure the discharge plan follows best practices.",
      {
        type: "object",
        properties: {
          condition: {
            type: "string",
            description: "The condition to look up guidelines for (e.g., 'heart failure', 'diabetes', 'atrial fibrillation')",
          },
        },
        required: ["condition"],
      },
      async (args) => {
        const condition = String(args.condition);
        // Search knowledge base for relevant guidelines
        const results = searchKnowledgeBase(`${condition} discharge guidelines follow-up care`, { topK: 3 });

        if (results.length > 0) {
          return {
            condition,
            guidelines: results.map((r) => ({
              source: r.document.metadata?.source || "Clinical Guidelines",
              content: r.document.content.slice(0, 500),
            })),
          };
        }

        // Return condition-specific defaults
        const conditionGuidelines: Record<string, object> = {
          "heart failure": {
            followUp: "Cardiology within 7 days",
            monitoring: "Daily weights, watch for >2-3 lb gain",
            diet: "Low sodium (<2000mg/day)",
            activity: "Gradual increase, avoid overexertion",
          },
          diabetes: {
            followUp: "PCP or endocrinology within 1-2 weeks",
            monitoring: "Blood glucose per schedule",
            diet: "Consistent carbohydrate intake",
            activity: "Regular activity as tolerated",
          },
          "atrial fibrillation": {
            followUp: "Cardiology within 2 weeks",
            monitoring: "Heart rate, symptoms of stroke",
            anticoagulation: "Strict adherence to blood thinner schedule",
            activity: "Avoid strenuous activity initially",
          },
        };

        const key = Object.keys(conditionGuidelines).find((k) =>
          condition.toLowerCase().includes(k)
        );

        if (key) {
          return { condition, guidelines: conditionGuidelines[key] };
        }

        return {
          condition,
          guidelines: {
            followUp: "PCP within 7-14 days",
            general: "Follow discharge instructions carefully",
          },
        };
      }
    ),

    createReActTool(
      "get_risk_factor_resolutions",
      "Get detailed resolution steps for identified risk factors. Use this to ensure each risk factor has actionable steps in the plan.",
      {
        type: "object",
        properties: {
          riskFactorTitle: {
            type: "string",
            description: "The title of the risk factor to get resolution steps for",
          },
        },
        required: ["riskFactorTitle"],
      },
      async (args) => {
        const title = String(args.riskFactorTitle).toLowerCase();
        const rf = analysis.riskFactors.find((r) =>
          r.title.toLowerCase().includes(title) || title.includes(r.title.toLowerCase())
        );

        if (rf) {
          return {
            riskFactor: rf.title,
            severity: rf.severity,
            description: rf.description,
            resolution: rf.resolution || "Discuss with healthcare team before discharge",
            category: rf.category,
          };
        }

        return {
          riskFactor: args.riskFactorTitle,
          resolution: "Consult with healthcare team for specific guidance",
        };
      }
    ),

    createReActTool(
      "get_medication_schedule",
      "Generate a structured medication schedule for the patient showing what to take and when.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        const schedule: Record<string, string[]> = {
          morning: [],
          noon: [],
          evening: [],
          bedtime: [],
          asNeeded: [],
        };

        for (const med of patient.medications) {
          const freq = med.frequency.toLowerCase();
          const entry = `${med.name} ${med.dose}`;

          if (freq.includes("daily") || freq.includes("once")) {
            if (freq.includes("morning") || freq.includes("am")) {
              schedule.morning.push(entry);
            } else if (freq.includes("evening") || freq.includes("pm") || freq.includes("night")) {
              schedule.evening.push(entry);
            } else if (freq.includes("bedtime")) {
              schedule.bedtime.push(entry);
            } else {
              schedule.morning.push(entry); // Default daily to morning
            }
          } else if (freq.includes("twice") || freq.includes("bid") || freq.includes("2x")) {
            schedule.morning.push(entry);
            schedule.evening.push(entry);
          } else if (freq.includes("three") || freq.includes("tid") || freq.includes("3x")) {
            schedule.morning.push(entry);
            schedule.noon.push(entry);
            schedule.evening.push(entry);
          } else if (freq.includes("prn") || freq.includes("as needed")) {
            schedule.asNeeded.push(`${entry} - ${med.frequency}`);
          } else {
            schedule.morning.push(entry); // Default
          }
        }

        return {
          totalMedications: patient.medications.length,
          schedule,
        };
      }
    ),
  ];
}

/**
 * Generate discharge plan endpoint
 * Supports both streaming (SSE) and non-streaming modes
 *
 * Query params:
 * - stream=true: Return SSE stream showing reasoning in real-time
 */
export async function POST(request: NextRequest) {
  // Rate limit
  const blocked = applyRateLimit(request, "generate");
  if (blocked) return blocked;

  // Check if streaming is requested
  const useStreaming = request.nextUrl.searchParams.get("stream") === "true";

  const opik = getOpikClient();
  const trace = opik?.trace({
    name: useStreaming ? "discharge-plan-react-streaming" : "discharge-plan-react",
    metadata: {
      model: getActiveModelId(),
      agentic: true,
      react: true,
      streaming: useStreaming,
    },
  });

  try {
    const body = await request.json();
    const { patientId, analysis, modelId } = body as {
      patientId: string;
      analysis: DischargeAnalysis;
      modelId?: string;
    };

    // Pin the model for this request if explicitly provided
    if (modelId) {
      try {
        setActiveModel(modelId);
        resetLLMProvider();
      } catch (e) {
        console.warn(`[Generate-Plan] Failed to set model ${modelId}:`, e);
      }
    }

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

    trace?.update({
      threadId: `plan-${patientId}`,
      metadata: {
        patientId,
        analysisScore: analysis.score,
        analysisStatus: analysis.status,
        medicationCount: patient.medications.length,
        riskFactorCount: analysis.riskFactors.length,
      },
    });

    // Create ReAct tools for plan generation
    const tools = createPlanGeneratorTools(patient, analysis);

    // Build the user message
    const userMessage = `Please generate a comprehensive discharge plan for this patient.

The plan should be thorough and address all ${analysis.riskFactors.length} identified risk factors (${analysis.riskFactors.filter((r) => r.severity === "high").length} high-risk).

Make sure to:
1. Look up medication instructions for key medications
2. Check for any drug interactions to warn about
3. Get condition-specific guidelines for their diagnoses
4. Create a medication schedule
5. Address each high and moderate risk factor with specific actions

Generate the final plan as a clear, formatted checklist that clinical staff and the patient can use.`;

    const reactOptions = {
      systemPrompt: buildPlanGeneratorSystemPrompt(patient, analysis),
      tools,
      maxIterations: 15,
      threadId: `plan-${patientId}`,
      metadata: {
        patientId,
        purpose: "discharge-plan-generation",
        streaming: useStreaming,
      },
    };

    // If streaming requested, return SSE stream
    if (useStreaming) {
      const generator = runReActLoopStreaming(userMessage, reactOptions);
      const stream = createReActSSEStream(generator);

      trace?.update({
        output: { streaming: true },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Patient-Id": patientId,
        },
      });
    }

    // Non-streaming path: Run the ReAct loop and return JSON
    const reactResult = await runReActLoop(userMessage, reactOptions);

    trace?.update({
      output: {
        planLength: reactResult.answer.length,
        iterations: reactResult.iterations,
        toolsUsed: reactResult.toolsUsed,
      },
    });
    trace?.end();

    return NextResponse.json({
      plan: reactResult.answer,
      reactTrace: {
        iterations: reactResult.iterations,
        toolsUsed: reactResult.toolsUsed,
        reasoningTrace: reactResult.reasoningTrace,
      },
      metadata: reactResult.metadata,
    });
  } catch (error) {
    console.error("Plan generation error:", error);

    // Set errorInfo on the route-level trace so Opik dashboard counts this error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorInfo = {
      exceptionType: error instanceof Error ? error.name : "Error",
      message: errorMessage,
      traceback: error instanceof Error ? (error.stack ?? errorMessage) : errorMessage,
    };
    trace?.update({
      errorInfo,
      output: { error: errorMessage },
    });
    trace?.end();

    await traceError("api-generate-plan", error);
    trace?.end();

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Plan generation failed" },
      { status: 500 }
    );
  }
}
