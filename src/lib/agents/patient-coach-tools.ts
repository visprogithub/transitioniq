/**
 * Patient Coach Tools - Agentic tools for the patient-facing recovery coach
 *
 * These tools enable multi-turn reasoning for patient questions about their discharge.
 * Each tool call is traced in Opik for observability.
 *
 * Data Sources (in priority order):
 * 1. Local Knowledge Base - Serverless-compatible, FDB-style clinical data
 * 2. External APIs - FDA DailyMed, MedlinePlus, MeSH
 * 3. LLM Fallback - For unknown items not in knowledge base or APIs
 */

import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";
import { createLLMProvider } from "@/lib/integrations/llm-provider";
import { traceError } from "@/lib/integrations/opik";
import { applyInputGuardrails, applyOutputGuardrails } from "@/lib/guardrails";
import { executeWithFallback, type ToolCallResult, type FallbackStrategy } from "@/lib/utils/tool-helpers";

// Import knowledge base modules
import {
  getDrugMonograph,
  getPatientDrugInfo,
  checkMultipleDrugInteractions,
  getPatientFriendlyInteraction,
  getSymptomTriage,
  assessSymptomUrgency,
  getMedicalTermDefinition,
  getPatientFriendlyExplanation,
} from "@/lib/knowledge-base";

// Import external API clients
import { getPatientFriendlyDrugInfo as getDailyMedDrugInfo } from "@/lib/integrations/dailymed-client";
import { getPatientSymptomAssessment } from "@/lib/integrations/medlineplus-client";
import { extractJsonObject } from "@/lib/utils/llm-json";

export interface PatientCoachToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required: string[];
  };
}

// ToolCallResult now imported from @/lib/utils/tool-helpers

/**
 * Tool definitions for the patient coach agent
 * These are passed to the LLM for function calling
 */
export const PATIENT_COACH_TOOLS: PatientCoachToolDefinition[] = [
  {
    name: "lookupMedication",
    description:
      "Get patient-friendly information about a medication including what it does, common side effects, and important warnings. Use this when a patient asks about any of their medications.",
    parameters: {
      type: "object",
      properties: {
        medicationName: {
          type: "string",
          description: "The name of the medication to look up",
        },
      },
      required: ["medicationName"],
    },
  },
  {
    name: "checkSymptom",
    description:
      "Check if a symptom the patient is experiencing requires immediate attention, a call to their doctor, or is likely normal. Use this when a patient describes any symptoms or asks what to do if they experience something.",
    parameters: {
      type: "object",
      properties: {
        symptom: {
          type: "string",
          description: "The symptom the patient is experiencing or asking about",
        },
        severity: {
          type: "string",
          enum: ["mild", "moderate", "severe"],
          description: "How severe the symptom appears to be",
        },
      },
      required: ["symptom"],
    },
  },
  {
    name: "explainMedicalTerm",
    description:
      "Explain a medical term or concept in simple, everyday language. Use this when the patient asks about any medical jargon or doesn't understand something from their discharge paperwork.",
    parameters: {
      type: "object",
      properties: {
        term: {
          type: "string",
          description: "The medical term or concept to explain",
        },
      },
      required: ["term"],
    },
  },
  {
    name: "getFollowUpGuidance",
    description:
      "Get information about follow-up appointments and when the patient should see their doctor. Use this when patients ask about scheduling, when to return, or follow-up care.",
    parameters: {
      type: "object",
      properties: {
        appointmentType: {
          type: "string",
          enum: ["primary_care", "specialist", "lab_work", "imaging", "general"],
          description: "The type of follow-up appointment",
        },
      },
      required: ["appointmentType"],
    },
  },
  {
    name: "getDietaryGuidance",
    description:
      "Get dietary recommendations based on the patient's conditions and medications. Use this when patients ask about what they can eat, dietary restrictions, or nutrition.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "The specific dietary topic (e.g., 'sodium', 'sugar', 'warfarin foods', 'protein')",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "getActivityGuidance",
    description:
      "Get guidance on physical activity and restrictions after discharge. Use this when patients ask about exercise, lifting, driving, or returning to normal activities.",
    parameters: {
      type: "object",
      properties: {
        activity: {
          type: "string",
          description: "The activity the patient is asking about",
        },
      },
      required: ["activity"],
    },
  },
];

// Note: Medication knowledge is now in @/lib/knowledge-base/drug-monographs.ts
// with fallback to FDA DailyMed API and LLM for unknown medications

