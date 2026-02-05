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
import {
  evaluateFoodChoice,
  getConditionBasedFoodSuggestions,
} from "@/lib/integrations/usda-nutrition-client";
import {
  checkFoodDrugInteractions,
  getAllFoodInteractionsForMedications,
  getFoodGuidanceForPatient,
} from "@/lib/integrations/food-drug-interactions";
import {
  evaluateCareGaps,
  getUnmetCareGaps,
} from "@/lib/integrations/guidelines-client";

/**
 * SHARED UTILITIES - Extract patient context once, reuse everywhere
 */

interface PatientContext {
  age: number;
  conditions: string[];
  medications: string[];
  recentSurgery?: string;
}

/**
 * Extract patient context once to avoid repetition in every tool
 */
function extractPatientContext(patient: Patient): PatientContext {
  return {
    age: patient.age,
    conditions: patient.diagnoses.map((d) => d.display),
    medications: patient.medications.map((m) => m.name),
    recentSurgery: patient.diagnoses.find((d) =>
      d.display.toLowerCase().includes("surgery") ||
      d.display.toLowerCase().includes("surgical") ||
      d.display.toLowerCase().includes("ectomy")
    )?.display,
  };
}

/**
 * Unified fallback handler - replaces triple-fallback pattern in every tool
 * Tries in order: local KB → external API → LLM generation → hardcoded fallback
 */
async function executeWithFallback<T>(config: {
  toolName: string;
  localLookup?: () => T | null;
  apiLookup?: () => Promise<T | null>;
  llmPrompt?: string;
  llmMetadata?: Record<string, unknown>;
  hardcodedFallback: T;
}): Promise<T> {
  // Try local knowledge base first (fastest, no network)
  if (config.localLookup) {
    try {
      const local = config.localLookup();
      if (local) {
        console.log(`[${config.toolName}] Found in local knowledge base`);
        return local;
      }
    } catch (error) {
      console.error(`[${config.toolName}] Local lookup failed:`, error);
    }
  }

  // Try external API
  if (config.apiLookup) {
    try {
      const api = await config.apiLookup();
      if (api) {
        console.log(`[${config.toolName}] Found via external API`);
        return api;
      }
    } catch (error) {
      console.error(`[${config.toolName}] API lookup failed:`, error);
    }
  }

  // Try LLM generation
  if (config.llmPrompt) {
    try {
      console.log(`[${config.toolName}] Using LLM fallback`);
      const llm = createLLMProvider();
      const response = await llm.generate(config.llmPrompt, {
        spanName: `${config.toolName}-llm`,
        metadata: { fallback: true, ...config.llmMetadata },
      });
      const parsed = extractJsonObject<T>(response.content);
      // Check if LLM returned an error marker
      if (parsed && typeof parsed === "object" && "error" in parsed) {
        console.log(`[${config.toolName}] LLM returned error, using hardcoded fallback`);
        return config.hardcodedFallback;
      }
      return parsed as T;
    } catch (error) {
      console.error(`[${config.toolName}] LLM fallback failed:`, error);
    }
  }

  // Final hardcoded fallback
  console.log(`[${config.toolName}] Using hardcoded fallback`);
  return config.hardcodedFallback;
}

export interface PatientCoachToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required: string[];
  };
}

