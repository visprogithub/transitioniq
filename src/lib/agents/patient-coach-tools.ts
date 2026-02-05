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
  getFoodGuidanceForPatient,
} from "@/lib/integrations/food-drug-interactions";
import {
  getPreventiveRecommendations,
  identifyPreventiveCareGaps,
} from "@/lib/integrations/myhealthfinder-client";

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
 * Look up medication information
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

  // STEP 1: Try local knowledge base first (fastest, no network)
  const kbInfo = getPatientDrugInfo(normalizedName);
  if (kbInfo) {
    console.log(`[Patient Coach] Found ${medicationName} in local knowledge base`);

    // Also check for drug interactions with patient's other medications
    const allMeds = [
      normalizedName,
      ...patient.medications
        .filter((m) => m.name.toLowerCase() !== normalizedName)
        .map((m) => m.name),
    ];
    const interactions = checkMultipleDrugInteractions(allMeds);
    const interactionWarnings = interactions.map((i) => getPatientFriendlyInteraction(i));

    return {
      toolName: "lookupMedication",
      result: {
        medicationName,
        isPatientMedication: !!patientMed,
        patientDose: patientMed?.dose,
        patientFrequency: patientMed?.frequency,
        purpose: kbInfo.purpose,
        sideEffects: kbInfo.sideEffects,
        warnings: [
          ...kbInfo.warnings,
          ...interactionWarnings.map((iw) => `${iw.severity}: ${iw.message}`),
        ],
        patientTips: kbInfo.patientTips,
        interactions: interactionWarnings.length > 0 ? interactionWarnings : undefined,
        source: "KNOWLEDGE_BASE",
      },
      success: true,
    };
  }

  // STEP 2: Try FDA DailyMed API
  try {
    console.log(`[Patient Coach] Trying FDA DailyMed for ${medicationName}`);
    const fdaInfo = await getDailyMedDrugInfo(medicationName);
    if (fdaInfo) {
      return {
        toolName: "lookupMedication",
        result: {
          medicationName,
          isPatientMedication: !!patientMed,
          patientDose: patientMed?.dose,
          patientFrequency: patientMed?.frequency,
          purpose: fdaInfo.purpose,
          sideEffects: fdaInfo.sideEffects.slice(0, 5), // Limit to top 5
          warnings: fdaInfo.warnings.slice(0, 3).map((w) => `⚠️ ${w}`),
          patientTips: fdaInfo.patientTips,
          source: "FDA_DAILYMED",
        },
        success: true,
      };
    }
  } catch (error) {
    console.error("[Patient Coach] FDA DailyMed lookup failed:", error);
  }

  // STEP 3: Use LLM as final fallback
  try {
    console.log(`[Patient Coach] Using LLM fallback for ${medicationName}`);
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

    const response = await provider.generate(prompt, {
      spanName: "medication-lookup-llm",
      metadata: { medication: medicationName, fallback: true },
    });

    const parsed = extractJsonObject<{
      error?: string;
      purpose?: string;
      sideEffects?: string[];
      warnings?: string[];
      patientTips?: string[];
    }>(response.content);

    if (parsed.error) {
      return {
        toolName: "lookupMedication",
        result: {
          medicationName,
          isPatientMedication: !!patientMed,
          patientDose: patientMed?.dose,
          patientFrequency: patientMed?.frequency,
          purpose: "I don't have specific information about this medication. Please ask your pharmacist or doctor for details.",
          sideEffects: ["Ask your pharmacist about potential side effects"],
          warnings: ["⚠️ Always take medications exactly as prescribed"],
          patientTips: [
            "Read the information that came with your prescription",
            "Ask your pharmacist if you have questions",
          ],
          source: "FALLBACK",
        },
        success: true,
      };
    }

    return {
      toolName: "lookupMedication",
      result: {
        medicationName,
        isPatientMedication: !!patientMed,
        patientDose: patientMed?.dose,
        patientFrequency: patientMed?.frequency,
        purpose: parsed.purpose || "This medication was prescribed by your doctor.",
        sideEffects: parsed.sideEffects || ["Ask your pharmacist about side effects"],
        warnings: (parsed.warnings || ["Take exactly as prescribed"]).map((w: string) =>
          w.startsWith("⚠️") ? w : `⚠️ ${w}`
        ),
        patientTips: parsed.patientTips || ["Follow your doctor's instructions"],
        source: "LLM_GENERATED",
      },
      success: true,
    };
  } catch (error) {
    console.error("[Patient Coach] LLM medication lookup failed:", error);
  }

  // Final fallback if everything fails
  return {
    toolName: "lookupMedication",
    result: {
      medicationName,
      isPatientMedication: !!patientMed,
      patientDose: patientMed?.dose,
      patientFrequency: patientMed?.frequency,
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

Provide personalized guidance. Consider:
1. Their specific conditions and which specialists they might need
2. Urgency based on their risk factors
3. What they should bring and prepare
4. Any condition-specific follow-up needs (e.g., INR monitoring for warfarin)

Respond in JSON:
{
  "timeframe": "When they should schedule (be specific to their conditions)",
  "importance": "Why this follow-up matters for THEIR specific situation",
  "tips": ["3-4 personalized, actionable tips"],
  "specialistsToSee": ["List specific types of doctors they should see based on their conditions"],
  "questionsToAsk": ["2-3 questions they should ask at their appointment"]
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

/**
 * Get dietary guidance - Uses USDA API for food lookups and condition-based recommendations
 * No LLM fallback - uses USDA data and clinical guidelines only
 */
async function executeGetDietaryGuidance(
  topic: string,
  patient: Patient
): Promise<ToolCallResult> {
  // Check for specific conditions that affect diet
  const hasWarfarin = patient.medications.some((m) => m.name.toLowerCase().includes("warfarin"));
  const hasHeartFailure = patient.diagnoses.some((d) => d.display.toLowerCase().includes("heart failure"));
  const hasDiabetes = patient.diagnoses.some(
    (d) => d.display.toLowerCase().includes("diabetes") ||
    patient.medications.some((m) => m.name.toLowerCase().includes("metformin") || m.name.toLowerCase().includes("insulin"))
  );
  const hasKidneyDisease = patient.diagnoses.some((d) =>
    d.display.toLowerCase().includes("kidney") || d.display.toLowerCase().includes("renal")
  );
  const hasCOPD = patient.diagnoses.some((d) => d.display.toLowerCase().includes("copd"));

  const patientConditions = { hasHeartFailure, hasDiabetes, hasKidneyDisease, takesWarfarin: hasWarfarin, hasCOPD };
  const topicLower = topic.toLowerCase();

  // STEP 1: Check if asking about a specific food - use USDA API
  const specificFoodPatterns = [
    /can i (eat|have) (.+)/i,
    /is (.+) (ok|okay|good|safe|bad)/i,
    /what about (.+)/i,
    /(.+) good for me/i,
  ];

  let specificFood: string | null = null;
  for (const pattern of specificFoodPatterns) {
    const match = topic.match(pattern);
    if (match) {
      specificFood = match[1] || match[2];
      break;
    }
  }

  // If asking about specific food, look it up in USDA AND check for food-drug interactions
  if (specificFood) {
    try {
      console.log(`[getDietaryGuidance] Looking up specific food: ${specificFood}`);

      // Check for food-drug interactions with patient's medications
      const foodDrugInteractions = checkFoodDrugInteractions(patient.medications, specificFood);
      const majorInteractions = foodDrugInteractions.filter((i) => i.severity === "major");

      // Get USDA nutrition evaluation
      const evaluation = await evaluateFoodChoice(specificFood, patientConditions);

      // If there are major food-drug interactions, flag as not a good choice
      let isGoodChoice = evaluation?.isGoodChoice ?? true;
      const concerns: string[] = evaluation?.nutrientConcerns || [];
      const reasons: string[] = evaluation?.reasons || [];

      // Add food-drug interaction warnings
      if (majorInteractions.length > 0) {
        isGoodChoice = false;
        for (const interaction of majorInteractions) {
          concerns.push(`⚠️ MEDICATION INTERACTION with ${interaction.drug}: ${interaction.recommendation}`);
        }
      } else if (foodDrugInteractions.length > 0) {
        // Moderate/minor interactions - add as concerns but may still be OK
        for (const interaction of foodDrugInteractions) {
          concerns.push(`Note (${interaction.drug}): ${interaction.recommendation}`);
        }
      }

      const foodName = evaluation?.food || specificFood;

      return {
        toolName: "getDietaryGuidance",
        result: {
          topic,
          specificFood: foodName,
          isGoodChoice,
          recommendation: !isGoodChoice
            ? majorInteractions.length > 0
              ? `⚠️ Caution with ${foodName} - it may interact with your medications.`
              : `You may want to limit ${foodName} or choose alternatives.`
            : `${foodName} can be a good choice for you.`,
          reasons,
          concerns,
          foodDrugInteractions: foodDrugInteractions.length > 0
            ? foodDrugInteractions.map((i) => ({
                drug: i.drug,
                severity: i.severity,
                mechanism: i.mechanism,
                recommendation: i.recommendation,
                timing: i.timing,
              }))
            : undefined,
          source: "USDA FoodData Central + Clinical Food-Drug Interaction Database",
        },
        success: true,
      };
    } catch (error) {
      console.error("[getDietaryGuidance] Food lookup failed:", error);
    }
  }

  // STEP 2: Map topic to condition-based guidance using USDA client
  // This uses evidence-based clinical guidelines, not LLM
  const conditionKeywords: Record<string, "heart_failure" | "diabetes" | "kidney_disease" | "warfarin"> = {
    "heart": "heart_failure",
    "sodium": "heart_failure",
    "salt": "heart_failure",
    "fluid": "heart_failure",
    "swelling": "heart_failure",
    "sugar": "diabetes",
    "diabetes": "diabetes",
    "blood sugar": "diabetes",
    "carb": "diabetes",
    "glucose": "diabetes",
    "kidney": "kidney_disease",
    "potassium": "kidney_disease",
    "phosphorus": "kidney_disease",
    "renal": "kidney_disease",
    "warfarin": "warfarin",
    "blood thinner": "warfarin",
    "vitamin k": "warfarin",
    "coumadin": "warfarin",
    "inr": "warfarin",
    "greens": "warfarin",
    "leafy": "warfarin",
  };

  // Check if topic matches any condition keywords
  for (const [keyword, condition] of Object.entries(conditionKeywords)) {
    if (topicLower.includes(keyword)) {
      console.log(`[getDietaryGuidance] Matched condition keyword: ${keyword} -> ${condition}`);
      const suggestions = await getConditionBasedFoodSuggestions(condition);
      return {
        toolName: "getDietaryGuidance",
        result: {
          topic,
          condition,
          ...suggestions,
          source: "USDA/Clinical guidelines",
        },
        success: true,
      };
    }
  }

  // STEP 3: For general diet questions, provide guidance based on patient's actual conditions
  // Gather all relevant condition-based suggestions
  const allSuggestions: {
    goodChoices: string[];
    avoid: string[];
    tips: string[];
    conditions: string[];
  } = {
    goodChoices: [],
    avoid: [],
    tips: [],
    conditions: [],
  };

  // Get suggestions for each condition the patient actually has
  if (hasHeartFailure) {
    const hfSuggestions = await getConditionBasedFoodSuggestions("heart_failure");
    allSuggestions.goodChoices.push(...hfSuggestions.goodChoices.slice(0, 3));
    allSuggestions.avoid.push(...hfSuggestions.avoid.slice(0, 3));
    allSuggestions.tips.push(...hfSuggestions.tips.slice(0, 2));
    allSuggestions.conditions.push("Heart Failure");
  }

  if (hasDiabetes) {
    const diabetesSuggestions = await getConditionBasedFoodSuggestions("diabetes");
    allSuggestions.goodChoices.push(...diabetesSuggestions.goodChoices.slice(0, 3));
    allSuggestions.avoid.push(...diabetesSuggestions.avoid.slice(0, 3));
    allSuggestions.tips.push(...diabetesSuggestions.tips.slice(0, 2));
    allSuggestions.conditions.push("Diabetes");
  }

  if (hasKidneyDisease) {
    const kidneySuggestions = await getConditionBasedFoodSuggestions("kidney_disease");
    allSuggestions.goodChoices.push(...kidneySuggestions.goodChoices.slice(0, 3));
    allSuggestions.avoid.push(...kidneySuggestions.avoid.slice(0, 3));
    allSuggestions.tips.push(...kidneySuggestions.tips.slice(0, 2));
    allSuggestions.conditions.push("Kidney Disease");
  }

  if (hasWarfarin) {
    const warfarinSuggestions = await getConditionBasedFoodSuggestions("warfarin");
    allSuggestions.goodChoices.push(...warfarinSuggestions.goodChoices.slice(0, 2));
    allSuggestions.avoid.push(...warfarinSuggestions.avoid.slice(0, 2));
    allSuggestions.tips.push(...warfarinSuggestions.tips.slice(0, 2));
    allSuggestions.conditions.push("Warfarin therapy");
  }

  // If patient has conditions, return combined guidance with food-drug interaction warnings
  if (allSuggestions.conditions.length > 0) {
    console.log(`[getDietaryGuidance] Returning combined guidance for conditions: ${allSuggestions.conditions.join(", ")}`);

    // Get food-drug interaction warnings for patient's medications
    const foodGuidance = getFoodGuidanceForPatient(patient.medications);
    const medicationFoodWarnings: string[] = [];

    if (foodGuidance.mustAvoid.length > 0) {
      medicationFoodWarnings.push("⚠️ FOODS TO AVOID due to your medications:");
      for (const interaction of foodGuidance.mustAvoid.slice(0, 5)) {
        medicationFoodWarnings.push(`  • ${interaction.food} (${interaction.drug}): ${interaction.recommendation}`);
      }
    }

    if (foodGuidance.needsTiming.length > 0) {
      const timingItems = foodGuidance.needsTiming.filter((t) => !foodGuidance.mustAvoid.includes(t)).slice(0, 3);
      if (timingItems.length > 0) {
        medicationFoodWarnings.push("⏰ TIMING MATTERS:");
        for (const interaction of timingItems) {
          medicationFoodWarnings.push(`  • ${interaction.food} with ${interaction.drug}: ${interaction.timing || interaction.recommendation}`);
        }
      }
    }

    return {
      toolName: "getDietaryGuidance",
      result: {
        topic,
        recommendation: `Based on your conditions (${allSuggestions.conditions.join(", ")}), here are dietary recommendations from clinical guidelines.`,
        goodChoices: [...new Set(allSuggestions.goodChoices)], // Remove duplicates
        avoid: [...new Set(allSuggestions.avoid)],
        tips: [...new Set(allSuggestions.tips)],
        forConditions: allSuggestions.conditions,
        medicationFoodWarnings: medicationFoodWarnings.length > 0 ? medicationFoodWarnings : undefined,
        source: "USDA/Clinical guidelines + Food-Drug Interaction Database",
      },
      success: true,
    };
  }

  // STEP 4: Try to extract any food words from the topic and look them up
  // Common foods that might be mentioned
  const commonFoods = [
    "chicken", "fish", "beef", "pork", "turkey", "salmon", "tuna",
    "rice", "bread", "pasta", "potato", "oatmeal", "cereal",
    "apple", "banana", "orange", "berries", "grapes", "watermelon",
    "broccoli", "spinach", "carrots", "tomato", "lettuce", "kale",
    "milk", "cheese", "yogurt", "eggs", "butter",
    "beans", "lentils", "nuts", "almonds", "peanuts",
    "coffee", "tea", "juice", "soda", "alcohol", "wine", "beer",
  ];

  for (const food of commonFoods) {
    if (topicLower.includes(food)) {
      try {
        console.log(`[getDietaryGuidance] Found food word in topic: ${food}`);

        // Check food-drug interactions
        const foodDrugInteractions = checkFoodDrugInteractions(patient.medications, food);
        const majorInteractions = foodDrugInteractions.filter((i) => i.severity === "major");

        const evaluation = await evaluateFoodChoice(food, patientConditions);

        let isGoodChoice = evaluation?.isGoodChoice ?? true;
        const concerns: string[] = evaluation?.nutrientConcerns || [];
        const reasons: string[] = evaluation?.reasons || [];

        // Add food-drug interaction warnings
        if (majorInteractions.length > 0) {
          isGoodChoice = false;
          for (const interaction of majorInteractions) {
            concerns.push(`⚠️ MEDICATION INTERACTION with ${interaction.drug}: ${interaction.recommendation}`);
          }
        } else if (foodDrugInteractions.length > 0) {
          for (const interaction of foodDrugInteractions) {
            concerns.push(`Note (${interaction.drug}): ${interaction.recommendation}`);
          }
        }

        const foodName = evaluation?.food || food;

        return {
          toolName: "getDietaryGuidance",
          result: {
            topic,
            specificFood: foodName,
            isGoodChoice,
            recommendation: !isGoodChoice
              ? majorInteractions.length > 0
                ? `⚠️ Caution with ${foodName} - it may interact with your medications.`
                : `You may want to limit ${foodName} or choose alternatives.`
              : `${foodName} can be a good choice for you.`,
            reasons,
            concerns,
            foodDrugInteractions: foodDrugInteractions.length > 0
              ? foodDrugInteractions.map((i) => ({
                  drug: i.drug,
                  severity: i.severity,
                  mechanism: i.mechanism,
                  recommendation: i.recommendation,
                  timing: i.timing,
                }))
              : undefined,
            source: "USDA FoodData Central + Clinical Food-Drug Interaction Database",
          },
          success: true,
        };
      } catch (error) {
        console.error(`[getDietaryGuidance] USDA lookup for ${food} failed:`, error);
      }
    }
  }

  // STEP 5: Default general healthy eating guidance (no LLM, just evidence-based basics)
  console.log("[getDietaryGuidance] Returning general healthy eating guidance");
  return {
    toolName: "getDietaryGuidance",
    result: {
      topic,
      recommendation: "Here are general healthy eating guidelines. Ask about specific foods or conditions for more personalized advice.",
      goodChoices: [
        "Fresh fruits and vegetables",
        "Lean proteins (chicken, fish, beans)",
        "Whole grains (brown rice, whole wheat bread, oatmeal)",
        "Low-fat dairy or dairy alternatives",
        "Nuts and seeds in moderation",
      ],
      avoid: [
        "Highly processed foods",
        "Foods high in added sugars",
        "Excessive sodium (check labels)",
        "Trans fats and excessive saturated fats",
      ],
      tips: [
        "Read nutrition labels to understand what you're eating",
        "Drink plenty of water throughout the day",
        "Eat regular meals - don't skip meals if on medications",
        "Ask your doctor or a dietitian for personalized advice",
      ],
      source: "General nutrition guidelines",
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

Provide PERSONALIZED guidance considering:
1. Their specific conditions and how they affect this activity
2. Medications that might impact safety (especially drowsiness, bleeding risk)
3. Their age and overall health status
4. Realistic timeframes based on their situation
5. Specific warning signs relevant to THEIR conditions

Respond in JSON:
{
  "recommendation": "Personalized recommendation specific to this patient's situation",
  "timeframe": "When they can likely resume this activity based on their conditions",
  "safetyTips": ["3-5 specific tips personalized to their situation - mention their medications/conditions where relevant"],
  "warningToStop": ["3-4 warning signs to watch for - personalized to their conditions"],
  "medicationConsiderations": "Any medication-related advice for this activity (or null if not relevant)",
  "doctorDiscussion": "What they should specifically discuss with their doctor about this activity"
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

    // Get all recommendations from MyHealthfinder API
    const allRecommendations = await getPreventiveRecommendations(patient);

    // Identify potential care gaps
    const careGaps = await identifyPreventiveCareGaps(patient);

    // If a specific topic was requested, filter the recommendations
    let filteredRecommendations = allRecommendations;
    if (topic) {
      const topicLower = topic.toLowerCase();
      filteredRecommendations = allRecommendations.filter(
        (rec) =>
          rec.title.toLowerCase().includes(topicLower) ||
          rec.category.toLowerCase().includes(topicLower) ||
          rec.description.toLowerCase().includes(topicLower)
      );

      // If no matches found for specific topic, return all with a note
      if (filteredRecommendations.length === 0) {
        console.log(`[getPreventiveCare] No specific matches for "${topic}", returning all recommendations`);
        filteredRecommendations = allRecommendations;
      }
    }

    // Organize recommendations by category
    const byCategory: Record<string, typeof allRecommendations> = {};
    for (const rec of filteredRecommendations) {
      const cat = rec.category || "General";
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(rec);
    }

    // Build patient-friendly response
    const screeningsDue: string[] = [];
    const vaccinesDue: string[] = [];
    const generalHealth: string[] = [];

    for (const rec of filteredRecommendations) {
      const title = rec.title;
      const catLower = (rec.category || "").toLowerCase();

      if (catLower.includes("screen") || catLower.includes("cancer") || title.toLowerCase().includes("screen")) {
        screeningsDue.push(title);
      } else if (catLower.includes("immun") || catLower.includes("vaccin") || title.toLowerCase().includes("vaccin")) {
        vaccinesDue.push(title);
      } else {
        generalHealth.push(title);
      }
    }

    // Build care gap summary
    const gapSummary = careGaps.length > 0
      ? careGaps.map((g) => ({
          recommendation: g.recommendation.title,
          status: g.status,
          reason: g.reason,
        }))
      : [];

    return {
      toolName: "getPreventiveCare",
      result: {
        topic: topic || "all preventive care",
        patientAge: patient.age,
        patientGender: patient.gender === "M" ? "Male" : patient.gender === "F" ? "Female" : "Other",
        totalRecommendations: filteredRecommendations.length,
        recommendations: {
          screenings: screeningsDue.length > 0 ? screeningsDue : ["None specific to your age/gender"],
          vaccinations: vaccinesDue.length > 0 ? vaccinesDue : ["Check with your doctor about routine vaccines"],
          generalHealth: generalHealth.length > 0 ? generalHealth : [],
        },
        careGaps: gapSummary.length > 0
          ? {
              count: gapSummary.length,
              items: gapSummary.slice(0, 5), // Limit to top 5
              note: "These are screenings that may be due based on your age and record. Please discuss with your doctor.",
            }
          : {
              count: 0,
              note: "No obvious care gaps identified. Continue with regular checkups.",
            },
        details: filteredRecommendations.slice(0, 10).map((rec) => ({
          title: rec.title,
          category: rec.category,
          description: rec.description,
          frequency: rec.frequency,
          grade: rec.uspstfGrade,
          learnMore: rec.actionUrl,
        })),
        importantNote:
          "These are general recommendations based on national guidelines. Your individual needs may vary. Always discuss preventive care with your healthcare provider.",
        source: "MyHealthfinder (ODPHP) - USPSTF Guidelines",
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