// Note: Symptom triage data is now in @/lib/knowledge-base/symptom-triage.ts
// with fallback to MedlinePlus API and LLM for unknown symptoms

// Note: Medical terminology is now in @/lib/knowledge-base/medical-terminology.ts
// with LLM fallback for unknown terms

/**
 * Execute a patient coach tool
 */
export async function executePatientCoachTool(
  toolName: string,
  parameters: Record<string, unknown>,
  patient: Patient,
  analysis: DischargeAnalysis | null
): Promise<ToolCallResult> {
  try {
    switch (toolName) {
      case "lookupMedication":
        return await executeLookupMedication(
          parameters.medicationName as string,
          patient
        );

      case "checkSymptom":
        return await executeCheckSymptom(
          parameters.symptom as string,
          (parameters.severity as string) || "moderate",
          patient,
          analysis
        );

      case "explainMedicalTerm":
        return await executeExplainMedicalTerm(parameters.term as string);

      case "getFollowUpGuidance":
        return await executeGetFollowUpGuidance(
          parameters.appointmentType as string,
          patient,
          analysis
        );

      case "getDietaryGuidance":
        return await executeGetDietaryGuidance(
          parameters.topic as string,
          patient
        );

      case "getActivityGuidance":
        return await executeGetActivityGuidance(
          parameters.activity as string,
          patient,
          analysis
        );

      default:
        return {
          toolName,
          result: null,
          success: false,
          error: `Unknown tool: ${toolName}`,
        };
    }
  } catch (error) {
    return {
      toolName,
      result: null,
      success: false,
      error: error instanceof Error ? error.message : "Tool execution failed",
    };
  }
}

/**
 * Look up medication information (REFACTORED with executeWithFallback)
 * Priority order:
 * 1. Local knowledge base (FDB-style, fast, always available)
 * 2. FDA DailyMed API (real drug labels)
 * 3. LLM fallback (for unknown medications)
 */
async function executeLookupMedication(
  medicationName: string,
  patient: Patient
): Promise<ToolCallResult> {
  const normalizedName = medicationName.toLowerCase().trim();

  // Check if patient is actually taking this medication
  const patientMed = patient.medications.find(
    (m) =>
      m.name.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(m.name.toLowerCase())
  );

  // Helper to build medication result
  const buildMedResult = (info: {
    purpose: string;
    sideEffects: string[];
    warnings: string[];
    patientTips: string[];
    interactions?: unknown;
  }) => ({
    medicationName,
    isPatientMedication: !!patientMed,
    patientDose: patientMed?.dose,
    patientFrequency: patientMed?.frequency,
    ...info,
  });

  // Define fallback strategies
  const strategies: FallbackStrategy<ReturnType<typeof buildMedResult>>[] = [
    {
      name: "KNOWLEDGE_BASE",
      execute: async () => {
        const kbInfo = getPatientDrugInfo(normalizedName);
        if (!kbInfo) return null;

        // Check for drug interactions with patient's other medications
        const allMeds = [normalizedName, ...patient.medications.filter((m) => m.name.toLowerCase() !== normalizedName).map((m) => m.name)];
        const interactions = checkMultipleDrugInteractions(allMeds);
        const interactionWarnings = interactions.map((i) => getPatientFriendlyInteraction(i));

        return buildMedResult({
          purpose: kbInfo.purpose,
          sideEffects: kbInfo.sideEffects,
          warnings: [...kbInfo.warnings, ...interactionWarnings.map((iw) => `${iw.severity}: ${iw.message}`)],
          patientTips: kbInfo.patientTips,
          interactions: interactionWarnings.length > 0 ? interactionWarnings : undefined,
        });
      },
    },
    {
      name: "FDA_DAILYMED",
      execute: async () => {
        const fdaInfo = await getDailyMedDrugInfo(medicationName);
        if (!fdaInfo) return null;

        return buildMedResult({
          purpose: fdaInfo.purpose,
          sideEffects: fdaInfo.sideEffects.slice(0, 5),
          warnings: fdaInfo.warnings.slice(0, 3).map((w) => `⚠️ ${w}`),
          patientTips: fdaInfo.patientTips,
        });
      },
    },
    {
      name: "LLM_GENERATED",
      execute: async () => {
        const provider = createLLMProvider();
        const prompt = `You are a helpful pharmacist assistant. Provide patient-friendly information about the medication "${medicationName}".

Respond ONLY with a valid JSON object (no other text):
{
  "purpose": "A simple 1-sentence explanation of what this medication does",
  "sideEffects": ["Side effect 1", "Side effect 2", "Side effect 3"],
  "warnings": ["Warning 1", "Warning 2"],
  "patientTips": ["Tip 1", "Tip 2", "Tip 3"]
}

Use simple, patient-friendly language. If this is not a real medication, respond with:
{"error": "unknown medication"}`;

        const inputGuardrail = applyInputGuardrails(prompt, {
          sanitizePII: true, usePlaceholders: true, blockCriticalPII: true,
        });
        if (inputGuardrail.wasBlocked) return null;

        const response = await provider.generate(inputGuardrail.output, {
          spanName: "medication-lookup-llm",
          metadata: { medication: medicationName, fallback: true, pii_sanitized: inputGuardrail.wasSanitized },
        });

        const outputGuardrail = applyOutputGuardrails(response.content, {
          sanitizePII: true, usePlaceholders: true,
        });

        const parsed = extractJsonObject<{
          error?: string;
          purpose?: string;
          sideEffects?: string[];
          warnings?: string[];
          patientTips?: string[];
        }>(outputGuardrail.output);

        if (parsed.error) return null; // Will trigger final fallback

        return buildMedResult({
          purpose: parsed.purpose || "This medication was prescribed by your doctor.",
          sideEffects: parsed.sideEffects || ["Ask your pharmacist about side effects"],
          warnings: (parsed.warnings || ["Take exactly as prescribed"]).map((w: string) =>
            w.startsWith("⚠️") ? w : `⚠️ ${w}`
          ),
          patientTips: parsed.patientTips || ["Follow your doctor's instructions"],
        });
      },
    },
  ];

  // Final fallback if all strategies fail
  const finalFallback = buildMedResult({
    purpose: "This medication was prescribed by your doctor for your specific condition.",
    sideEffects: ["Side effects vary - ask your pharmacist or doctor about common ones"],
    warnings: ["⚠️ Take exactly as prescribed", "⚠️ Don't stop taking without talking to your doctor first"],
    patientTips: [
      "Read the information that came with your prescription",
      "Ask your pharmacist if you have questions",
      "Keep a list of all your medications to show your doctors",
    ],
  });

  return executeWithFallback("lookupMedication", strategies, finalFallback);
}

