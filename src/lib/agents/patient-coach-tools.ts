/**
 * Patient Coach Tools - Agentic tools for the patient-facing recovery coach
 *
 * These tools enable multi-turn reasoning for patient questions about their discharge.
 * Each tool call is traced in Opik for observability.
 */

import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

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
];

/**
 * Medication knowledge base for the lookupMedication tool
 */
const MEDICATION_INFO: Record<
  string,
  {
    purpose: string;
    sideEffects: string[];
    warnings: string[];
    patientTips: string[];
  }
> = {
  warfarin: {
    purpose: "This is a blood thinner that helps prevent blood clots.",
    sideEffects: [
      "Bruising more easily than usual",
      "Bleeding that takes longer to stop",
      "Tiredness",
    ],
    warnings: [
      "⚠️ Avoid vitamin K-rich foods like leafy greens in large amounts",
      "⚠️ Tell any doctor or dentist that you take this medication",
      "⚠️ Avoid aspirin and ibuprofen unless your doctor approves",
    ],
    patientTips: [
      "Take it at the same time every day",
      "Don't skip doses or double up",
      "Get your blood tests (INR) as scheduled",
    ],
  },
  lisinopril: {
    purpose: "This medication helps lower your blood pressure and protects your heart.",
    sideEffects: ["Dry cough (common)", "Dizziness when standing up quickly", "Headache"],
    warnings: [
      "⚠️ Get up slowly from sitting or lying down to prevent dizziness",
      "⚠️ Tell your doctor if you develop swelling of face, lips, or tongue",
    ],
    patientTips: [
      "Drink plenty of water",
      "Limit salt in your diet",
      "Don't stop taking this suddenly without talking to your doctor",
    ],
  },
  metformin: {
    purpose: "This medication helps control your blood sugar levels for diabetes.",
    sideEffects: ["Upset stomach", "Diarrhea (usually gets better with time)", "Metallic taste"],
    warnings: [
      "⚠️ Take with food to reduce stomach upset",
      "⚠️ Don't drink too much alcohol while taking this",
    ],
    patientTips: [
      "Check your blood sugar as directed",
      "The stomach side effects usually improve after a few weeks",
      "Stay hydrated",
    ],
  },
  amlodipine: {
    purpose: "This medication helps lower your blood pressure by relaxing blood vessels.",
    sideEffects: ["Swelling in ankles or feet", "Feeling flushed", "Headache"],
    warnings: ["⚠️ Avoid grapefruit and grapefruit juice", "⚠️ Tell your doctor about ankle swelling"],
    patientTips: [
      "Take it at the same time each day",
      "Elevate your feet if you notice swelling",
      "Don't stop taking it suddenly",
    ],
  },
  metoprolol: {
    purpose: "This medication slows your heart rate and lowers blood pressure.",
    sideEffects: ["Feeling tired", "Cold hands and feet", "Slow heartbeat"],
    warnings: [
      "⚠️ Don't stop taking this suddenly - it must be tapered slowly",
      "⚠️ Tell your doctor if you feel very dizzy or faint",
    ],
    patientTips: [
      "Take with or right after a meal",
      "Check your pulse regularly if your doctor advises",
      "Be careful when exercising - your heart rate may not increase as much",
    ],
  },
  aspirin: {
    purpose: "Low-dose aspirin helps prevent blood clots and protects your heart.",
    sideEffects: ["Stomach upset", "Heartburn", "Bruising more easily"],
    warnings: [
      "⚠️ Take with food to protect your stomach",
      "⚠️ Watch for signs of bleeding like black stools or blood in urine",
    ],
    patientTips: [
      "Don't chew the coated tablets",
      "Avoid alcohol which can increase stomach bleeding risk",
      "Tell any doctor or dentist you take aspirin",
    ],
  },
  furosemide: {
    purpose: "This is a water pill that helps remove extra fluid from your body.",
    sideEffects: [
      "Needing to urinate more often",
      "Feeling thirsty",
      "Dizziness",
      "Muscle cramps",
    ],
    warnings: [
      "⚠️ Take in the morning so you're not up all night going to the bathroom",
      "⚠️ You may need to eat foods high in potassium like bananas",
    ],
    patientTips: [
      "Weigh yourself daily - report sudden weight gain to your doctor",
      "Get up slowly to prevent dizziness",
      "Keep track of how often you're urinating",
    ],
  },
  atorvastatin: {
    purpose: "This medication helps lower your cholesterol and protects your heart.",
    sideEffects: ["Muscle aches", "Headache", "Stomach upset"],
    warnings: [
      "⚠️ Report unexplained muscle pain or weakness to your doctor right away",
      "⚠️ Avoid grapefruit and grapefruit juice",
    ],
    patientTips: [
      "Take it at the same time every day (often at bedtime)",
      "Continue eating a heart-healthy diet",
      "Get your cholesterol checked as directed",
    ],
  },
  insulin: {
    purpose: "This helps control your blood sugar when your body doesn't make enough insulin.",
    sideEffects: ["Low blood sugar (feeling shaky, sweaty, confused)", "Weight gain"],
    warnings: [
      "⚠️ Always carry a fast-acting sugar source in case of low blood sugar",
      "⚠️ Know the signs of low blood sugar: shakiness, sweating, confusion",
      "⚠️ Store insulin properly (usually in the refrigerator)",
    ],
    patientTips: [
      "Rotate injection sites",
      "Check your blood sugar as directed",
      "Don't skip meals when taking insulin",
    ],
  },
  eliquis: {
    purpose: "This is a blood thinner that helps prevent blood clots and strokes.",
    sideEffects: ["Bruising more easily", "Minor bleeding", "Nausea"],
    warnings: [
      "⚠️ Take exactly as prescribed - twice daily, about 12 hours apart",
      "⚠️ Don't stop taking without talking to your doctor",
      "⚠️ Tell all healthcare providers you take this blood thinner",
    ],
    patientTips: [
      "Set reminders to take both doses",
      "Keep a consistent routine",
      "If you miss a dose, take it as soon as you remember (same day), then resume your normal schedule",
    ],
  },
};

