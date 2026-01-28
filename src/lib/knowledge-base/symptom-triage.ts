/**
 * Symptom Triage Database - Serverless Compatible
 *
 * Simulates clinical triage protocols (Schmitt-Thompson style)
 * Bundled as static data for Vercel deployment - no external DB required
 *
 * Triage levels:
 * - Emergency (911): Life-threatening, immediate attention needed
 * - Urgent (ER/Urgent Care): Needs evaluation within hours
 * - Same-day (Call Doctor): Should be seen today
 * - Routine (Schedule): Can wait for regular appointment
 * - Self-care: Can be managed at home with guidance
 */

export interface TriageProtocol {
  symptom: string;
  alternativeNames: string[];
  category: "cardiovascular" | "respiratory" | "neurological" | "gastrointestinal" | "musculoskeletal" | "general" | "psychiatric";
  defaultUrgency: TriageLevel;
  redFlags: RedFlag[];
  assessmentQuestions: AssessmentQuestion[];
  selfCareGuidance: string[];
  whenToSeekCare: string[];
  commonCauses: string[];
  medicationConsiderations: MedicationConsideration[];
}

export type TriageLevel = "emergency" | "urgent" | "same_day" | "routine" | "self_care";

export interface RedFlag {
  condition: string;
  indicatesUrgency: TriageLevel;
  patientFriendlyDescription: string;
  actionRequired: string;
}

export interface AssessmentQuestion {
  question: string;
  yesIndicates: TriageLevel;
  rationale: string;
}

export interface MedicationConsideration {
  medication: string;
  concern: string;
  recommendation: string;
}

/**
 * Comprehensive symptom triage database
 * Structure based on Schmitt-Thompson Adult Telephone Protocols
 */