/**
 * Check symptom urgency
 * Priority order:
 * 1. Local knowledge base (Schmitt-Thompson style triage protocols)
 * 2. MedlinePlus API (health topic information)
 * 3. LLM fallback (for unknown symptoms)
 */
async function executeCheckSymptom(
  symptom: string,
  severity: string,
  patient: Patient,
  analysis: DischargeAnalysis | null
): Promise<ToolCallResult> {
  const normalizedSymptom = symptom.toLowerCase().trim();

  // Check if symptom could be related to patient's medications
  const possibleMedicationCause = patient.medications.find((m) => {
    const medName = m.name.toLowerCase();
    // Check medication monographs for this symptom as a side effect
    const monograph = getDrugMonograph(medName);
    if (monograph) {
      const sideEffects = monograph.adverseReactions
        .map((ar) => ar.reaction.toLowerCase())
        .join(" ");
      if (sideEffects.includes(normalizedSymptom.split(" ")[0])) {
        return true;
      }
    }
    // Fallback to common medication-symptom relationships
    if (normalizedSymptom.includes("dizz") && ["lisinopril", "metoprolol", "amlodipine", "furosemide"].some((d) => medName.includes(d))) {
      return true;
    }
    if (normalizedSymptom.includes("bleed") && ["warfarin", "aspirin", "eliquis", "apixaban", "plavix"].some((d) => medName.includes(d))) {
      return true;
    }
    if (normalizedSymptom.includes("nausea") && ["metformin"].some((d) => medName.includes(d))) {
      return true;
    }
    return false;
  });

  // STEP 1: Try local knowledge base first (Schmitt-Thompson style triage)
  const patientMeds = patient.medications.map((m) => m.name);
  const patientConditions = patient.diagnoses.map((d) => d.display);
  const kbAssessment = assessSymptomUrgency(
    normalizedSymptom,
    severity as "mild" | "moderate" | "severe",
    {
      medications: patientMeds,
      conditions: patientConditions,
    }
  );

  // The knowledge base always returns a result (with defaults for unknown symptoms)
  console.log(`[Patient Coach] Symptom assessment for ${symptom} from knowledge base`);

  // Map triage level to urgency level for UI consistency
  const urgencyMap: Record<string, "emergency" | "call_doctor_today" | "call_doctor_soon" | "monitor"> = {
    emergency: "emergency",
    urgent: "call_doctor_today",
    same_day: "call_doctor_today",
    routine: "call_doctor_soon",
    self_care: "monitor",
  };

  // Check if we got a specific symptom from the knowledge base (not default)
  const protocol = getSymptomTriage(normalizedSymptom);
  if (protocol) {
    return {
      toolName: "checkSymptom",
      result: {
        symptom,
        severity,
        urgencyLevel: urgencyMap[kbAssessment.urgencyLevel] || "call_doctor_soon",
        message: kbAssessment.message,
        actions: kbAssessment.actions,
        seekCareIf: kbAssessment.seekCareIf,
        selfCare: kbAssessment.selfCare,
        possibleMedicationRelated: possibleMedicationCause?.name || null,
        relatedRiskFactors:
          analysis?.riskFactors
            .filter(
              (rf) =>
                rf.description.toLowerCase().includes(normalizedSymptom) ||
                normalizedSymptom.includes(rf.title.toLowerCase())
            )
            .map((rf) => rf.title) || [],
        source: "KNOWLEDGE_BASE",
      },
      success: true,
    };
  }

  // STEP 2: Try MedlinePlus API
  try {
    console.log(`[Patient Coach] Trying MedlinePlus for ${symptom}`);
    const medlinePlusInfo = await getPatientSymptomAssessment(symptom, severity as "mild" | "moderate" | "severe");
    if (medlinePlusInfo) {
      return {
        toolName: "checkSymptom",
        result: {
          symptom,
          severity,
          urgencyLevel: medlinePlusInfo.urgencyLevel,
          message: medlinePlusInfo.message,
          actions: medlinePlusInfo.actions,
          medicalInfo: medlinePlusInfo.medicalInfo,
          possibleMedicationRelated: possibleMedicationCause?.name || null,
          relatedRiskFactors:
            analysis?.riskFactors
              .filter(
                (rf) =>
                  rf.description.toLowerCase().includes(normalizedSymptom) ||
                  normalizedSymptom.includes(rf.title.toLowerCase())
              )
              .map((rf) => rf.title) || [],
          source: "MEDLINEPLUS",
        },
        success: true,
      };
    }
  } catch (error) {
    traceError("patient-coach-medlineplus", error, { dataSource: "MedlinePlus" });
  }

  // STEP 3: Use LLM as final fallback
  try {
    console.log(`[Patient Coach] Using LLM fallback for ${symptom}`);
    const provider = createLLMProvider();
    const medicationContext = patient.medications.length > 0
      ? `The patient is taking: ${patient.medications.map(m => m.name).join(", ")}`
      : "No medications documented";

    const prompt = `A patient is asking about the symptom: "${symptom}" (severity: ${severity})

${medicationContext}

Provide guidance in JSON format:
{
  "urgencyLevel": "emergency" | "call_doctor_today" | "call_doctor_soon" | "monitor",
  "message": "Brief explanation of this symptom and when to be concerned",
  "actions": ["Action 1", "Action 2", "Action 3"],
  "selfCare": ["Self care tip 1", "Self care tip 2"],
  "possibleMedicationRelated": true | false
}

Rules:
- For ANY chest pain, difficulty breathing, or signs of stroke: urgencyLevel = "emergency"
- For severe pain, high fever, or bleeding: urgencyLevel = "call_doctor_today"
- Always include appropriate action for emergency situations
- Use patient-friendly language
- Consider if the symptom could be a medication side effect

Respond ONLY with the JSON object.`;

    const inputGuardrail = applyInputGuardrails(prompt, {
      sanitizePII: true, usePlaceholders: true, blockCriticalPII: true,
    });

    const response = await provider.generate(inputGuardrail.output, {
      spanName: "symptom-check-llm",
      metadata: { symptom, severity, fallback: true, pii_sanitized: inputGuardrail.wasSanitized },
    });

    const outputGuardrail = applyOutputGuardrails(response.content, {
      sanitizePII: true, usePlaceholders: true,
    });

    const parsed = extractJsonObject<{
      urgencyLevel?: string;
      message?: string;
      actions?: string[];
      selfCare?: string;
      possibleMedicationRelated?: boolean;
    }>(outputGuardrail.output);
    return {
      toolName: "checkSymptom",
      result: {
        symptom,
        severity,
        urgencyLevel: parsed.urgencyLevel || (severity === "severe" ? "call_doctor_today" : "monitor"),
        message: parsed.message || "Here's guidance for your symptom.",
        actions: parsed.actions || [
          "Monitor the symptom",
          "📞 Call your doctor if it continues or worsens",
          "🚨 Call 911 for any emergency",
        ],
        selfCare: parsed.selfCare,
        possibleMedicationRelated: parsed.possibleMedicationRelated ? possibleMedicationCause?.name : null,
        source: "LLM_GENERATED",
      },
      success: true,
    };
  } catch (error) {
    traceError("patient-coach-symptom-check", error);
  }

  // Final fallback if everything fails
  return {
    toolName: "checkSymptom",
    result: {
      symptom,
      severity,
      urgencyLevel: severity === "severe" ? "call_doctor_today" : "monitor",
      message:
        "I don't have specific information about this symptom, but here's general guidance.",
      actions: [
        "Keep track of when the symptom happens and how long it lasts",
        severity === "severe"
          ? "📞 Call your doctor today to discuss this symptom"
          : "📞 Mention this symptom at your next appointment or call if it gets worse",
        "🚨 If you feel like something is seriously wrong, call 911 or go to the ER",
      ],
      possibleMedicationRelated: possibleMedicationCause?.name || null,
      source: "FALLBACK",
    },
    success: true,
  };
}