/**
 * Symptom urgency guidelines
 */
const SYMPTOM_URGENCY: Record<
  string,
  {
    urgencyLevel: "emergency" | "call_doctor_today" | "call_doctor_soon" | "monitor";
    message: string;
    actions: string[];
  }
> = {
  "chest pain": {
    urgencyLevel: "emergency",
    message:
      "Chest pain can be a sign of a heart attack. This needs immediate attention.",
    actions: [
      "🚨 Call 911 immediately",
      "Chew an aspirin if you're not allergic",
      "Don't drive yourself to the hospital",
    ],
  },
  "difficulty breathing": {
    urgencyLevel: "emergency",
    message: "Trouble breathing is a serious symptom that needs immediate attention.",
    actions: [
      "🚨 Call 911 immediately",
      "Sit upright to help breathing",
      "Don't lie flat",
    ],
  },
  "shortness of breath": {
    urgencyLevel: "call_doctor_today",
    message:
      "Shortness of breath could indicate your heart or lungs need attention.",
    actions: [
      "📞 Call your doctor's office today",
      "Rest in a comfortable position",
      "If it gets worse or you feel chest pain, call 911",
    ],
  },
  dizziness: {
    urgencyLevel: "call_doctor_soon",
    message:
      "Dizziness can be a side effect of medications or a sign you need fluids.",
    actions: [
      "Sit or lie down until it passes",
      "Drink water",
      "Get up slowly from sitting or lying down",
      "📞 Call your doctor if it continues or happens often",
    ],
  },
  "swelling in legs": {
    urgencyLevel: "call_doctor_today",
    message: "Swelling can be a sign of fluid buildup that may need treatment.",
    actions: [
      "📞 Call your doctor today",
      "Elevate your legs when sitting",
      "Weigh yourself and report any sudden gain (more than 2-3 lbs overnight)",
    ],
  },
  nausea: {
    urgencyLevel: "monitor",
    message:
      "Nausea is often a side effect of medications that may improve over time.",
    actions: [
      "Take medications with food if allowed",
      "Eat small, frequent meals",
      "Stay hydrated",
      "📞 Call your doctor if you can't keep food or medications down",
    ],
  },
  headache: {
    urgencyLevel: "monitor",
    message: "Headaches can be a side effect of some medications.",
    actions: [
      "Rest in a quiet, dark room",
      "Stay hydrated",
      "Try acetaminophen (Tylenol) if not restricted",
      "📞 Call your doctor if severe or not improving",
    ],
  },
  bleeding: {
    urgencyLevel: "call_doctor_today",
    message:
      "If you're on blood thinners, it's important to monitor any bleeding.",
    actions: [
      "Apply gentle pressure to minor cuts",
      "📞 Call your doctor today",
      "🚨 Call 911 if bleeding is severe or won't stop",
    ],
  },
  fever: {
    urgencyLevel: "call_doctor_today",
    message: "Fever after a hospital stay could indicate an infection.",
    actions: [
      "Take your temperature",
      "📞 Call your doctor if temp is over 100.4°F (38°C)",
      "Rest and stay hydrated",
    ],
  },
  confusion: {
    urgencyLevel: "call_doctor_today",
    message:
      "Confusion can be a sign of medication effects or other issues that need attention.",
    actions: [
      "Have someone stay with you",
      "📞 Call your doctor today",
      "Check blood sugar if diabetic",
      "Review all medications with your doctor",
    ],
  },
};