export const SYMPTOM_TRIAGE: Record<string, TriageProtocol> = {
  // ===== CARDIOVASCULAR SYMPTOMS =====
  chest_pain: {
    symptom: "Chest Pain",
    alternativeNames: ["chest discomfort", "chest pressure", "chest tightness", "angina"],
    category: "cardiovascular",
    defaultUrgency: "urgent",
    redFlags: [
      {
        condition: "Pain with shortness of breath, sweating, or nausea",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "These could be signs of a heart attack",
        actionRequired: "Call 911 immediately. Chew aspirin 325mg if not allergic.",
      },
      {
        condition: "Pain radiating to arm, jaw, or back",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Pain spreading to these areas is a warning sign of heart attack",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "History of heart disease with new or different chest pain",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "New patterns of chest pain in someone with heart disease needs immediate evaluation",
        actionRequired: "Call 911 or go to ER immediately.",
      },
      {
        condition: "Chest pain with palpitations or fainting",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could indicate dangerous heart rhythm",
        actionRequired: "Call 911.",
      },
    ],
    assessmentQuestions: [
      { question: "Is the pain worse with breathing or movement?", yesIndicates: "same_day", rationale: "May suggest musculoskeletal cause, but still needs evaluation" },
      { question: "Do you have a history of GERD or heartburn?", yesIndicates: "same_day", rationale: "May be GI-related but cardiac must be ruled out" },
      { question: "Is this similar to previous episodes diagnosed as non-cardiac?", yesIndicates: "routine", rationale: "Known non-cardiac pattern" },
    ],
    selfCareGuidance: [
      "If mild and clearly related to muscle strain: rest, ice, OTC pain relievers",
      "For heartburn: try antacids if previously diagnosed with GERD",
      "Never ignore new or different chest pain",
    ],
    whenToSeekCare: [
      "🚨 Call 911: Any chest pain with shortness of breath, sweating, nausea, or arm/jaw pain",
      "🚨 Call 911: Crushing or squeezing chest pain",
      "📞 Call doctor today: Mild chest pain that's new or different",
      "📞 Call doctor today: Chest pain that doesn't go away with rest",
    ],
    commonCauses: ["Heart disease/angina", "Heart attack", "GERD/acid reflux", "Muscle strain", "Anxiety", "Pulmonary embolism", "Pneumonia"],
    medicationConsiderations: [
      { medication: "Blood thinners", concern: "If on anticoagulation, chest pain could indicate bleeding", recommendation: "Seek immediate evaluation" },
      { medication: "Nitrates", concern: "If prescribed nitro, try per instructions for angina", recommendation: "If no relief after 3 doses, call 911" },
    ],
  },

  shortness_of_breath: {
    symptom: "Shortness of Breath",
    alternativeNames: ["dyspnea", "difficulty breathing", "breathless", "can't catch breath", "winded"],
    category: "respiratory",
    defaultUrgency: "urgent",
    redFlags: [
      {
        condition: "Sudden onset at rest",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Sudden difficulty breathing when not exerting yourself is serious",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "Associated with chest pain",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could indicate heart attack or pulmonary embolism",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "Lips or fingernails turning blue",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Blue color indicates low oxygen - life threatening",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "Can't speak in full sentences",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Severe respiratory distress",
        actionRequired: "Call 911.",
      },
      {
        condition: "History of heart failure with worsening symptoms",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Could indicate fluid buildup or heart failure worsening",
        actionRequired: "Go to ER or call doctor immediately.",
      },
    ],
    assessmentQuestions: [
      { question: "Did this come on suddenly?", yesIndicates: "emergency", rationale: "Sudden onset more concerning for PE or cardiac event" },
      { question: "Is it worse when lying flat?", yesIndicates: "urgent", rationale: "Orthopnea suggests heart failure" },
      { question: "Do you have a fever or cough?", yesIndicates: "same_day", rationale: "May indicate pneumonia" },
      { question: "Is this your usual level of breathlessness with activity?", yesIndicates: "routine", rationale: "Stable chronic condition" },
    ],
    selfCareGuidance: [
      "Sit upright - this helps breathing",
      "Use pursed-lip breathing: breathe in through nose, out slowly through pursed lips",
      "Use rescue inhaler if prescribed and this is asthma/COPD flare",
      "Stay calm - anxiety worsens breathing difficulty",
    ],
    whenToSeekCare: [
      "🚨 Call 911: Can't speak in full sentences, lips turning blue, severe distress",
      "🚨 Call 911: Sudden shortness of breath at rest with chest pain",
      "⚡ Go to ER: Worsening despite rescue inhaler, new swelling in legs",
      "📞 Call doctor today: Gradually worsening over days, fever with shortness of breath",
    ],
    commonCauses: ["Asthma", "COPD exacerbation", "Heart failure", "Pneumonia", "Anxiety/panic", "Pulmonary embolism", "Anemia"],
    medicationConsiderations: [
      { medication: "Beta blockers", concern: "May worsen bronchospasm in asthma/COPD", recommendation: "Discuss with doctor if new breathing problems" },
      { medication: "Diuretics", concern: "May indicate need for dose adjustment if heart failure", recommendation: "Weigh daily, call if >3 lbs gained overnight" },
    ],
  },

  dizziness: {
    symptom: "Dizziness",
    alternativeNames: ["lightheaded", "vertigo", "dizzy", "unsteady", "room spinning", "off balance"],
    category: "neurological",
    defaultUrgency: "same_day",
    redFlags: [
      {
        condition: "With sudden severe headache",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could indicate stroke or brain bleed",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "With weakness or numbness on one side",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "These are stroke warning signs",
        actionRequired: "Call 911 - think FAST: Face drooping, Arm weakness, Speech difficulty, Time to call 911.",
      },
      {
        condition: "With slurred speech or vision changes",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Stroke warning signs",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "After head injury",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "May indicate concussion or brain injury",
        actionRequired: "Go to ER for evaluation.",
      },
      {
        condition: "With chest pain or palpitations",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "May indicate heart problem",
        actionRequired: "Seek immediate evaluation.",
      },
    ],
    assessmentQuestions: [
      { question: "Does the room seem to spin?", yesIndicates: "same_day", rationale: "Vertigo - inner ear or brain involvement" },
      { question: "Do you feel faint, like you might pass out?", yesIndicates: "same_day", rationale: "Pre-syncope needs evaluation" },
      { question: "Does it happen when you stand up?", yesIndicates: "same_day", rationale: "Orthostatic hypotension - may be medication-related" },
      { question: "Have you actually fainted?", yesIndicates: "urgent", rationale: "Syncope requires cardiac and neurological evaluation" },
    ],
    selfCareGuidance: [
      "Sit or lie down immediately when dizzy to prevent falls",
      "Get up slowly from sitting or lying - sit on edge of bed first",
      "Stay hydrated - dehydration is a common cause",
      "Avoid sudden head movements if vertigo",
      "Don't drive while experiencing dizziness",
    ],
    whenToSeekCare: [
      "🚨 Call 911: Dizziness with weakness on one side, speech changes, worst headache",
      "⚡ Go to ER: After fainting, with chest pain, after head injury",
      "📞 Call doctor today: New dizziness, dizziness that doesn't resolve",
      "📅 Schedule visit: Occasional mild dizziness with position changes",
    ],
    commonCauses: ["Dehydration", "Medication side effect", "Low blood pressure", "Inner ear problems (BPPV, vestibular)", "Anemia", "Blood sugar changes", "Anxiety"],
    medicationConsiderations: [
      { medication: "Blood pressure medications", concern: "Common cause of orthostatic dizziness", recommendation: "Check BP sitting and standing, report to doctor" },
      { medication: "Diuretics", concern: "May cause dehydration and electrolyte imbalance", recommendation: "Ensure adequate fluid intake" },
      { medication: "Diabetes medications", concern: "Low blood sugar can cause dizziness", recommendation: "Check blood sugar if diabetic" },
      { medication: "Sedatives/sleep aids", concern: "Can cause dizziness and fall risk", recommendation: "Use caution, especially at night" },
    ],
  },

  nausea_vomiting: {
    symptom: "Nausea and Vomiting",
    alternativeNames: ["nausea", "vomiting", "throwing up", "sick to stomach", "queasy"],
    category: "gastrointestinal",
    defaultUrgency: "same_day",
    redFlags: [
      {
        condition: "Vomiting blood or coffee-ground material",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could indicate GI bleeding",
        actionRequired: "Call 911 or go to ER immediately.",
      },
      {
        condition: "Severe abdominal pain",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "May indicate serious abdominal condition",
        actionRequired: "Go to ER.",
      },
      {
        condition: "Signs of dehydration (no urine for 8+ hours, very dry mouth)",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Severe dehydration is dangerous",
        actionRequired: "Seek medical care for IV fluids.",
      },
      {
        condition: "After head injury",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "May indicate brain injury",
        actionRequired: "Go to ER.",
      },
      {
        condition: "With severe headache and stiff neck",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could be meningitis",
        actionRequired: "Call 911.",
      },
    ],
    assessmentQuestions: [
      { question: "Can you keep any liquids down?", yesIndicates: "self_care", rationale: "If tolerating sips, can try home management" },
      { question: "Is there blood in the vomit?", yesIndicates: "emergency", rationale: "GI bleeding" },
      { question: "Have you missed doses of important medications?", yesIndicates: "same_day", rationale: "May need alternative administration" },
    ],
    selfCareGuidance: [
      "Sip clear fluids slowly - water, clear broth, electrolyte drinks",
      "Avoid solid food until vomiting stops for several hours",
      "Try BRAT diet when ready: Bananas, Rice, Applesauce, Toast",
      "Rest in a propped-up position",
      "Avoid strong odors",
    ],
    whenToSeekCare: [
      "🚨 Call 911: Vomiting blood, with severe headache and stiff neck",
      "⚡ Go to ER: Can't keep any fluids down for 24 hours, signs of dehydration",
      "📞 Call doctor today: Can't take important medications, diabetes and can't eat",
      "📅 Schedule: Occasional nausea, mild symptoms resolving",
    ],
    commonCauses: ["Viral gastroenteritis", "Food poisoning", "Medication side effect", "Migraine", "Motion sickness", "Pregnancy", "GI obstruction"],
    medicationConsiderations: [
      { medication: "NSAIDs", concern: "Can irritate stomach and cause nausea", recommendation: "Take with food or consider stopping temporarily" },
      { medication: "Metformin", concern: "GI upset is common, especially when starting", recommendation: "Usually improves with time; take with food" },
      { medication: "Antibiotics", concern: "Common cause of nausea", recommendation: "Take with food unless directed otherwise" },
      { medication: "Opioids", concern: "Very common side effect", recommendation: "Anti-nausea medication may be needed" },
    ],
  },

  headache: {
    symptom: "Headache",
    alternativeNames: ["head pain", "migraine", "tension headache", "head hurts"],
    category: "neurological",
    defaultUrgency: "routine",
    redFlags: [
      {
        condition: "Sudden severe headache - 'worst headache of life'",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could be brain aneurysm or bleed",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "With fever and stiff neck",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could be meningitis",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "With confusion or altered consciousness",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Brain involvement",
        actionRequired: "Call 911.",
      },
      {
        condition: "After head trauma",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "May indicate brain injury",
        actionRequired: "Go to ER.",
      },
      {
        condition: "With vision changes or weakness",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Could indicate stroke or serious neurological problem",
        actionRequired: "Seek immediate evaluation.",
      },
      {
        condition: "New headache pattern in patient over 50",
        indicatesUrgency: "same_day",
        patientFriendlyDescription: "New headaches in older adults need prompt evaluation",
        actionRequired: "Call doctor today.",
      },
    ],
    assessmentQuestions: [
      { question: "Is this the worst headache of your life?", yesIndicates: "emergency", rationale: "Thunderclap headache - possible SAH" },
      { question: "Do you have a fever?", yesIndicates: "same_day", rationale: "May indicate infection" },
      { question: "Is this similar to your usual headaches?", yesIndicates: "routine", rationale: "Known headache pattern" },
      { question: "Are you on blood thinners?", yesIndicates: "urgent", rationale: "Increased risk of intracranial bleeding" },
    ],
    selfCareGuidance: [
      "Rest in a quiet, dark room",
      "Apply cold or warm compress to forehead or neck",
      "Try OTC pain relievers (acetaminophen, ibuprofen) if not contraindicated",
      "Stay hydrated",
      "Practice relaxation techniques for tension headaches",
    ],
    whenToSeekCare: [
      "🚨 Call 911: Sudden severe headache, with fever and stiff neck, confusion",
      "⚡ Go to ER: After head injury, with vision changes or weakness",
      "📞 Call doctor today: Headache with fever, new type of headache",
      "📅 Schedule: Frequent headaches interfering with daily life",
    ],
    commonCauses: ["Tension headache", "Migraine", "Cluster headache", "Dehydration", "Caffeine withdrawal", "Sinus problems", "Medication overuse"],
    medicationConsiderations: [
      { medication: "Blood thinners", concern: "Any new or severe headache needs evaluation", recommendation: "Seek prompt evaluation" },
      { medication: "Nitrates", concern: "Commonly cause headaches", recommendation: "Usually improves with continued use" },
      { medication: "Overuse of pain relievers", concern: "Can cause rebound headaches", recommendation: "Limit OTC pain reliever use to <15 days/month" },
    ],
  },

  swelling_legs: {
    symptom: "Leg Swelling",
    alternativeNames: ["edema", "swollen legs", "swollen ankles", "puffy feet", "fluid retention"],
    category: "cardiovascular",
    defaultUrgency: "same_day",
    redFlags: [
      {
        condition: "Sudden swelling in one leg with pain",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Could be blood clot (DVT)",
        actionRequired: "Go to ER immediately.",
      },
      {
        condition: "With shortness of breath",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Could indicate heart failure or pulmonary embolism",
        actionRequired: "Seek immediate evaluation.",
      },
      {
        condition: "Rapid weight gain (>3 lbs overnight)",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Rapid fluid retention - heart failure concern",
        actionRequired: "Call doctor immediately or go to ER.",
      },
      {
        condition: "With fever or redness",
        indicatesUrgency: "same_day",
        patientFriendlyDescription: "Could be infection (cellulitis)",
        actionRequired: "See doctor today.",
      },
    ],
    assessmentQuestions: [
      { question: "Is only one leg swollen?", yesIndicates: "urgent", rationale: "Asymmetric swelling suggests DVT" },
      { question: "Is the swelling painful?", yesIndicates: "urgent", rationale: "Pain with swelling increases DVT concern" },
      { question: "Have you been sitting for long periods (travel)?", yesIndicates: "urgent", rationale: "Increased DVT risk" },
      { question: "Do you have heart failure?", yesIndicates: "same_day", rationale: "May indicate worsening heart function" },
    ],
    selfCareGuidance: [
      "Elevate legs above heart level when possible",
      "Reduce salt intake",
      "Wear compression stockings if recommended",
      "Weigh yourself daily if you have heart failure",
      "Avoid sitting or standing for prolonged periods",
      "Walk regularly to promote circulation",
    ],
    whenToSeekCare: [
      "🚨 Go to ER: Sudden swelling in one leg with pain, especially after travel",
      "⚡ Call doctor immediately: With shortness of breath, rapid weight gain",
      "📞 Call doctor today: Increasing swelling over days, with redness or fever",
      "📅 Schedule: Mild swelling at end of day that resolves overnight",
    ],
    commonCauses: ["Heart failure", "Kidney disease", "Liver disease", "DVT (blood clot)", "Medication side effect", "Venous insufficiency", "Prolonged sitting/standing"],
    medicationConsiderations: [
      { medication: "Calcium channel blockers (amlodipine)", concern: "Very commonly cause ankle swelling", recommendation: "Report to doctor - may need medication change" },
      { medication: "NSAIDs", concern: "Can cause fluid retention and worsen heart failure", recommendation: "Avoid if possible in heart failure" },
      { medication: "Diuretics", concern: "If on diuretics and swelling worsens, may need adjustment", recommendation: "Don't adjust dose yourself - call doctor" },
    ],
  },

  fever: {
    symptom: "Fever",
    alternativeNames: ["high temperature", "febrile", "feeling hot", "chills"],
    category: "general",
    defaultUrgency: "same_day",
    redFlags: [
      {
        condition: "Temperature >103°F (39.4°C)",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "High fever needs evaluation",
        actionRequired: "Seek medical care.",
      },
      {
        condition: "With stiff neck and headache",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could be meningitis",
        actionRequired: "Call 911.",
      },
      {
        condition: "With confusion or altered mental status",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Sign of serious infection",
        actionRequired: "Call 911.",
      },
      {
        condition: "In immunocompromised patient",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Higher risk of serious infection",
        actionRequired: "Seek immediate evaluation.",
      },
      {
        condition: "After recent surgery or hospitalization",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Could indicate post-operative infection",
        actionRequired: "Call your surgeon or go to ER.",
      },
    ],
    assessmentQuestions: [
      { question: "Are you on chemotherapy or immunosuppressants?", yesIndicates: "urgent", rationale: "High infection risk population" },
      { question: "Have you recently had surgery?", yesIndicates: "urgent", rationale: "Post-op infection" },
      { question: "Do you have a cough with colored sputum?", yesIndicates: "same_day", rationale: "May indicate pneumonia" },
      { question: "Do you have painful urination?", yesIndicates: "same_day", rationale: "May indicate UTI" },
    ],
    selfCareGuidance: [
      "Take acetaminophen or ibuprofen as directed for comfort",
      "Stay well hydrated - water, clear fluids, electrolyte drinks",
      "Rest",
      "Use light clothing and bedding",
      "Monitor temperature every 4-6 hours",
    ],
    whenToSeekCare: [
      "🚨 Call 911: With stiff neck and severe headache, confusion, difficulty breathing",
      "⚡ Go to ER: Temperature >103°F, immunocompromised, post-surgery",
      "📞 Call doctor today: Fever >101°F lasting >3 days, with new cough",
      "📅 Self-care: Low-grade fever (<101°F) with mild cold symptoms in otherwise healthy adult",
    ],
    commonCauses: ["Viral infection", "Bacterial infection", "UTI", "Pneumonia", "Medication reaction", "Autoimmune conditions"],
    medicationConsiderations: [
      { medication: "Immunosuppressants", concern: "Even low-grade fever may indicate serious infection", recommendation: "Lower threshold to seek care" },
      { medication: "Chemotherapy", concern: "Neutropenic fever is a medical emergency", recommendation: "Call oncologist immediately for any fever" },
      { medication: "Steroids", concern: "May mask signs of infection", recommendation: "Have lower threshold for concern" },
    ],
  },

  bleeding: {
    symptom: "Bleeding or Easy Bruising",
    alternativeNames: ["bruising", "blood in stool", "blood in urine", "bleeding gums", "nosebleed"],
    category: "general",
    defaultUrgency: "same_day",
    redFlags: [
      {
        condition: "Heavy or uncontrolled bleeding",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Significant blood loss is dangerous",
        actionRequired: "Call 911. Apply direct pressure.",
      },
      {
        condition: "Vomiting blood",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Internal GI bleeding",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "Black, tarry stools",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "Indicates GI bleeding",
        actionRequired: "Go to ER.",
      },
      {
        condition: "Blood in urine while on blood thinners",
        indicatesUrgency: "urgent",
        patientFriendlyDescription: "May indicate significant bleeding",
        actionRequired: "Contact doctor immediately or go to ER.",
      },
      {
        condition: "Severe headache with bruising/bleeding",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could indicate intracranial bleeding",
        actionRequired: "Call 911.",
      },
    ],
    assessmentQuestions: [
      { question: "Are you on blood thinners?", yesIndicates: "same_day", rationale: "Bleeding more significant on anticoagulation" },
      { question: "Is the bleeding heavy or hard to stop?", yesIndicates: "urgent", rationale: "May need intervention" },
      { question: "Do you have blood in your stool or urine?", yesIndicates: "urgent", rationale: "Internal bleeding" },
      { question: "Is this a new symptom?", yesIndicates: "same_day", rationale: "New bleeding needs evaluation" },
    ],
    selfCareGuidance: [
      "For minor cuts: Apply direct pressure for 10-15 minutes",
      "For nosebleeds: Pinch soft part of nose, lean forward, hold 10 minutes",
      "Ice packs for bruising",
      "If on blood thinners: longer pressure may be needed",
    ],
    whenToSeekCare: [
      "🚨 Call 911: Heavy bleeding that won't stop, vomiting blood, severe headache",
      "⚡ Go to ER: Black/tarry stools, large amount of blood in urine",
      "📞 Call doctor today: Easy bruising, blood in urine or stool (small amounts), frequent nosebleeds",
      "📅 Schedule: Occasional minor bruising, minor gum bleeding when brushing",
    ],
    commonCauses: ["Anticoagulant medication", "Blood disorders", "Liver disease", "Vitamin deficiency", "Trauma", "GI conditions"],
    medicationConsiderations: [
      { medication: "Warfarin", concern: "All bleeding needs attention - may indicate high INR", recommendation: "Check INR, contact provider" },
      { medication: "DOACs (Eliquis, Xarelto)", concern: "No routine monitoring but bleeding still concerning", recommendation: "Contact provider for any significant bleeding" },
      { medication: "Aspirin", concern: "Increases bleeding risk", recommendation: "May need to hold for procedures" },
      { medication: "NSAIDs", concern: "Can cause GI bleeding", recommendation: "May need to stop if GI bleeding" },
    ],
  },

  confusion: {
    symptom: "Confusion or Altered Mental Status",
    alternativeNames: ["confused", "disoriented", "not acting right", "memory problems", "delirium"],
    category: "neurological",
    defaultUrgency: "urgent",
    redFlags: [
      {
        condition: "Sudden onset confusion",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could be stroke, infection, or metabolic emergency",
        actionRequired: "Call 911 immediately.",
      },
      {
        condition: "With fever",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "May indicate serious infection",
        actionRequired: "Call 911.",
      },
      {
        condition: "After head injury",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "May indicate brain injury",
        actionRequired: "Call 911.",
      },
      {
        condition: "In diabetic patient",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Could be low or high blood sugar",
        actionRequired: "Check blood sugar if possible. Call 911 if unable to check or treat.",
      },
      {
        condition: "With one-sided weakness or speech changes",
        indicatesUrgency: "emergency",
        patientFriendlyDescription: "Signs of stroke",
        actionRequired: "Call 911 - think FAST.",
      },
    ],
    assessmentQuestions: [
      { question: "Did this come on suddenly?", yesIndicates: "emergency", rationale: "Sudden change indicates acute problem" },
      { question: "Is the person diabetic?", yesIndicates: "emergency", rationale: "Hypoglycemia or DKA" },
      { question: "Is there a fever?", yesIndicates: "emergency", rationale: "Possible infection/sepsis" },
      { question: "Are there any new medications?", yesIndicates: "urgent", rationale: "Drug effect or interaction" },
    ],
    selfCareGuidance: [
      "If diabetic: check blood sugar and treat if low",
      "Ensure safety - prevent falls",
      "Do not leave confused person alone",
      "Note timeline and symptoms to report to medical team",
    ],
    whenToSeekCare: [
      "🚨 Call 911: Any sudden confusion, with fever, after head injury, in diabetic",
      "🚨 Call 911: With weakness on one side, speech problems, severe headache",
      "⚡ Go to ER: New confusion in elderly person",
      "📞 Call doctor today: Gradual mild memory changes",
    ],
    commonCauses: ["Infection/sepsis", "Stroke", "Low/high blood sugar", "Medication effect", "Electrolyte imbalance", "Dehydration", "UTI (in elderly)", "Hypoxia"],
    medicationConsiderations: [
      { medication: "Sedatives/sleep aids", concern: "Common cause of confusion in elderly", recommendation: "Review all medications with doctor" },
      { medication: "Anticholinergics", concern: "Can cause confusion, especially in elderly", recommendation: "May need to stop or change" },
      { medication: "Opioids", concern: "Can cause confusion and sedation", recommendation: "Assess dose and necessity" },
      { medication: "New medications", concern: "Any new drug can potentially cause confusion", recommendation: "Report all recent medication changes" },
    ],
  },
};