/**
 * Explain a medical term
 * Priority order:
 * 1. Local knowledge base (MeSH-style medical terminology)
 * 2. LLM fallback (for unknown terms)
 */
async function executeExplainMedicalTerm(term: string): Promise<ToolCallResult> {
  const normalizedTerm = term.toLowerCase().trim();

  // STEP 1: Try local knowledge base first
  const kbExplanation = getPatientFriendlyExplanation(normalizedTerm);
  if (kbExplanation) {
    console.log(`[Patient Coach] Found ${term} in local knowledge base`);

    // Also get the full term definition for additional context
    const termDef = getMedicalTermDefinition(normalizedTerm);

    return {
      toolName: "explainMedicalTerm",
      result: {
        term,
        explanation: kbExplanation,
        category: termDef?.category,
        relatedTerms: termDef?.relatedTerms,
        source: "KNOWLEDGE_BASE",
      },
      success: true,
    };
  }

  // STEP 2: Use LLM as fallback
  try {
    console.log(`[Patient Coach] Using LLM fallback for medical term: ${term}`);
    const provider = createLLMProvider();
    const prompt = `Explain the medical term "${term}" in simple, everyday language that a patient without medical training would understand.

Keep your explanation to 2-3 sentences maximum. Don't use other medical jargon in your explanation.

If this is not a medical term or you're not sure what it means, say "I'm not sure about this term - please ask your nurse or doctor to explain it."

Respond with ONLY the explanation, no other text.`;

    const inputGuardrail = applyInputGuardrails(prompt, {
      sanitizePII: true, usePlaceholders: true, blockCriticalPII: true,
    });

    const response = await provider.generate(inputGuardrail.output, {
      spanName: "medical-term-llm",
      metadata: { term, fallback: true, pii_sanitized: inputGuardrail.wasSanitized },
    });

    const outputGuardrail = applyOutputGuardrails(response.content, {
      sanitizePII: true, usePlaceholders: true,
    });

    return {
      toolName: "explainMedicalTerm",
      result: {
        term,
        explanation: outputGuardrail.output.trim(),
        source: "LLM_GENERATED",
      },
      success: true,
    };
  } catch (error) {
    traceError("patient-coach-term-explanation", error);
  }

  // Final fallback if LLM fails
  return {
    toolName: "explainMedicalTerm",
    result: {
      term,
      explanation:
        "I don't have a simple explanation for this term. Please ask your nurse or doctor to explain it in simple words - they're happy to help!",
      source: "FALLBACK",
    },
    success: true,
  };
}