/**
 * Medical term explanations
 */
const MEDICAL_TERMS: Record<string, string> = {
  hypertension:
    "This is the medical word for high blood pressure. It means the force of blood pushing against your artery walls is too high.",
  diabetes:
    "A condition where your body has trouble controlling blood sugar levels. This can be managed with diet, exercise, and medication.",
  "heart failure":
    "This doesn't mean your heart has stopped working. It means your heart isn't pumping as well as it should, and may need help from medications.",
  atrial_fibrillation:
    "Sometimes called 'AFib' - this means your heart beats with an irregular rhythm. It can increase risk of blood clots, which is why blood thinners may be prescribed.",
  inr: "This stands for International Normalized Ratio. It's a blood test that shows how well your blood clots, important if you take blood thinners like Warfarin.",
  edema: "This is the medical term for swelling, usually in the legs and feet, caused by fluid buildup.",
  anticoagulant:
    "This is another word for blood thinner - a medication that helps prevent blood clots.",
  diuretic:
    "This is a 'water pill' - a medication that helps your body get rid of extra fluid through urination.",
  "beta blocker":
    "A type of medication that slows your heart rate and lowers blood pressure. Examples include metoprolol and atenolol.",
  "ace inhibitor":
    "A type of blood pressure medication that relaxes blood vessels. Examples include lisinopril and enalapril.",
  echocardiogram:
    "An ultrasound of your heart. It uses sound waves to create a picture of how your heart is pumping.",
  ejection_fraction:
    "A measurement of how much blood your heart pumps out with each beat. Normal is usually 55-70%.",
  creatinine:
    "A blood test that shows how well your kidneys are working. Higher numbers may mean your kidneys need attention.",
  hemoglobin_a1c:
    "A blood test that shows your average blood sugar over the past 2-3 months. It's used to monitor diabetes control.",
  prognosis:
    "This is your doctor's prediction about how your condition will progress and what to expect.",
  chronic: "This means a condition that lasts a long time or keeps coming back. It doesn't mean it can't be managed!",
  acute: "This means something that comes on suddenly or is severe but usually short-term.",
  benign: "This means not harmful or cancerous. Good news!",
  malignant: "This usually refers to cancer that can spread. Your doctor will explain treatment options.",
};

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
 * Look up medication information
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

  // Look up in our knowledge base
  let info = MEDICATION_INFO[normalizedName];

  // Try partial matches
  if (!info) {
    for (const [key, value] of Object.entries(MEDICATION_INFO)) {
      if (normalizedName.includes(key) || key.includes(normalizedName)) {
        info = value;
        break;
      }
    }
  }

  if (info) {
    return {
      toolName: "lookupMedication",
      result: {
        medicationName,
        isPatientMedication: !!patientMed,
        patientDose: patientMed?.dose,
        patientFrequency: patientMed?.frequency,
        ...info,
      },
      success: true,
    };
  }

  // Medication not in our knowledge base - return generic info
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
    },
    success: true,
  };
}