/**
 * Get triage recommendation for a symptom
 */
export function getSymptomTriage(symptom: string): TriageProtocol | null {
  const normalized = symptom.toLowerCase().trim().replace(/\s+/g, "_");

  // Direct match
  if (SYMPTOM_TRIAGE[normalized]) {
    return SYMPTOM_TRIAGE[normalized];
  }

  // Search by name and alternative names
  for (const [key, protocol] of Object.entries(SYMPTOM_TRIAGE)) {
    if (
      key.includes(normalized) ||
      normalized.includes(key.replace(/_/g, " ")) ||
      protocol.symptom.toLowerCase().includes(normalized.replace(/_/g, " ")) ||
      protocol.alternativeNames.some(
        (alt) =>
          alt.toLowerCase().includes(normalized.replace(/_/g, " ")) ||
          normalized.replace(/_/g, " ").includes(alt.toLowerCase())
      )
    ) {
      return protocol;
    }
  }

  return null;
}

/**
 * Assess symptom urgency with patient context
 */
export function assessSymptomUrgency(
  symptom: string,
  severity: "mild" | "moderate" | "severe",
  patientContext?: {
    age?: number;
    medications?: string[];
    conditions?: string[];
  }
): {
  urgencyLevel: TriageLevel;
  message: string;
  actions: string[];
  seekCareIf: string[];
  selfCare: string[];
} {
  const protocol = getSymptomTriage(symptom);

  if (!protocol) {
    // Default safe response for unknown symptoms
    return {
      urgencyLevel: severity === "severe" ? "urgent" : "same_day",
      message: `For ${symptom}, please contact your healthcare provider for guidance.`,
      actions: [
        severity === "severe"
          ? "🚨 Seek immediate medical attention for severe symptoms"
          : "📞 Contact your doctor today",
      ],
      seekCareIf: [
        "Symptoms worsen",
        "New concerning symptoms develop",
        "You're unsure about severity",
      ],
      selfCare: ["Rest", "Stay hydrated", "Monitor symptoms"],
    };
  }

  // Start with default urgency
  let urgencyLevel = protocol.defaultUrgency;

  // Escalate based on severity
  if (severity === "severe" && urgencyLevel === "routine") {
    urgencyLevel = "same_day";
  } else if (severity === "severe" && urgencyLevel === "same_day") {
    urgencyLevel = "urgent";
  }

  // Check patient-specific factors
  if (patientContext) {
    // Age-based escalation
    if (patientContext.age && patientContext.age > 75) {
      if (urgencyLevel === "routine") urgencyLevel = "same_day";
    }

    // Medication-based escalation
    if (patientContext.medications) {
      const onBloodThinners = patientContext.medications.some((m) =>
        ["warfarin", "eliquis", "apixaban", "xarelto", "rivaroxaban", "pradaxa", "dabigatran"].some((bt) =>
          m.toLowerCase().includes(bt)
        )
      );
      if (onBloodThinners && protocol.category === "cardiovascular") {
        if (urgencyLevel === "same_day") urgencyLevel = "urgent";
      }
    }

    // Condition-based escalation
    if (patientContext.conditions) {
      const hasHeartFailure = patientContext.conditions.some((c) =>
        c.toLowerCase().includes("heart failure")
      );
      if (hasHeartFailure && ["shortness_of_breath", "swelling_legs"].includes(symptom.replace(/\s/g, "_"))) {
        if (urgencyLevel === "same_day") urgencyLevel = "urgent";
      }
    }
  }

  // Build response
  const urgencyMessages: Record<TriageLevel, string> = {
    emergency: "🚨 EMERGENCY: Call 911 or go to the emergency room immediately.",
    urgent: "⚡ URGENT: Seek medical care now - go to ER or urgent care.",
    same_day: "📞 Call your doctor's office today for an appointment.",
    routine: "📅 Schedule an appointment with your doctor.",
    self_care: "🏠 You can likely manage this at home with self-care.",
  };

  return {
    urgencyLevel,
    message: urgencyMessages[urgencyLevel],
    actions: protocol.redFlags
      .filter((rf) => rf.indicatesUrgency === "emergency" || rf.indicatesUrgency === urgencyLevel)
      .slice(0, 2)
      .map((rf) => `${rf.patientFriendlyDescription}: ${rf.actionRequired}`),
    seekCareIf: protocol.whenToSeekCare.slice(0, 4),
    selfCare: protocol.selfCareGuidance.slice(0, 4),
  };
}