/**
 * Get follow-up appointment guidance
 */
async function executeGetFollowUpGuidance(
  appointmentType: string,
  patient: Patient,
  analysis: DischargeAnalysis | null
): Promise<ToolCallResult> {
  const hasHighRisks = (analysis?.riskFactors.filter((rf) => rf.severity === "high").length || 0) > 0;

  const guidance: Record<string, { timeframe: string; importance: string; tips: string[] }> = {
    primary_care: {
      timeframe: hasHighRisks ? "within 3-5 days" : "within 7-14 days",
      importance:
        "Your primary care doctor needs to check on your recovery and review your medications.",
      tips: [
        "Bring all your discharge papers",
        "Bring a list of all your medications",
        "Write down any questions you have before your visit",
      ],
    },
    specialist: {
      timeframe: "as directed in your discharge papers",
      importance:
        "Your specialist doctor manages specific aspects of your health condition.",
      tips: [
        "Call their office to schedule if not already done",
        "Ask about any tests you need before the appointment",
        "Bring records from your hospital stay",
      ],
    },
    lab_work: {
      timeframe:
        patient.medications.some((m) => m.name.toLowerCase().includes("warfarin"))
          ? "within 2-3 days for INR check"
          : "as directed in your discharge papers",
      importance: "Lab tests help your doctors monitor your recovery and medication effects.",
      tips: [
        "Some tests require fasting - ask when you schedule",
        "Bring your lab orders or know what tests are ordered",
        "Results are usually sent to your doctor who ordered them",
      ],
    },
    imaging: {
      timeframe: "as directed in your discharge papers",
      importance: "Imaging tests help doctors see how you're healing inside.",
      tips: [
        "You may need to schedule in advance",
        "Ask about any preparation needed",
        "Bring your ID and insurance card",
      ],
    },
    general: {
      timeframe: hasHighRisks ? "within 1 week" : "within 2 weeks",
      importance: "Follow-up care is essential for a safe recovery.",
      tips: [
        "Don't delay scheduling your appointments",
        "If you can't get an appointment soon enough, call and explain you just left the hospital",
        "Keep all your appointments even if you feel better",
      ],
    },
  };

  const info = guidance[appointmentType] || guidance.general;

  return {
    toolName: "getFollowUpGuidance",
    result: {
      appointmentType,
      ...info,
      patientConditions: patient.diagnoses.map((d) => d.display),
    },
    success: true,
  };
}