export interface ToolCallResult {
  toolName: string;
  result: unknown;
  success: boolean;
  error?: string;
}

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
  {
    name: "getPreventiveCare",
    description:
      "Get personalized preventive care recommendations based on age and gender. Use this when patients ask about screenings, vaccines, checkups, or preventive health. Also identifies potential care gaps.",
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "Optional specific topic (e.g., 'cancer screening', 'vaccines', 'heart health'). If not provided, returns all recommendations.",
        },
      },
      required: [],
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

      case "getPreventiveCare":
        return await executeGetPreventiveCare(
          parameters.topic as string | undefined,
          patient
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
 * Look up medication information (REFACTORED - using shared utilities)
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
  const patientContext = extractPatientContext(patient);

  // Check if patient is actually taking this medication
  const patientMed = patient.medications.find(
    (m) =>
      m.name.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(m.name.toLowerCase())
  );

  // Helper to check drug interactions (used by local KB path)
  const getInteractionWarnings = () => {
    const allMeds = [
      normalizedName,
      ...patient.medications
        .filter((m) => m.name.toLowerCase() !== normalizedName)
        .map((m) => m.name),
    ];
    const interactions = checkMultipleDrugInteractions(allMeds);
    return interactions.map((i) => getPatientFriendlyInteraction(i));
  };

  // Define medication info interface
  interface MedicationInfo {
    purpose: string;
    sideEffects: string[];
    warnings: string[];
    patientTips: string[];
    source: string;
    interactions?: Array<{ severity: string; message: string }>;
  }

  // Use unified fallback handler
  const medicationInfo = await executeWithFallback<MedicationInfo>({
    toolName: "lookupMedication",
    // Local KB lookup
    localLookup: () => {
      const kbInfo = getPatientDrugInfo(normalizedName);
      if (kbInfo) {
        const interactionWarnings = getInteractionWarnings();
        return {
          purpose: kbInfo.purpose,
          sideEffects: kbInfo.sideEffects,
          warnings: [
            ...kbInfo.warnings,
            ...interactionWarnings.map((iw) => `${iw.severity}: ${iw.message}`),
          ],
          patientTips: kbInfo.patientTips,
          interactions: interactionWarnings.length > 0 ? interactionWarnings : undefined,
          source: "KNOWLEDGE_BASE",
        };
      }
      return null;
    },
    // FDA API lookup
    apiLookup: async () => {
      const fdaInfo = await getDailyMedDrugInfo(medicationName);
      if (fdaInfo) {
        // Return raw FDA data - no LLM formatting
        return {
          purpose: fdaInfo.purpose,
          sideEffects: fdaInfo.sideEffects.slice(0, 5),
          warnings: fdaInfo.warnings.slice(0, 3),
          patientTips: fdaInfo.patientTips,
          source: "FDA_DAILYMED",
        };
      }
      return null;
    },
    // LLM fallback
    llmPrompt: `You are a helpful pharmacist assistant. Provide patient-friendly information about the medication "${medicationName}".

Respond ONLY with a valid JSON object (no other text):
{
  "purpose": "A simple 1-sentence explanation of what this medication does",
  "sideEffects": ["Side effect 1", "Side effect 2", "Side effect 3"],
  "warnings": ["Warning 1", "Warning 2"],
  "patientTips": ["Tip 1", "Tip 2", "Tip 3"]
}

Use simple, patient-friendly language. If this is not a real medication, respond with:
{"error": "unknown medication"}`,
    llmMetadata: { medication: medicationName },
    // Hardcoded fallback
    hardcodedFallback: {
      purpose: "This medication was prescribed by your doctor for your specific condition.",
      sideEffects: ["Side effects vary - ask your pharmacist or doctor about common ones"],
      warnings: ["⚠️ Take exactly as prescribed", "⚠️ Don't stop taking without talking to your doctor first"],
      patientTips: [
        "Read the information that came with your prescription",
        "Ask your pharmacist if you have questions",
        "Keep a list of all your medications to show your doctors",
      ],
      source: "FALLBACK",
    },
  });

  // Build final result
  return {
    toolName: "lookupMedication",
    result: {
      medicationName,
      isPatientMedication: !!patientMed,
      patientDose: patientMed?.dose,
      patientFrequency: patientMed?.frequency,
      ...medicationInfo,
    },
    success: true,
  };
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
      // Return raw MedlinePlus data - no LLM formatting
      return {
        toolName: "checkSymptom",
        result: {
          symptom,
          severity,
          urgencyLevel: medlinePlusInfo.urgencyLevel,
          clinicalMessage: medlinePlusInfo.message,
          medicalInfo: medlinePlusInfo.medicalInfo,
          recommendedActions: medlinePlusInfo.actions,
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
    console.error("[Patient Coach] MedlinePlus lookup failed:", error);
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

CRITICAL RULES:
- For ANY chest pain, difficulty breathing, or signs of stroke: urgencyLevel = "emergency"
- For severe pain, high fever, or bleeding: urgencyLevel = "call_doctor_today"
- Always include appropriate action for emergency situations
- Use patient-friendly language
- Consider if the symptom could be a medication side effect
- Keep response CONCISE: message under 50 words, actions 2-3 items max, selfCare 2-3 items max

URGENCY LEVELS (choose one):
- "emergency" - Life-threatening, needs 911/ER now
- "call_doctor_today" - Needs medical attention within 24 hours
- "call_doctor_soon" - Schedule appointment within a few days
- "monitor" - Watch for changes, no immediate action needed

Provide guidance in JSON format (respond ONLY with the JSON object):
{
  "urgencyLevel": "one of: emergency, call_doctor_today, call_doctor_soon, monitor",
  "message": "brief 1-2 sentence explanation (under 50 words)",
  "actions": ["2-3 short action items"],
  "selfCare": ["2-3 short self-care tips"],
  "possibleMedicationRelated": true or false
}`;

    const response = await provider.generate(prompt, {
      spanName: "symptom-check-llm",
      metadata: { symptom, severity, fallback: true },
    });

    const parsed = extractJsonObject<{
      urgencyLevel?: string;
      message?: string;
      actions?: string[];
      selfCare?: string;
      possibleMedicationRelated?: boolean;
    }>(response.content);
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
    console.error("[Patient Coach] LLM symptom check failed:", error);
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

    const response = await provider.generate(prompt, {
      spanName: "medical-term-llm",
      metadata: { term, fallback: true },
    });

    return {
      toolName: "explainMedicalTerm",
      result: {
        term,
        explanation: response.content.trim(),
        source: "LLM_GENERATED",
      },
      success: true,
    };
  } catch (error) {
    console.error("[Patient Coach] LLM term explanation failed:", error);
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
 * Get follow-up appointment guidance - Uses LLM for personalized advice
 */
async function executeGetFollowUpGuidance(
  appointmentType: string,
  patient: Patient,
  analysis: DischargeAnalysis | null
): Promise<ToolCallResult> {
  const hasHighRisks = (analysis?.riskFactors.filter((rf) => rf.severity === "high").length || 0) > 0;
  const diagnosisList = patient.diagnoses.map((d) => d.display).join(", ");
  const medicationList = patient.medications.map((m) => m.name).join(", ");
  const riskFactors = analysis?.riskFactors.map((rf) => `${rf.severity}: ${rf.title}`).join("; ") || "None identified";

  try {
    const provider = createLLMProvider();

    const prompt = `You are a discharge coordinator helping a patient understand their follow-up care.

PATIENT INFO:
- Name: ${patient.name}, Age: ${patient.age}
- Diagnoses: ${diagnosisList || "None documented"}
- Medications: ${medicationList || "None documented"}
- Risk factors from assessment: ${riskFactors}
- High risk patient: ${hasHighRisks ? "Yes" : "No"}

QUESTION: Patient is asking about "${appointmentType}" follow-up appointments.

YOUR TASK: Provide personalized guidance considering:
1. Their specific conditions and which specialists they might need
2. Urgency based on their risk factors
3. What they should bring and prepare
4. Any condition-specific follow-up needs (e.g., INR monitoring for warfarin)
5. Use markdown formatting: **bold** for important terms like timeframes, specialist names, and key actions

Respond in JSON:
{
  "timeframe": "when they should schedule",
  "importance": "why this matters for their situation",
  "tips": ["array of 3-4 personalized tips"],
  "specialistsToSee": ["array of specific doctors they should see"],
  "questionsToAsk": ["array of 2-3 questions to ask at appointment"]
}`;

    const response = await provider.generate(prompt, {
      spanName: "followup-guidance-llm",
      metadata: { appointmentType, patientId: patient.id },
    });

    const parsed = extractJsonObject(response.content);
    if (parsed && parsed.timeframe) {
      return {
        toolName: "getFollowUpGuidance",
        result: {
          appointmentType,
          ...parsed,
          patientConditions: patient.diagnoses.map((d) => d.display),
        },
        success: true,
      };
    }
  } catch (error) {
    console.error("[getFollowUpGuidance] LLM call failed:", error);
  }

  // Fallback with basic personalization
  const hasWarfarin = patient.medications.some((m) => m.name.toLowerCase().includes("warfarin"));

  return {
    toolName: "getFollowUpGuidance",
    result: {
      appointmentType,
      timeframe: hasHighRisks ? "within 3-5 days" : "within 7-14 days",
      importance: `Follow-up care is essential for monitoring your ${diagnosisList || "recovery"}.`,
      tips: [
        "Bring all your discharge papers and medication list",
        "Write down any symptoms or concerns you've noticed",
        hasWarfarin ? "Schedule INR check within 2-3 days" : "Schedule with your primary care doctor first",
      ],
      patientConditions: patient.diagnoses.map((d) => d.display),
    },
    success: true,
  };
}

// DELETED: generatePostSurgicalDietaryGuidance and generateGeneralDietaryGuidance
// These functions called the LLM to format responses, violating the ReAct pattern.
// The ReAct agent now receives raw data from executeGetDietaryGuidance and synthesizes its own response.

/**
 * Fallback dietary guidance for post-surgical patients when API is unavailable
 * Based on clinical best practices and evidence-based guidelines
 */
function getPostSurgicalDietaryFallback(surgeryType: string): {
  recommendation: string;
  goodChoices: string[];
  avoid: string[];
  tips: string[];
  warningSignsToReport?: string[];
} {
  switch (surgeryType) {
    case "tonsillectomy":
    case "throat surgery":
      return {
        recommendation: "After throat surgery, eating the right foods helps you heal faster and reduces pain. Focus on soft, cool foods for the first 1-2 weeks.",
        goodChoices: [
          "Ice cream, popsicles, and frozen yogurt (soothing and cold)",
          "Smoothies and milkshakes (nutritious and easy to swallow)",
          "Applesauce and mashed bananas",
          "Yogurt and pudding",
          "Mashed potatoes (cooled, not hot)",
          "Scrambled eggs (soft and protein-rich)",
          "Lukewarm broth and cream soups",
          "Oatmeal or cream of wheat (cooled)",
          "Soft pasta with butter or mild sauce",
          "Jell-O and soft gelatin desserts",
        ],
        avoid: [
          "Crunchy foods (chips, crackers, toast, raw vegetables) - can scratch healing tissue",
          "Spicy foods - irritates the throat",
          "Acidic foods (citrus, tomatoes, vinegar) - causes stinging and pain",
          "Very hot foods or drinks - can increase bleeding risk",
          "Hard or sharp foods (nuts, pretzels, popcorn)",
          "Carbonated drinks - may cause discomfort",
          "Red or purple foods/drinks during first few days - makes it hard to identify bleeding",
        ],
        tips: [
          "Cold foods help reduce swelling and pain",
          "Stay hydrated - drink plenty of water and clear fluids",
          "It's okay to eat ice cream and popsicles - they're actually recommended!",
          "Eat small, frequent meals rather than large ones",
          "Let hot foods cool to lukewarm before eating",
          "Pain may be worse in the morning - have cold water or ice chips ready",
          "Gradually introduce regular foods after 1-2 weeks as healing progresses",
        ],
        warningSignsToReport: [
          "Bright red bleeding from mouth or nose",
          "Fever over 101°F (38.3°C)",
          "Unable to drink fluids due to pain",
          "Signs of dehydration (dark urine, dizziness)",
        ],
      };

    case "abdominal surgery":
      return {
        recommendation: "After abdominal surgery, your digestive system needs time to recover. Follow a gradual progression from clear liquids to regular foods.",
        goodChoices: [
          "Clear liquids first (broth, Jell-O, apple juice, water)",
          "Then advance to: yogurt, pudding, applesauce",
          "Soft proteins: scrambled eggs, tender chicken, fish",
          "Cooked vegetables (soft, not raw)",
          "White rice, plain pasta, white bread",
          "Bananas and canned fruits",
          "Low-fat dairy products",
        ],
        avoid: [
          "High-fiber foods initially (raw vegetables, whole grains, beans)",
          "Fatty or fried foods - hard to digest",
          "Spicy foods - may cause discomfort",
          "Carbonated beverages - can cause gas and bloating",
          "Alcohol - interferes with healing and medications",
          "Large meals - eat small, frequent portions instead",
        ],
        tips: [
          "Start with small portions and increase gradually",
          "Chew food thoroughly",
          "Stay hydrated between meals",
          "Walk after eating to help digestion",
          "Keep a food diary to track what works for you",
          "Gradually add fiber back as your bowels return to normal",
        ],
      };

    case "dental surgery":
      return {
        recommendation: "After dental surgery, protect the surgical site while maintaining nutrition. Soft foods and proper care help prevent complications.",
        goodChoices: [
          "Smoothies and protein shakes (don't use a straw!)",
          "Yogurt and pudding",
          "Mashed potatoes and sweet potatoes",
          "Scrambled eggs",
          "Applesauce and mashed bananas",
          "Lukewarm soup (blended, no chunks)",
          "Oatmeal (cooled)",
          "Hummus and soft spreads",
          "Ice cream (helps with swelling)",
        ],
        avoid: [
          "DO NOT use straws - suction can dislodge blood clots (dry socket)",
          "Crunchy foods (chips, nuts, popcorn)",
          "Chewy or sticky foods (gum, caramel, tough meat)",
          "Spicy or acidic foods",
          "Very hot foods or drinks",
          "Alcohol - interferes with healing and pain medications",
          "Smoking - significantly delays healing",
        ],
        tips: [
          "NO STRAWS for at least 1 week - very important!",
          "Cold foods help reduce swelling",
          "Chew on the opposite side from the surgical site",
          "Rinse gently with salt water after 24 hours",
          "Take pain medication with food to prevent nausea",
        ],
      };

    default:
      return {
        recommendation: "After surgery, follow a soft diet to help your body heal. Progress gradually from liquids to soft foods to regular foods as tolerated.",
        goodChoices: [
          "Clear liquids (broth, water, juice without pulp)",
          "Soft foods (yogurt, pudding, applesauce)",
          "Mashed potatoes and soft vegetables",
          "Scrambled eggs and soft proteins",
          "Oatmeal and soft cereals",
        ],
        avoid: [
          "Hard, crunchy, or tough foods",
          "Spicy or acidic foods",
          "Alcohol",
          "Very hot foods",
        ],
        tips: [
          "Eat small, frequent meals",
          "Stay hydrated",
          "Progress to regular foods gradually",
          "Follow your surgeon's specific instructions",
        ],
      };
  }
}

/**
 * Get dietary guidance - Returns RAW DATA for ReAct agent to synthesize
 * NO LLM calls - just fetch structured data from APIs
 */
async function executeGetDietaryGuidance(
  topic: string,
  patient: Patient
): Promise<ToolCallResult> {
  console.log(`[getDietaryGuidance] Fetching raw dietary data for: "${topic}"`);

  // Fetch raw data from external sources
  const foodInteractions = getAllFoodInteractionsForMedications(patient.medications);

  // Map patient conditions to known condition types
  const conditionMapping: Record<string, "heart_failure" | "diabetes" | "kidney_disease" | "warfarin"> = {
    "heart failure": "heart_failure",
    "congestive heart failure": "heart_failure",
    "chf": "heart_failure",
    "diabetes": "diabetes",
    "type 2 diabetes": "diabetes",
    "kidney disease": "kidney_disease",
    "chronic kidney disease": "kidney_disease",
    "ckd": "kidney_disease",
  };

  // Find first matching condition
  let mappedCondition: "heart_failure" | "diabetes" | "kidney_disease" | "warfarin" | null = null;
  for (const diagnosis of patient.diagnoses) {
    const diagnosisLower = diagnosis.display.toLowerCase();
    for (const [key, value] of Object.entries(conditionMapping)) {
      if (diagnosisLower.includes(key)) {
        mappedCondition = value;
        break;
      }
    }
    if (mappedCondition) break;
  }

  // Check if patient is on warfarin
  const onWarfarin = patient.medications.some(m =>
    m.name.toLowerCase().includes("warfarin") || m.name.toLowerCase().includes("coumadin")
  );
  if (onWarfarin && !mappedCondition) {
    mappedCondition = "warfarin";
  }

  // Try to get condition-specific food suggestions
  let conditionFoods = null;
  if (mappedCondition) {
    try {
      conditionFoods = await getConditionBasedFoodSuggestions(mappedCondition);
    } catch (error) {
      console.log(`[getDietaryGuidance] USDA API call failed for ${mappedCondition}`);
    }
  }

  return {
    toolName: "getDietaryGuidance",
    result: {
      topic,
      patientAge: patient.age,
      patientConditions: patient.diagnoses.map(d => d.display),
      medications: patient.medications.map(m => ({ name: m.name, dose: m.dose })),
      foodInteractions,  // Raw interaction data
      suggestedFoods: conditionFoods?.goodChoices || [],  // Raw food list
      restrictedFoods: conditionFoods?.avoid || [],  // Raw restriction list
      nutritionTips: conditionFoods?.tips || [],
      source: conditionFoods ? "Evidence-Based Guidelines + Food-Drug Interaction DB" : "Food-Drug Interaction DB"
    },
    success: true,
  };
}

/**
 * Get activity and restrictions guidance - Uses LLM for personalized advice
 * based on patient's conditions, medications, and risk factors
 */
async function executeGetActivityGuidance(
  activity: string,
  patient: Patient,
  analysis: DischargeAnalysis | null
): Promise<ToolCallResult> {
  const normalizedActivity = activity.toLowerCase().trim();
  const hasHighRisks = (analysis?.riskFactors.filter((rf) => rf.severity === "high").length || 0) > 0;

  // Build patient context for personalized advice
  const diagnosisList = patient.diagnoses.map((d) => d.display).join(", ");
  const medicationList = patient.medications.map((m) => `${m.name} ${m.dose}`).join(", ");
  const riskFactors = analysis?.riskFactors.map((rf) => `${rf.severity}: ${rf.title}`).join("; ") || "None identified";

  // Identify condition-specific considerations
  const hasHeartCondition = patient.diagnoses.some((d) =>
    d.display.toLowerCase().includes("heart") ||
    d.display.toLowerCase().includes("cardiac") ||
    d.display.toLowerCase().includes("arrhythmia") ||
    d.display.toLowerCase().includes("angina")
  );
  const hasBreathingIssue = patient.diagnoses.some((d) =>
    d.display.toLowerCase().includes("copd") ||
    d.display.toLowerCase().includes("asthma") ||
    d.display.toLowerCase().includes("pneumonia") ||
    d.display.toLowerCase().includes("pulmonary")
  );
  const hasMobilityIssue = patient.diagnoses.some((d) =>
    d.display.toLowerCase().includes("fracture") ||
    d.display.toLowerCase().includes("surgery") ||
    d.display.toLowerCase().includes("joint") ||
    d.display.toLowerCase().includes("hip") ||
    d.display.toLowerCase().includes("knee")
  );
  const hasBleedingRisk = patient.medications.some((m) =>
    m.name.toLowerCase().includes("warfarin") ||
    m.name.toLowerCase().includes("eliquis") ||
    m.name.toLowerCase().includes("xarelto") ||
    m.name.toLowerCase().includes("aspirin") ||
    m.name.toLowerCase().includes("plavix")
  );
  const hasSedatingMeds = patient.medications.some((m) =>
    m.name.toLowerCase().includes("oxycodone") ||
    m.name.toLowerCase().includes("hydrocodone") ||
    m.name.toLowerCase().includes("tramadol") ||
    m.name.toLowerCase().includes("ambien") ||
    m.name.toLowerCase().includes("ativan") ||
    m.name.toLowerCase().includes("valium")
  );

  // Build condition context
  const conditionContext: string[] = [];
  if (hasHeartCondition) conditionContext.push("Heart condition present - monitor for chest pain, shortness of breath during activity");
  if (hasBreathingIssue) conditionContext.push("Breathing/lung condition - may need to pace activities, watch for respiratory symptoms");
  if (hasMobilityIssue) conditionContext.push("Mobility/orthopedic consideration - follow weight-bearing restrictions if any");
  if (hasBleedingRisk) conditionContext.push("On blood thinners - extra caution with fall risk activities, contact sports, sharp objects");
  if (hasSedatingMeds) conditionContext.push("Taking medications that may cause drowsiness - affects driving, operating machinery");

  try {
    const provider = createLLMProvider();

    const prompt = `You are a patient recovery coach providing personalized activity guidance after hospital discharge.

PATIENT INFO:
- Name: ${patient.name}, Age: ${patient.age}
- Diagnoses: ${diagnosisList || "None documented"}
- Medications: ${medicationList || "None documented"}
- Risk factors from assessment: ${riskFactors}
- High risk patient: ${hasHighRisks ? "Yes" : "No"}

RELEVANT SAFETY CONSIDERATIONS:
${conditionContext.length > 0 ? conditionContext.map(c => `- ${c}`).join("\n") : "- No specific activity restrictions identified from conditions"}

QUESTION: Patient is asking about "${activity}" after discharge.

YOUR TASK: Provide PERSONALIZED guidance considering:
1. Their specific conditions and how they affect this activity
2. Medications that might impact safety (especially drowsiness, bleeding risk)
3. Their age and overall health status
4. Realistic timeframes based on their situation
5. Specific warning signs relevant to THEIR conditions
6. Use markdown formatting: **bold** for important terms, timeframes, drug names, and warnings
7. Be warm and conversational in tone

Respond in JSON:
{
  "recommendation": "your personalized recommendation in 2-3 sentences",
  "timeframe": "when they can resume this activity",
  "safetyTips": ["array of 3-5 specific safety tips"],
  "warningToStop": ["array of 3-4 warning signs"],
  "medicationConsiderations": "medication advice or null if not applicable",
  "doctorDiscussion": "what to discuss with doctor before resuming"
}`;

    const response = await provider.generate(prompt, {
      spanName: "activity-guidance-llm",
      metadata: { activity, patientId: patient.id },
    });

    const parsed = extractJsonObject(response.content);
    if (parsed && parsed.recommendation) {
      return {
        toolName: "getActivityGuidance",
        result: {
          activity,
          ...parsed,
          patientSpecificNote: hasHighRisks
            ? "⚠️ Because of your specific health situation, please check with your doctor before resuming this activity."
            : null,
          relevantConditions: patient.diagnoses.map((d) => d.display),
          relevantMedications: patient.medications.map((m) => m.name),
        },
        success: true,
      };
    }
  } catch (error) {
    console.error("[getActivityGuidance] LLM call failed:", error);
  }

  // Fallback with basic personalization if LLM fails
  const fallbackSafetyTips: string[] = [
    "Start slowly and increase activity gradually",
    "Listen to your body and rest when tired",
  ];
  const fallbackWarnings: string[] = [
    "Any unusual symptoms",
    "Pain that doesn't improve with rest",
  ];

  if (hasHeartCondition) {
    fallbackSafetyTips.push("Monitor for chest pain or shortness of breath during activity");
    fallbackWarnings.push("Chest pain, pressure, or tightness");
  }
  if (hasBreathingIssue) {
    fallbackSafetyTips.push("Take breaks to catch your breath");
    fallbackWarnings.push("Severe shortness of breath");
  }
  if (hasSedatingMeds) {
    fallbackSafetyTips.push("Avoid driving or operating machinery if your medications make you drowsy");
    fallbackWarnings.push("Excessive drowsiness or dizziness");
  }
  if (hasBleedingRisk) {
    fallbackSafetyTips.push("Be extra careful with activities that risk falls or cuts while on blood thinners");
    fallbackWarnings.push("Unusual bleeding or bruising");
  }

  return {
    toolName: "getActivityGuidance",
    result: {
      activity,
      recommendation: `For "${activity}", here's guidance based on your conditions (${diagnosisList || "general recovery"}).`,
      timeframe: hasHighRisks
        ? "Check with your doctor before resuming this activity"
        : "Start slowly as you feel ready, usually within a few days to weeks",
      safetyTips: fallbackSafetyTips,
      warningToStop: fallbackWarnings,
      patientSpecificNote: hasHighRisks
        ? "⚠️ Because of your specific health situation, please check with your doctor before resuming this activity."
        : null,
      relevantConditions: patient.diagnoses.map((d) => d.display),
      relevantMedications: patient.medications.map((m) => m.name),
    },
    success: true,
  };
}