/**
 * Check symptom urgency
 */
async function executeCheckSymptom(
  symptom: string,
  severity: string,
  patient: Patient,
  analysis: DischargeAnalysis | null
): Promise<ToolCallResult> {
  const normalizedSymptom = symptom.toLowerCase().trim();

  // Check for exact or partial matches in urgency guidelines
  let urgencyInfo = SYMPTOM_URGENCY[normalizedSymptom];

  if (!urgencyInfo) {
    for (const [key, value] of Object.entries(SYMPTOM_URGENCY)) {
      if (normalizedSymptom.includes(key) || key.includes(normalizedSymptom)) {
        urgencyInfo = value;
        break;
      }
    }
  }

  // Check if symptom could be related to patient's medications
  const possibleMedicationCause = patient.medications.find((m) => {
    const medName = m.name.toLowerCase();
    // Check for common medication-symptom relationships
    if (normalizedSymptom.includes("dizz") && ["lisinopril", "metoprolol", "amlodipine", "furosemide"].some((d) => medName.includes(d))) {
      return true;
    }
    if (normalizedSymptom.includes("bleed") && ["warfarin", "aspirin", "eliquis", "plavix"].some((d) => medName.includes(d))) {
      return true;
    }
    if (normalizedSymptom.includes("nausea") && ["metformin"].some((d) => medName.includes(d))) {
      return true;
    }
    return false;
  });

  // Elevate urgency for severe symptoms
  if (severity === "severe" && urgencyInfo) {
    if (urgencyInfo.urgencyLevel === "monitor") {
      urgencyInfo = { ...urgencyInfo, urgencyLevel: "call_doctor_today" };
    } else if (urgencyInfo.urgencyLevel === "call_doctor_soon") {
      urgencyInfo = { ...urgencyInfo, urgencyLevel: "call_doctor_today" };
    }
  }

  if (urgencyInfo) {
    return {
      toolName: "checkSymptom",
      result: {
        symptom,
        severity,
        ...urgencyInfo,
        possibleMedicationRelated: possibleMedicationCause?.name || null,
        relatedRiskFactors:
          analysis?.riskFactors
            .filter(
              (rf) =>
                rf.description.toLowerCase().includes(normalizedSymptom) ||
                normalizedSymptom.includes(rf.title.toLowerCase())
            )
            .map((rf) => rf.title) || [],
      },
      success: true,
    };
  }

  // Unknown symptom - default guidance
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
      possibleMedicationRelated: null,
    },
    success: true,
  };
}

/**
 * Explain a medical term
 */
async function executeExplainMedicalTerm(term: string): Promise<ToolCallResult> {
  const normalizedTerm = term.toLowerCase().trim().replace(/[^a-z0-9]/g, "_");

  let explanation = MEDICAL_TERMS[normalizedTerm];

  // Try partial matches
  if (!explanation) {
    for (const [key, value] of Object.entries(MEDICAL_TERMS)) {
      if (
        normalizedTerm.includes(key.replace(/_/g, "")) ||
        key.replace(/_/g, "").includes(normalizedTerm.replace(/_/g, ""))
      ) {
        explanation = value;
        break;
      }
    }
  }

  if (explanation) {
    return {
      toolName: "explainMedicalTerm",
      result: {
        term,
        explanation,
      },
      success: true,
    };
  }

  // Term not found
  return {
    toolName: "explainMedicalTerm",
    result: {
      term,
      explanation:
        "I don't have a simple explanation for this term in my knowledge base. Please ask your nurse or doctor to explain it in simple words - they're happy to help!",
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