/**
 * Get dietary guidance
 */
async function executeGetDietaryGuidance(
  topic: string,
  patient: Patient
): Promise<ToolCallResult> {
  const normalizedTopic = topic.toLowerCase().trim();

  // Check patient's conditions and medications for relevant dietary info
  const hasWarfarin = patient.medications.some(
    (m) => m.name.toLowerCase().includes("warfarin")
  );
  const hasHeartFailure = patient.diagnoses.some(
    (d) => d.display.toLowerCase().includes("heart failure")
  );
  const hasDiabetes = patient.diagnoses.some(
    (d) =>
      d.display.toLowerCase().includes("diabetes") ||
      patient.medications.some((m) => m.name.toLowerCase().includes("metformin") || m.name.toLowerCase().includes("insulin"))
  );

  const dietaryInfo: Record<string, { recommendation: string; tips: string[]; cautions: string[] }> = {
    sodium: {
      recommendation: hasHeartFailure
        ? "You should limit sodium to less than 2,000mg per day because of your heart condition."
        : "A low-sodium diet is good for your heart and blood pressure.",
      tips: [
        "Read food labels - sodium is listed in milligrams (mg)",
        "Fresh foods usually have less sodium than canned or processed",
        "Use herbs and spices instead of salt for flavor",
        "Rinse canned vegetables to remove some sodium",
      ],
      cautions: [
        "Watch out for hidden sodium in bread, condiments, and restaurant food",
        "Frozen dinners are often very high in sodium",
      ],
    },
    warfarin: {
      recommendation:
        "If you take Warfarin (blood thinner), keep your vitamin K intake consistent.",
      tips: [
        "You don't need to avoid vitamin K foods, just eat about the same amount each week",
        "High vitamin K foods include leafy greens like spinach, kale, and broccoli",
        "Sudden big changes in these foods can affect how your blood thinner works",
      ],
      cautions: [
        "⚠️ Don't start any new supplements without asking your doctor",
        "⚠️ Avoid cranberry juice in large amounts",
      ],
    },
    sugar: {
      recommendation: hasDiabetes
        ? "Managing your blood sugar through diet is very important for your diabetes."
        : "Limiting added sugars is good for overall health.",
      tips: [
        "Choose whole grains over refined grains",
        "Eat fruits instead of drinking fruit juice",
        "Check labels for added sugars",
        "Spread carbohydrates throughout the day rather than eating a lot at once",
      ],
      cautions: hasDiabetes
        ? ["Keep a consistent eating schedule", "Don't skip meals if you take diabetes medication"]
        : [],
    },
    fluids: {
      recommendation: hasHeartFailure
        ? "You may need to limit fluids to prevent swelling. Ask your doctor for your specific limit."
        : "Staying well hydrated is important for recovery.",
      tips: hasHeartFailure
        ? [
            "Keep track of all liquids you drink",
            "Remember that soup, ice cream, and jello count as fluids",
            "Sucking on ice chips can help with thirst without adding much fluid",
          ]
        : [
            "Drink water throughout the day",
            "Light-colored urine usually means you're well hydrated",
            "Drink more if you're sweating or have a fever",
          ],
      cautions: hasHeartFailure ? ["Weigh yourself daily - call your doctor if you gain more than 2-3 lbs overnight"] : [],
    },
    protein: {
      recommendation: "Protein helps your body heal after illness or surgery.",
      tips: [
        "Good protein sources include lean meats, fish, eggs, beans, and dairy",
        "Try to have some protein at each meal",
        "Greek yogurt and cottage cheese are easy high-protein options",
      ],
      cautions: [],
    },
    general: {
      recommendation: "Eating well helps your body heal and recover. Here are general guidelines for a healthy recovery diet.",
      tips: [
        "Eat a balanced diet with fruits, vegetables, whole grains, and lean protein",
        "Stay hydrated — drink water throughout the day",
        "Eat smaller, more frequent meals if large meals are hard to manage",
        "Choose soft, easy-to-digest foods if you have nausea or a poor appetite",
        "Ask your care team about any specific dietary restrictions for your condition",
      ],
      cautions: hasWarfarin
        ? ["Keep vitamin K intake consistent while on Warfarin — don't suddenly increase or decrease leafy greens"]
        : hasHeartFailure
          ? ["Limit sodium to less than 2,000mg per day", "You may need to limit fluids — ask your doctor"]
          : hasDiabetes
            ? ["Watch your carbohydrate and sugar intake", "Don't skip meals if you take diabetes medication"]
            : [],
    },
  };

  // Find matching dietary info
  let info = dietaryInfo[normalizedTopic];

  if (!info) {
    for (const [key, value] of Object.entries(dietaryInfo)) {
      if (normalizedTopic.includes(key) || key.includes(normalizedTopic)) {
        info = value;
        break;
      }
    }
  }

  // Add warfarin-specific info if patient is on warfarin and asking about greens/vegetables
  if (
    hasWarfarin &&
    (normalizedTopic.includes("green") ||
      normalizedTopic.includes("vegetable") ||
      normalizedTopic.includes("salad"))
  ) {
    info = dietaryInfo.warfarin;
  }

  if (info) {
    return {
      toolName: "getDietaryGuidance",
      result: {
        topic,
        ...info,
        relevantConditions: patient.diagnoses
          .filter(
            (d) =>
              d.display.toLowerCase().includes("heart") ||
              d.display.toLowerCase().includes("diabetes") ||
              d.display.toLowerCase().includes("kidney")
          )
          .map((d) => d.display),
        relevantMedications: hasWarfarin ? ["Warfarin"] : [],
      },
      success: true,
    };
  }

  // Generic response
  return {
    toolName: "getDietaryGuidance",
    result: {
      topic,
      recommendation:
        "For specific dietary questions, please ask your doctor or a dietitian who can give you personalized advice.",
      tips: [
        "A balanced diet with fruits, vegetables, whole grains, and lean protein supports recovery",
        "Ask your doctor if you have any dietary restrictions based on your conditions",
      ],
      cautions: [],
    },
    success: true,
  };
}