/**
 * Get preventive care recommendations - Uses MyHealthfinder API (ODPHP)
 * Based on USPSTF guidelines for age and gender-appropriate screenings
 */
async function executeGetPreventiveCare(
  topic: string | undefined,
  patient: Patient
): Promise<ToolCallResult> {
  try {
    console.log(`[getPreventiveCare] Fetching recommendations for patient ${patient.id}, age ${patient.age}`);

    // Get all care gaps from CMS guidelines
    const allCareGaps = await evaluateCareGaps(patient);

    // Get unmet care gaps
    const unmetGaps = await getUnmetCareGaps(patient);

    // Filter by topic if provided
    let relevantGaps = allCareGaps;
    if (topic) {
      const topicLower = topic.toLowerCase();
      relevantGaps = allCareGaps.filter(
        (gap) =>
          gap.guideline.toLowerCase().includes(topicLower) ||
          gap.recommendation.toLowerCase().includes(topicLower)
      );

      if (relevantGaps.length === 0) {
        console.log(`[getPreventiveCare] No specific matches for "${topic}", returning all`);
        relevantGaps = allCareGaps;
      }
    }

    // Return raw structured data - no LLM formatting
    return {
      toolName: "getPreventiveCare",
      result: {
        topic: topic || "all preventive care",
        patientAge: patient.age,
        patientGender: patient.gender === "M" ? "Male" : patient.gender === "F" ? "Female" : "Other",
        patientConditions: patient.diagnoses.map(d => d.display),
        totalGuidelines: relevantGaps.length,
        careGaps: relevantGaps.map(gap => ({
          guideline: gap.guideline,
          organization: gap.organization,
          recommendation: gap.recommendation,
          grade: gap.grade,
          status: gap.status,
          evidence: gap.evidence,
          dueDate: gap.dueDate,
        })),
        unmetCareGaps: unmetGaps.map(gap => ({
          guideline: gap.guideline,
          recommendation: gap.recommendation,
          grade: gap.grade,
        })),
        source: "CMS Preventive Care Guidelines"
      },
      success: true,
    };
  } catch (error) {
    console.error("[getPreventiveCare] Error fetching recommendations:", error);

    // Return basic age-based recommendations as fallback
    const fallbackRecommendations: string[] = [];

    if (patient.age >= 50) {
      fallbackRecommendations.push("Colorectal cancer screening (age 45-75)");
      fallbackRecommendations.push("Shingles vaccine (age 50+)");
    }
    if (patient.gender === "F" && patient.age >= 40) {
      fallbackRecommendations.push("Mammogram for breast cancer screening");
    }
    if (patient.gender === "F" && patient.age >= 21 && patient.age <= 65) {
      fallbackRecommendations.push("Cervical cancer screening (Pap smear)");
    }
    if (patient.age >= 65) {
      fallbackRecommendations.push("Pneumonia vaccine");
    }
    fallbackRecommendations.push("Annual flu vaccine");
    fallbackRecommendations.push("Blood pressure check at regular visits");

    return {
      toolName: "getPreventiveCare",
      result: {
        topic: topic || "all preventive care",
        patientAge: patient.age,
        patientGender: patient.gender === "M" ? "Male" : patient.gender === "F" ? "Female" : "Other",
        recommendations: {
          screenings: fallbackRecommendations.filter((r) => r.includes("screening") || r.includes("Pap") || r.includes("Mammogram")),
          vaccinations: fallbackRecommendations.filter((r) => r.includes("vaccine")),
          generalHealth: fallbackRecommendations.filter((r) => r.includes("check") || r.includes("Blood pressure")),
        },
        importantNote:
          "These are general recommendations. Please discuss your specific preventive care needs with your healthcare provider.",
        source: "USPSTF Guidelines (fallback)",
      },
      success: true,
    };
  }
}