/**
 * Get activity and restrictions guidance
 */
async function executeGetActivityGuidance(
  activity: string,
  patient: Patient,
  analysis: DischargeAnalysis | null
): Promise<ToolCallResult> {
  const normalizedActivity = activity.toLowerCase().trim();
  const hasHighRisks = (analysis?.riskFactors.filter((rf) => rf.severity === "high").length || 0) > 0;

  const activityInfo: Record<
    string,
    {
      recommendation: string;
      timeframe: string;
      safetyTips: string[];
      warningToStop: string[];
    }
  > = {
    driving: {
      recommendation:
        "Most people can resume driving 24-48 hours after leaving the hospital, but it depends on your condition and medications.",
      timeframe: hasHighRisks
        ? "Ask your doctor before driving"
        : "Usually OK after 24-48 hours if feeling well",
      safetyTips: [
        "Don't drive if you feel dizzy, drowsy, or have taken sedating medications",
        "Start with short trips close to home",
        "Have someone with you for your first drive",
      ],
      warningToStop: [
        "Feeling dizzy or lightheaded",
        "Blurry vision",
        "Drowsiness from medications",
        "Pain that distracts you",
      ],
    },
    lifting: {
      recommendation:
        "Avoid heavy lifting initially to let your body recover.",
      timeframe: "Typically avoid lifting more than 10 lbs for 2-4 weeks, but follow your doctor's specific instructions",
      safetyTips: [
        "Ask for help with heavy grocery bags or laundry",
        "Use a cart or wagon for heavy items",
        "Bend your knees, not your back, when picking things up",
      ],
      warningToStop: [
        "Pain or discomfort",
        "Feeling winded",
        "Dizziness",
      ],
    },
    exercise: {
      recommendation:
        "Light activity like walking is usually encouraged. Check with your doctor about more vigorous exercise.",
      timeframe: "Start slowly and gradually increase as you feel stronger",
      safetyTips: [
        "Walking is often the best exercise to start with",
        "Listen to your body and rest when tired",
        "Stay hydrated during activity",
        "Avoid exercise in extreme heat or cold",
      ],
      warningToStop: [
        "Chest pain or pressure",
        "Severe shortness of breath",
        "Dizziness or lightheadedness",
        "Unusual fatigue",
      ],
    },
    stairs: {
      recommendation: "Most people can use stairs, but take it slowly at first.",
      timeframe: "Usually OK right away, but go slowly",
      safetyTips: [
        "Use the handrail",
        "Take one step at a time",
        "Rest if you feel winded",
        "Consider sleeping on the main floor initially if stairs are difficult",
      ],
      warningToStop: [
        "Significant shortness of breath",
        "Chest pain",
        "Feeling faint",
      ],
    },
    showering: {
      recommendation:
        "Showering is usually fine, but be careful about slipping and don't take very hot or long showers at first.",
      timeframe: "Usually OK right away with precautions",
      safetyTips: [
        "Use a shower chair if you feel unsteady",
        "Install grab bars if you don't have them",
        "Use non-slip mats",
        "Don't lock the bathroom door in case you need help",
        "Keep showers shorter and not too hot to prevent dizziness",
      ],
      warningToStop: ["Feeling dizzy or faint", "Feeling weak"],
    },
    work: {
      recommendation:
        "When you can return to work depends on your job and your recovery. Discuss with your doctor.",
      timeframe: hasHighRisks
        ? "Discuss with your doctor before returning"
        : "Varies - desk jobs may be sooner than physical jobs",
      safetyTips: [
        "Ask your doctor for a note with any restrictions",
        "Consider starting part-time if possible",
        "Take breaks and don't overdo it",
        "Know your job's requirements and discuss with your doctor",
      ],
      warningToStop: [
        "Symptoms returning or worsening",
        "Unable to concentrate due to fatigue",
        "Pain that interferes with work",
      ],
    },
    sex: {
      recommendation:
        "Sexual activity can usually be resumed when you feel ready and comfortable, typically 2-4 weeks after hospitalization.",
      timeframe: "When you feel well enough - usually similar to climbing stairs",
      safetyTips: [
        "If you can climb 2 flights of stairs without symptoms, you're likely OK",
        "Choose positions that are comfortable and less strenuous",
        "It's normal to feel anxious - take it slowly",
        "Talk to your doctor if you have concerns or heart conditions",
      ],
      warningToStop: [
        "Chest pain or pressure",
        "Severe shortness of breath",
        "Irregular heartbeat",
      ],
    },
  };

  let info = activityInfo[normalizedActivity];

  if (!info) {
    for (const [key, value] of Object.entries(activityInfo)) {
      if (normalizedActivity.includes(key) || key.includes(normalizedActivity)) {
        info = value;
        break;
      }
    }
  }

  if (info) {
    return {
      toolName: "getActivityGuidance",
      result: {
        activity,
        ...info,
        patientSpecificNote: hasHighRisks
          ? "⚠️ Because of your specific health situation, please check with your doctor before resuming this activity."
          : null,
      },
      success: true,
    };
  }

  // Generic response
  return {
    toolName: "getActivityGuidance",
    result: {
      activity,
      recommendation:
        "For specific activity questions, please ask your doctor who can give you personalized guidance based on your condition.",
      timeframe: "Ask your doctor",
      safetyTips: [
        "Start slowly and increase gradually",
        "Listen to your body",
        "Rest when you feel tired",
      ],
      warningToStop: [
        "Any unusual symptoms",
        "Pain",
        "Feeling unwell",
      ],
    },
    success: true,
  };
}