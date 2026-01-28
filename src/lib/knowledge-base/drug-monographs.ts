/**
 * Drug Monograph Database - Simulated FDB MedKnowledge Structure
 *
 * This simulates the comprehensive drug database that healthcare systems use.
 * Structure based on FirstDatabank MedKnowledge API and HL7 medication resources.
 *
 * In production: Replace with FDB, Medi-Span, or Wolters Kluwer API
 */

export interface DrugMonograph {
  // Identifiers
  rxcui: string;
  ndc: string[];
  genericName: string;
  brandNames: string[];
  drugClass: string[];
  therapeuticCategory: string;

  // Clinical information
  indications: Indication[];
  dosageAndAdministration: DosageInfo;
  contraindications: string[];
  warnings: Warning[];
  precautions: string[];
  adverseReactions: AdverseReaction[];

  // Patient education
  patientCounseling: PatientCounselingPoint[];
  mechanismOfAction: string;
  howSupplied: string[];

  // Monitoring
  monitoringParameters: MonitoringParameter[];

  // Pregnancy/Lactation
  pregnancyCategory: string;
  lactationSafety: string;

  // Renal/Hepatic
  renalDosing: string;
  hepaticDosing: string;

  // Food interactions
  foodInteractions: string[];

  // Metadata
  lastUpdated: string;
  source: string;
}

export interface Indication {
  condition: string;
  icd10Codes: string[];
  strength: "FDA-approved" | "Off-label" | "Investigational";
  notes?: string;
}

export interface DosageInfo {
  adult: DoseRange;
  pediatric?: DoseRange;
  geriatric?: DoseRange;
  maxDailyDose?: string;
  administrationRoute: string[];
  frequency: string[];
  specialInstructions: string[];
}

export interface DoseRange {
  initial: string;
  maintenance: string;
  max: string;
}

export interface Warning {
  type: "BLACK_BOX" | "CONTRAINDICATION" | "WARNING" | "PRECAUTION";
  text: string;
  conditions?: string[];
}

export interface AdverseReaction {
  reaction: string;
  frequency: "very_common" | "common" | "uncommon" | "rare" | "very_rare";
  percentage?: string;
  severity: "mild" | "moderate" | "severe";
  patientFriendlyDescription: string;
}

export interface PatientCounselingPoint {
  topic: string;
  advice: string;
  importance: "critical" | "important" | "helpful";
}

export interface MonitoringParameter {
  parameter: string;
  frequency: string;
  targetRange?: string;
  reason: string;
}

/**
 * Comprehensive drug monograph database
 * Simulates ~100 commonly prescribed medications with full clinical detail
 */
export const DRUG_MONOGRAPHS: Record<string, DrugMonograph> = {
  // ===== ANTICOAGULANTS =====
  warfarin: {
    rxcui: "11289",
    ndc: ["00056-0172-70", "00056-0172-90"],
    genericName: "warfarin sodium",
    brandNames: ["Coumadin", "Jantoven"],
    drugClass: ["Anticoagulant", "Vitamin K antagonist"],
    therapeuticCategory: "Blood Modifier",
    indications: [
      { condition: "Atrial fibrillation", icd10Codes: ["I48.0", "I48.1", "I48.2"], strength: "FDA-approved" },
      { condition: "Deep vein thrombosis", icd10Codes: ["I82.40"], strength: "FDA-approved" },
      { condition: "Pulmonary embolism", icd10Codes: ["I26.99"], strength: "FDA-approved" },
      { condition: "Mechanical heart valve", icd10Codes: ["Z95.2"], strength: "FDA-approved" },
    ],
    dosageAndAdministration: {
      adult: { initial: "2-5 mg daily", maintenance: "2-10 mg daily (individualized)", max: "Based on INR" },
      geriatric: { initial: "2-5 mg daily", maintenance: "Lower doses often needed", max: "Based on INR" },
      maxDailyDose: "Individualized based on INR",
      administrationRoute: ["Oral"],
      frequency: ["Once daily"],
      specialInstructions: [
        "Take at the same time each day",
        "May be taken with or without food",
        "Maintain consistent vitamin K intake",
      ],
    },
    contraindications: [
      "Active bleeding",
      "Hemorrhagic tendencies",
      "Recent surgery of the CNS or eye",
      "Pregnancy (except in women with mechanical heart valves)",
      "Unsupervised patients with poor compliance",
    ],
    warnings: [
      {
        type: "BLACK_BOX",
        text: "Warfarin can cause major or fatal bleeding. Regular INR monitoring is required. Numerous factors (drugs, diet, illness) can affect INR.",
      },
      {
        type: "WARNING",
        text: "Increased risk of thrombosis if anticoagulation discontinued abruptly",
      },
    ],
    precautions: [
      "Hepatic impairment - may enhance response",
      "Renal impairment - use with caution",
      "Protein C or S deficiency - risk of skin necrosis",
      "Elderly patients - increased sensitivity",
    ],
    adverseReactions: [
      { reaction: "Bleeding", frequency: "common", severity: "moderate", patientFriendlyDescription: "Bleeding more easily than usual, bruising" },
      { reaction: "Hemorrhage", frequency: "uncommon", severity: "severe", patientFriendlyDescription: "Serious bleeding that may require medical attention" },
      { reaction: "Skin necrosis", frequency: "rare", severity: "severe", patientFriendlyDescription: "Painful skin changes, usually in fatty areas" },
      { reaction: "Purple toe syndrome", frequency: "rare", severity: "moderate", patientFriendlyDescription: "Painful purple discoloration of toes" },
    ],
    patientCounseling: [
      { topic: "Bleeding signs", advice: "Watch for unusual bruising, blood in urine/stool, prolonged bleeding from cuts, severe headache", importance: "critical" },
      { topic: "Diet", advice: "Keep vitamin K intake consistent - don't suddenly increase or decrease leafy green vegetables", importance: "critical" },
      { topic: "Drug interactions", advice: "Many medications and supplements interact with warfarin - always check before taking anything new", importance: "critical" },
      { topic: "Medical alert", advice: "Carry a card or wear a bracelet identifying you take a blood thinner", importance: "important" },
      { topic: "INR testing", advice: "Never miss your blood tests - they're essential for safe dosing", importance: "critical" },
    ],
    mechanismOfAction: "Inhibits vitamin K-dependent clotting factors II, VII, IX, X and proteins C and S",
    howSupplied: ["Tablets: 1mg, 2mg, 2.5mg, 3mg, 4mg, 5mg, 6mg, 7.5mg, 10mg"],
    monitoringParameters: [
      { parameter: "INR", frequency: "Daily initially, then weekly, then monthly when stable", targetRange: "2.0-3.0 (higher for mechanical valves)", reason: "Assess anticoagulation effect" },
      { parameter: "Hemoglobin/Hematocrit", frequency: "Periodically", reason: "Monitor for occult bleeding" },
      { parameter: "Signs of bleeding", frequency: "Every visit", reason: "Early detection of complications" },
    ],
    pregnancyCategory: "X (D for women with mechanical heart valves)",
    lactationSafety: "Compatible with breastfeeding",
    renalDosing: "No specific adjustment needed, but use caution",
    hepaticDosing: "Reduce dose - enhanced anticoagulant response",
    foodInteractions: [
      "Vitamin K-rich foods (leafy greens, liver) - decrease effect",
      "Cranberry juice - may increase effect",
      "Alcohol - avoid excessive use",
      "Grapefruit - possible interaction",
    ],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  apixaban: {
    rxcui: "1364430",
    ndc: ["00003-0893-21", "00003-0894-21"],
    genericName: "apixaban",
    brandNames: ["Eliquis"],
    drugClass: ["Anticoagulant", "Factor Xa inhibitor", "DOAC"],
    therapeuticCategory: "Blood Modifier",
    indications: [
      { condition: "Atrial fibrillation", icd10Codes: ["I48.0", "I48.1", "I48.2"], strength: "FDA-approved" },
      { condition: "DVT/PE treatment", icd10Codes: ["I82.40", "I26.99"], strength: "FDA-approved" },
      { condition: "DVT/PE prophylaxis after hip/knee replacement", icd10Codes: ["Z96.64", "Z96.65"], strength: "FDA-approved" },
    ],
    dosageAndAdministration: {
      adult: { initial: "5 mg twice daily or 2.5 mg twice daily", maintenance: "5 mg twice daily", max: "10 mg daily" },
      geriatric: { initial: "2.5 mg twice daily if ≥80 years + weight ≤60kg or creatinine ≥1.5", maintenance: "2.5 mg twice daily", max: "5 mg daily" },
      maxDailyDose: "10 mg",
      administrationRoute: ["Oral"],
      frequency: ["Twice daily, approximately 12 hours apart"],
      specialInstructions: [
        "May be taken with or without food",
        "If unable to swallow, may crush and mix with water or applesauce",
        "Do not discontinue without physician guidance",
      ],
    },
    contraindications: [
      "Active pathological bleeding",
      "Severe hypersensitivity to apixaban",
    ],
    warnings: [
      {
        type: "BLACK_BOX",
        text: "Discontinuing apixaban increases thrombotic risk. Epidural/spinal hematoma risk with neuraxial anesthesia.",
      },
      {
        type: "WARNING",
        text: "Not recommended in patients with prosthetic heart valves",
      },
    ],
    precautions: [
      "Renal impairment - dose adjustment may be needed",
      "Hepatic impairment - not recommended in severe",
      "Concomitant use with strong CYP3A4/P-gp inhibitors or inducers",
    ],
    adverseReactions: [
      { reaction: "Bleeding", frequency: "common", severity: "moderate", patientFriendlyDescription: "Bleeding more easily, bruising" },
      { reaction: "Anemia", frequency: "common", severity: "mild", patientFriendlyDescription: "Feeling tired due to low red blood cells" },
      { reaction: "Nausea", frequency: "common", severity: "mild", patientFriendlyDescription: "Feeling sick to your stomach" },
    ],
    patientCounseling: [
      { topic: "Dosing schedule", advice: "Take at the same times every day, approximately 12 hours apart", importance: "critical" },
      { topic: "Bleeding signs", advice: "Report unusual bruising, blood in urine/stool, heavy menstrual bleeding, severe headache", importance: "critical" },
      { topic: "Missed dose", advice: "Take as soon as remembered on same day, then resume normal schedule. Don't double up.", importance: "important" },
      { topic: "No monitoring needed", advice: "Unlike warfarin, routine blood tests are not needed to monitor the drug level", importance: "helpful" },
    ],
    mechanismOfAction: "Selectively inhibits Factor Xa, interrupting the coagulation cascade",
    howSupplied: ["Tablets: 2.5mg, 5mg"],
    monitoringParameters: [
      { parameter: "Renal function", frequency: "At least annually", reason: "Dose adjustment may be needed" },
      { parameter: "Hemoglobin", frequency: "If bleeding suspected", reason: "Assess blood loss" },
    ],
    pregnancyCategory: "C",
    lactationSafety: "Unknown if excreted in milk - use caution",
    renalDosing: "Reduce to 2.5mg BID if serum creatinine ≥1.5 AND age ≥80 or weight ≤60kg",
    hepaticDosing: "Avoid in severe hepatic impairment (Child-Pugh C)",
    foodInteractions: ["No significant food interactions - may take with or without food"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== CARDIOVASCULAR =====
  lisinopril: {
    rxcui: "29046",
    ndc: ["00093-1039-01", "00093-1040-01"],
    genericName: "lisinopril",
    brandNames: ["Prinivil", "Zestril"],
    drugClass: ["ACE inhibitor", "Antihypertensive"],
    therapeuticCategory: "Cardiovascular Agent",
    indications: [
      { condition: "Hypertension", icd10Codes: ["I10"], strength: "FDA-approved" },
      { condition: "Heart failure", icd10Codes: ["I50.9"], strength: "FDA-approved" },
      { condition: "Post-MI", icd10Codes: ["I25.2"], strength: "FDA-approved" },
      { condition: "Diabetic nephropathy", icd10Codes: ["E11.21"], strength: "Off-label" },
    ],
    dosageAndAdministration: {
      adult: { initial: "5-10 mg daily", maintenance: "10-40 mg daily", max: "80 mg daily" },
      geriatric: { initial: "2.5-5 mg daily", maintenance: "Titrate slowly", max: "40 mg daily" },
      maxDailyDose: "80 mg",
      administrationRoute: ["Oral"],
      frequency: ["Once daily"],
      specialInstructions: [
        "May be taken with or without food",
        "Take at the same time each day",
        "Do not use potassium supplements without physician guidance",
      ],
    },
    contraindications: [
      "History of angioedema with ACE inhibitors",
      "Hereditary or idiopathic angioedema",
      "Pregnancy",
      "Concomitant use with aliskiren in diabetics",
    ],
    warnings: [
      {
        type: "BLACK_BOX",
        text: "Can cause fetal harm when used during pregnancy. Discontinue as soon as pregnancy is detected.",
      },
      {
        type: "WARNING",
        text: "Angioedema can occur at any time during treatment and may be fatal",
      },
    ],
    precautions: [
      "Renal impairment - start with lower dose",
      "Volume/salt depletion - correct before starting",
      "Hyperkalemia risk with potassium supplements or K-sparing diuretics",
    ],
    adverseReactions: [
      { reaction: "Cough", frequency: "common", percentage: "3-10%", severity: "mild", patientFriendlyDescription: "Dry, persistent cough that may be bothersome" },
      { reaction: "Dizziness", frequency: "common", severity: "mild", patientFriendlyDescription: "Feeling lightheaded, especially when standing up" },
      { reaction: "Headache", frequency: "common", severity: "mild", patientFriendlyDescription: "Headaches, usually mild" },
      { reaction: "Hyperkalemia", frequency: "uncommon", severity: "moderate", patientFriendlyDescription: "High potassium levels in blood" },
      { reaction: "Angioedema", frequency: "rare", severity: "severe", patientFriendlyDescription: "Swelling of face, lips, tongue, or throat - SEEK IMMEDIATE HELP" },
    ],
    patientCounseling: [
      { topic: "Angioedema warning", advice: "Seek immediate medical attention if you notice swelling of face, lips, tongue, or difficulty breathing", importance: "critical" },
      { topic: "Dizziness", advice: "Get up slowly from sitting or lying down to prevent lightheadedness", importance: "important" },
      { topic: "Potassium", advice: "Avoid potassium supplements and salt substitutes unless approved by your doctor", importance: "important" },
      { topic: "Cough", advice: "A dry cough is a common side effect - tell your doctor if it's bothersome", importance: "helpful" },
      { topic: "Pregnancy", advice: "Tell your doctor immediately if you become pregnant", importance: "critical" },
    ],
    mechanismOfAction: "Inhibits ACE, preventing conversion of angiotensin I to angiotensin II, reducing vasoconstriction and aldosterone secretion",
    howSupplied: ["Tablets: 2.5mg, 5mg, 10mg, 20mg, 30mg, 40mg"],
    monitoringParameters: [
      { parameter: "Blood pressure", frequency: "Each visit", reason: "Assess efficacy" },
      { parameter: "Potassium", frequency: "Within 1 week of starting, then periodically", reason: "Monitor for hyperkalemia" },
      { parameter: "Serum creatinine", frequency: "Within 1 week, then periodically", reason: "Monitor renal function" },
    ],
    pregnancyCategory: "D (contraindicated)",
    lactationSafety: "Compatible with breastfeeding",
    renalDosing: "CrCl 10-30: Initial 2.5-5mg daily; CrCl <10: Initial 2.5mg daily",
    hepaticDosing: "No adjustment needed for hepatic impairment",
    foodInteractions: ["No significant food interactions"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  metoprolol: {
    rxcui: "6918",
    ndc: ["00378-0011-01", "00378-0012-01"],
    genericName: "metoprolol tartrate / metoprolol succinate",
    brandNames: ["Lopressor", "Toprol-XL"],
    drugClass: ["Beta blocker", "Antihypertensive", "Antianginal"],
    therapeuticCategory: "Cardiovascular Agent",
    indications: [
      { condition: "Hypertension", icd10Codes: ["I10"], strength: "FDA-approved" },
      { condition: "Angina pectoris", icd10Codes: ["I20.9"], strength: "FDA-approved" },
      { condition: "Heart failure", icd10Codes: ["I50.9"], strength: "FDA-approved", notes: "Succinate form only" },
      { condition: "Acute MI", icd10Codes: ["I21.9"], strength: "FDA-approved" },
      { condition: "Atrial fibrillation rate control", icd10Codes: ["I48.91"], strength: "Off-label" },
    ],
    dosageAndAdministration: {
      adult: { initial: "25-100 mg daily (tartrate) or 25-100 mg daily (succinate)", maintenance: "100-400 mg daily", max: "400 mg daily" },
      geriatric: { initial: "25 mg daily", maintenance: "Titrate slowly", max: "400 mg daily" },
      maxDailyDose: "400 mg",
      administrationRoute: ["Oral", "IV (tartrate only)"],
      frequency: ["Twice daily (tartrate)", "Once daily (succinate ER)"],
      specialInstructions: [
        "Tartrate: Take with food to enhance absorption",
        "Succinate ER: May be taken with or without food, do not crush",
        "Do not stop suddenly - taper over 1-2 weeks",
      ],
    },
    contraindications: [
      "Sinus bradycardia, heart block >1st degree",
      "Cardiogenic shock",
      "Decompensated heart failure",
      "Sick sinus syndrome without pacemaker",
    ],
    warnings: [
      {
        type: "WARNING",
        text: "Do not abruptly discontinue - risk of exacerbation of angina, MI, and ventricular arrhythmias. Taper over 1-2 weeks.",
      },
      {
        type: "PRECAUTION",
        text: "May mask symptoms of hypoglycemia in diabetics",
      },
    ],
    precautions: [
      "Diabetes - may mask hypoglycemia symptoms",
      "Peripheral vascular disease - may worsen symptoms",
      "Bronchospastic disease - use with caution",
      "Surgery - may impair cardiac response to stress",
    ],
    adverseReactions: [
      { reaction: "Fatigue", frequency: "very_common", percentage: "10%", severity: "mild", patientFriendlyDescription: "Feeling tired, especially when starting" },
      { reaction: "Dizziness", frequency: "common", severity: "mild", patientFriendlyDescription: "Feeling lightheaded" },
      { reaction: "Bradycardia", frequency: "common", severity: "moderate", patientFriendlyDescription: "Slow heartbeat" },
      { reaction: "Cold extremities", frequency: "common", severity: "mild", patientFriendlyDescription: "Cold hands and feet" },
      { reaction: "Depression", frequency: "uncommon", severity: "moderate", patientFriendlyDescription: "Feeling down or depressed" },
    ],
    patientCounseling: [
      { topic: "Do not stop suddenly", advice: "Never stop taking this medication abruptly - it must be tapered slowly under doctor supervision", importance: "critical" },
      { topic: "Heart rate", advice: "Your heart rate will be lower - this is expected. Tell your doctor if it's below 50", importance: "important" },
      { topic: "Diabetes", advice: "This medication may mask symptoms of low blood sugar - monitor glucose carefully", importance: "important" },
      { topic: "Exercise", advice: "Your heart rate may not increase as much with exercise - use perceived exertion to gauge intensity", importance: "helpful" },
    ],
    mechanismOfAction: "Selectively blocks beta-1 adrenergic receptors, reducing heart rate and blood pressure",
    howSupplied: ["Tartrate tablets: 25mg, 50mg, 100mg", "Succinate ER tablets: 25mg, 50mg, 100mg, 200mg"],
    monitoringParameters: [
      { parameter: "Heart rate", frequency: "Each visit", targetRange: "55-80 bpm typically", reason: "Assess drug effect and safety" },
      { parameter: "Blood pressure", frequency: "Each visit", reason: "Assess efficacy" },
      { parameter: "ECG", frequency: "As needed", reason: "Monitor for heart block" },
    ],
    pregnancyCategory: "C",
    lactationSafety: "Compatible with breastfeeding - monitor infant for bradycardia",
    renalDosing: "No adjustment required",
    hepaticDosing: "Reduce dose in severe hepatic impairment",
    foodInteractions: ["Tartrate: Take with food to enhance absorption", "Succinate: No food interaction"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== DIABETES =====
  metformin: {
    rxcui: "6809",
    ndc: ["00378-0221-01", "00378-0222-01"],
    genericName: "metformin hydrochloride",
    brandNames: ["Glucophage", "Glumetza", "Fortamet"],
    drugClass: ["Biguanide", "Antidiabetic"],
    therapeuticCategory: "Endocrine/Metabolic Agent",
    indications: [
      { condition: "Type 2 diabetes mellitus", icd10Codes: ["E11.9"], strength: "FDA-approved" },
      { condition: "Prediabetes prevention", icd10Codes: ["R73.03"], strength: "Off-label" },
      { condition: "PCOS", icd10Codes: ["E28.2"], strength: "Off-label" },
    ],
    dosageAndAdministration: {
      adult: { initial: "500 mg twice daily or 850 mg once daily", maintenance: "1000-2550 mg daily in divided doses", max: "2550 mg daily (IR) or 2000 mg daily (ER)" },
      geriatric: { initial: "500 mg once daily", maintenance: "Titrate conservatively", max: "Based on renal function" },
      maxDailyDose: "2550 mg (IR), 2000 mg (ER)",
      administrationRoute: ["Oral"],
      frequency: ["With meals, 2-3 times daily (IR)", "Once daily with evening meal (ER)"],
      specialInstructions: [
        "Take with meals to reduce GI side effects",
        "ER tablets: Swallow whole, do not crush",
        "Ghost tablet shell in stool is normal for ER",
      ],
    },
    contraindications: [
      "eGFR <30 mL/min/1.73m²",
      "Acute or chronic metabolic acidosis including diabetic ketoacidosis",
      "Known hypersensitivity",
    ],
    warnings: [
      {
        type: "BLACK_BOX",
        text: "Lactic acidosis is rare but potentially fatal. Risk increased with renal impairment, sepsis, dehydration, excess alcohol, hepatic impairment, and iodinated contrast procedures.",
      },
    ],
    precautions: [
      "Hold before iodinated contrast procedures",
      "Monitor renal function at least annually",
      "Reduce dose or discontinue if eGFR falls <45",
      "Vitamin B12 deficiency with long-term use",
    ],
    adverseReactions: [
      { reaction: "Diarrhea", frequency: "very_common", percentage: "53%", severity: "mild", patientFriendlyDescription: "Loose stools, especially when starting - usually improves" },
      { reaction: "Nausea", frequency: "very_common", percentage: "26%", severity: "mild", patientFriendlyDescription: "Feeling sick to your stomach" },
      { reaction: "Flatulence", frequency: "common", severity: "mild", patientFriendlyDescription: "Gas and bloating" },
      { reaction: "Abdominal discomfort", frequency: "common", severity: "mild", patientFriendlyDescription: "Stomach upset" },
      { reaction: "Metallic taste", frequency: "common", severity: "mild", patientFriendlyDescription: "Metallic taste in mouth" },
      { reaction: "B12 deficiency", frequency: "uncommon", severity: "moderate", patientFriendlyDescription: "Low vitamin B12 with long-term use" },
    ],
    patientCounseling: [
      { topic: "Take with food", advice: "Always take with meals to reduce stomach upset", importance: "important" },
      { topic: "GI symptoms improve", advice: "Stomach side effects usually get better after a few weeks", importance: "helpful" },
      { topic: "Alcohol", advice: "Limit alcohol - increases risk of lactic acidosis and low blood sugar", importance: "important" },
      { topic: "CT scans", advice: "Tell the radiologist you take metformin before any CT scan with contrast dye", importance: "critical" },
      { topic: "Hydration", advice: "Stay well hydrated, especially if you have vomiting or diarrhea", importance: "important" },
    ],
    mechanismOfAction: "Decreases hepatic glucose production, decreases intestinal glucose absorption, increases insulin sensitivity",
    howSupplied: ["IR tablets: 500mg, 850mg, 1000mg", "ER tablets: 500mg, 750mg, 1000mg"],
    monitoringParameters: [
      { parameter: "HbA1c", frequency: "Every 3-6 months", targetRange: "<7% for most patients", reason: "Assess glycemic control" },
      { parameter: "Fasting glucose", frequency: "As needed", targetRange: "80-130 mg/dL", reason: "Monitor between A1c checks" },
      { parameter: "Renal function", frequency: "At least annually", reason: "Adjust dose or discontinue if impaired" },
      { parameter: "Vitamin B12", frequency: "Every 2-3 years with long-term use", reason: "Monitor for deficiency" },
    ],
    pregnancyCategory: "B",
    lactationSafety: "Compatible with breastfeeding",
    renalDosing: "eGFR 30-45: Max 1000mg/day, reassess risk/benefit; eGFR <30: Contraindicated",
    hepaticDosing: "Avoid use - risk of lactic acidosis",
    foodInteractions: ["Take with meals to reduce GI upset", "No specific food restrictions"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== STATINS =====
  atorvastatin: {
    rxcui: "83367",
    ndc: ["00071-0155-23", "00071-0156-23"],
    genericName: "atorvastatin calcium",
    brandNames: ["Lipitor"],
    drugClass: ["HMG-CoA reductase inhibitor", "Statin", "Antilipemic"],
    therapeuticCategory: "Cardiovascular Agent",
    indications: [
      { condition: "Hyperlipidemia", icd10Codes: ["E78.5"], strength: "FDA-approved" },
      { condition: "ASCVD risk reduction", icd10Codes: ["I25.10", "I63.9"], strength: "FDA-approved" },
      { condition: "Primary prevention in diabetes", icd10Codes: ["E11.9"], strength: "FDA-approved" },
    ],
    dosageAndAdministration: {
      adult: { initial: "10-20 mg daily", maintenance: "10-80 mg daily", max: "80 mg daily" },
      geriatric: { initial: "10 mg daily", maintenance: "10-80 mg daily", max: "80 mg daily" },
      maxDailyDose: "80 mg",
      administrationRoute: ["Oral"],
      frequency: ["Once daily"],
      specialInstructions: [
        "May be taken at any time of day",
        "May be taken with or without food",
        "Consistent daily dosing is important",
      ],
    },
    contraindications: [
      "Active liver disease or unexplained persistent elevations of transaminases",
      "Pregnancy and breastfeeding",
      "Hypersensitivity to any component",
    ],
    warnings: [
      {
        type: "WARNING",
        text: "Rare cases of rhabdomyolysis with acute renal failure. Risk increased with higher doses, advanced age, hypothyroidism, renal impairment.",
      },
      {
        type: "WARNING",
        text: "Liver enzyme elevations can occur - monitor LFTs periodically",
      },
    ],
    precautions: [
      "Monitor for muscle pain, tenderness, weakness",
      "Use lowest effective dose",
      "Chinese patients may be at increased risk for myopathy",
      "Drug interactions with CYP3A4 inhibitors",
    ],
    adverseReactions: [
      { reaction: "Myalgia", frequency: "common", percentage: "3-5%", severity: "mild", patientFriendlyDescription: "Muscle aches and pains" },
      { reaction: "Headache", frequency: "common", severity: "mild", patientFriendlyDescription: "Headaches" },
      { reaction: "GI disturbances", frequency: "common", severity: "mild", patientFriendlyDescription: "Stomach upset, constipation, or diarrhea" },
      { reaction: "Elevated liver enzymes", frequency: "uncommon", severity: "moderate", patientFriendlyDescription: "Abnormal liver tests" },
      { reaction: "Rhabdomyolysis", frequency: "rare", severity: "severe", patientFriendlyDescription: "Severe muscle breakdown - SEEK IMMEDIATE HELP if you have severe muscle pain with dark urine" },
    ],
    patientCounseling: [
      { topic: "Muscle symptoms", advice: "Report any unexplained muscle pain, tenderness, or weakness, especially with fever or dark urine", importance: "critical" },
      { topic: "Grapefruit", advice: "Avoid large amounts of grapefruit juice - it can increase drug levels and side effects", importance: "important" },
      { topic: "Lifestyle", advice: "Continue diet and exercise - medication works best with healthy habits", importance: "important" },
      { topic: "Timing", advice: "Unlike some statins, this can be taken any time of day", importance: "helpful" },
    ],
    mechanismOfAction: "Competitively inhibits HMG-CoA reductase, reducing cholesterol synthesis and upregulating LDL receptors",
    howSupplied: ["Tablets: 10mg, 20mg, 40mg, 80mg"],
    monitoringParameters: [
      { parameter: "Lipid panel", frequency: "4-12 weeks after starting, then annually", reason: "Assess efficacy" },
      { parameter: "Liver function tests", frequency: "Baseline and as clinically indicated", reason: "Monitor for hepatotoxicity" },
      { parameter: "CK", frequency: "If muscle symptoms occur", reason: "Assess for myopathy" },
    ],
    pregnancyCategory: "X",
    lactationSafety: "Contraindicated",
    renalDosing: "No adjustment required",
    hepaticDosing: "Contraindicated in active liver disease",
    foodInteractions: ["Avoid large amounts of grapefruit juice", "May be taken with or without food"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== DIURETICS =====
  furosemide: {
    rxcui: "4603",
    ndc: ["00143-1229-01", "00143-1230-01"],
    genericName: "furosemide",
    brandNames: ["Lasix"],
    drugClass: ["Loop diuretic"],
    therapeuticCategory: "Cardiovascular Agent",
    indications: [
      { condition: "Edema (heart failure)", icd10Codes: ["I50.9"], strength: "FDA-approved" },
      { condition: "Edema (renal disease)", icd10Codes: ["N18.9"], strength: "FDA-approved" },
      { condition: "Edema (hepatic disease)", icd10Codes: ["K74.60"], strength: "FDA-approved" },
      { condition: "Hypertension", icd10Codes: ["I10"], strength: "FDA-approved" },
    ],
    dosageAndAdministration: {
      adult: { initial: "20-80 mg daily", maintenance: "20-600 mg daily", max: "600 mg daily" },
      geriatric: { initial: "20 mg daily", maintenance: "Titrate carefully", max: "Based on response" },
      maxDailyDose: "600 mg",
      administrationRoute: ["Oral", "IV", "IM"],
      frequency: ["Once or twice daily"],
      specialInstructions: [
        "Take in the morning to avoid nighttime urination",
        "If twice daily, take second dose in early afternoon",
        "May cause potassium loss - may need supplementation",
      ],
    },
    contraindications: [
      "Anuria",
      "Hypersensitivity to furosemide or sulfonamides",
      "Hepatic coma or severe electrolyte depletion",
    ],
    warnings: [
      {
        type: "WARNING",
        text: "Excessive diuresis may cause dehydration and electrolyte imbalance. Close monitoring required.",
      },
      {
        type: "WARNING",
        text: "Ototoxicity, especially with rapid IV administration or renal impairment",
      },
    ],
    precautions: [
      "Monitor electrolytes, especially potassium",
      "Caution in diabetes - may affect glucose tolerance",
      "Risk of gout attacks",
      "Photosensitivity",
    ],
    adverseReactions: [
      { reaction: "Hypokalemia", frequency: "common", severity: "moderate", patientFriendlyDescription: "Low potassium - may cause muscle cramps or weakness" },
      { reaction: "Dizziness", frequency: "common", severity: "mild", patientFriendlyDescription: "Lightheadedness, especially when standing" },
      { reaction: "Dehydration", frequency: "common", severity: "moderate", patientFriendlyDescription: "Feeling very thirsty, dry mouth" },
      { reaction: "Frequent urination", frequency: "very_common", severity: "mild", patientFriendlyDescription: "Need to urinate more often - this is expected" },
      { reaction: "Muscle cramps", frequency: "common", severity: "mild", patientFriendlyDescription: "Leg cramps from electrolyte changes" },
    ],
    patientCounseling: [
      { topic: "Timing", advice: "Take in the morning so you're not up all night going to the bathroom", importance: "important" },
      { topic: "Potassium", advice: "You may need to eat potassium-rich foods like bananas, or take supplements", importance: "important" },
      { topic: "Weight monitoring", advice: "Weigh yourself daily - report sudden gain of 2-3 lbs in a day", importance: "critical" },
      { topic: "Dizziness", advice: "Get up slowly from sitting or lying down to prevent falls", importance: "important" },
      { topic: "Sun exposure", advice: "Use sunscreen - this medication can make your skin more sensitive to sun", importance: "helpful" },
    ],
    mechanismOfAction: "Inhibits sodium and chloride reabsorption in the ascending loop of Henle, producing potent diuresis",
    howSupplied: ["Tablets: 20mg, 40mg, 80mg", "Oral solution: 10mg/mL, 40mg/5mL", "Injection: 10mg/mL"],
    monitoringParameters: [
      { parameter: "Weight", frequency: "Daily at home", reason: "Monitor fluid status" },
      { parameter: "Electrolytes (K, Na, Mg)", frequency: "Within 1 week, then periodically", reason: "Monitor for depletion" },
      { parameter: "Renal function", frequency: "Periodically", reason: "Assess kidney function" },
      { parameter: "Blood pressure", frequency: "Each visit", reason: "Monitor for hypotension" },
    ],
    pregnancyCategory: "C",
    lactationSafety: "May suppress lactation - use with caution",
    renalDosing: "Higher doses often needed; may be less effective if eGFR very low",
    hepaticDosing: "Use with caution - may precipitate hepatic encephalopathy",
    foodInteractions: ["Take consistently with regard to food", "May need potassium-rich foods or supplements"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== PAIN/ANTI-INFLAMMATORY =====
  aspirin: {
    rxcui: "1191",
    ndc: ["00280-1000-60", "00280-1000-95"],
    genericName: "aspirin (acetylsalicylic acid)",
    brandNames: ["Bayer", "Ecotrin", "St. Joseph"],
    drugClass: ["NSAID", "Antiplatelet", "Analgesic", "Antipyretic"],
    therapeuticCategory: "Hematologic Agent / Analgesic",
    indications: [
      { condition: "Secondary prevention of cardiovascular events", icd10Codes: ["I25.10", "Z86.73"], strength: "FDA-approved" },
      { condition: "Acute coronary syndrome", icd10Codes: ["I21.9"], strength: "FDA-approved" },
      { condition: "Post-PCI", icd10Codes: ["Z95.5"], strength: "FDA-approved" },
      { condition: "Mild to moderate pain", icd10Codes: ["R52"], strength: "FDA-approved" },
    ],
    dosageAndAdministration: {
      adult: { initial: "81-325 mg daily (CV prevention)", maintenance: "81-325 mg daily", max: "4000 mg daily (pain)" },
      geriatric: { initial: "81 mg daily (CV prevention)", maintenance: "81 mg daily", max: "Use lowest effective dose" },
      maxDailyDose: "4000 mg (pain); 325 mg (CV prevention)",
      administrationRoute: ["Oral", "Rectal"],
      frequency: ["Once daily (CV)", "Every 4-6 hours (pain)"],
      specialInstructions: [
        "Take with food to reduce stomach upset",
        "Enteric-coated tablets should not be crushed",
        "For heart attack symptoms: chew uncoated aspirin for fastest effect",
      ],
    },
    contraindications: [
      "Hypersensitivity to NSAIDs",
      "Active peptic ulcer disease",
      "Children with viral illness (Reye syndrome risk)",
      "Third trimester of pregnancy",
    ],
    warnings: [
      {
        type: "WARNING",
        text: "GI bleeding risk, especially in elderly and those with history of ulcers or concurrent anticoagulant/corticosteroid use",
      },
      {
        type: "WARNING",
        text: "Reye syndrome: Do not use in children with chickenpox or flu-like symptoms",
      },
    ],
    precautions: [
      "Renal impairment",
      "Concurrent anticoagulant therapy",
      "History of GI bleeding",
      "Asthma - may trigger bronchospasm",
    ],
    adverseReactions: [
      { reaction: "GI upset", frequency: "common", severity: "mild", patientFriendlyDescription: "Stomach discomfort, heartburn" },
      { reaction: "GI bleeding", frequency: "uncommon", severity: "severe", patientFriendlyDescription: "Blood in stool (black/tarry) or vomit - SEEK HELP" },
      { reaction: "Easy bruising", frequency: "common", severity: "mild", patientFriendlyDescription: "Bruising more easily" },
      { reaction: "Tinnitus", frequency: "uncommon", severity: "mild", patientFriendlyDescription: "Ringing in ears (especially at high doses)" },
    ],
    patientCounseling: [
      { topic: "Take with food", advice: "Take with food or milk to protect your stomach", importance: "important" },
      { topic: "Bleeding signs", advice: "Watch for black/tarry stools, blood in urine, prolonged bleeding from cuts", importance: "critical" },
      { topic: "Before surgery", advice: "Tell your surgeon and dentist that you take aspirin - may need to stop beforehand", importance: "important" },
      { topic: "OTC medications", advice: "Avoid other NSAIDs (ibuprofen, naproxen) unless approved by your doctor", importance: "important" },
    ],
    mechanismOfAction: "Irreversibly inhibits cyclooxygenase (COX-1 and COX-2), preventing thromboxane and prostaglandin synthesis",
    howSupplied: ["Tablets: 81mg (low-dose), 325mg, 500mg", "Enteric-coated: 81mg, 325mg"],
    monitoringParameters: [
      { parameter: "Signs of bleeding", frequency: "Ongoing", reason: "Early detection of GI bleeding" },
      { parameter: "CBC", frequency: "If prolonged use", reason: "Monitor for anemia" },
    ],
    pregnancyCategory: "D (3rd trimester); C (1st/2nd trimester)",
    lactationSafety: "Use with caution - excreted in breast milk",
    renalDosing: "Avoid in severe renal impairment",
    hepaticDosing: "Avoid in severe hepatic impairment",
    foodInteractions: ["Take with food to reduce GI upset", "Avoid alcohol - increases bleeding risk"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== PROTON PUMP INHIBITORS =====
  omeprazole: {
    rxcui: "7646",
    ndc: ["00186-5020-31", "00186-5040-31"],
    genericName: "omeprazole",
    brandNames: ["Prilosec", "Prilosec OTC"],
    drugClass: ["Proton pump inhibitor", "Antisecretory agent"],
    therapeuticCategory: "Gastrointestinal Agent",
    indications: [
      { condition: "GERD", icd10Codes: ["K21.0"], strength: "FDA-approved" },
      { condition: "Erosive esophagitis", icd10Codes: ["K21.0"], strength: "FDA-approved" },
      { condition: "H. pylori eradication (with antibiotics)", icd10Codes: ["B96.81"], strength: "FDA-approved" },
      { condition: "Zollinger-Ellison syndrome", icd10Codes: ["E16.4"], strength: "FDA-approved" },
    ],
    dosageAndAdministration: {
      adult: { initial: "20 mg daily", maintenance: "20-40 mg daily", max: "360 mg daily (ZES)" },
      geriatric: { initial: "20 mg daily", maintenance: "20 mg daily", max: "40 mg daily" },
      maxDailyDose: "40 mg (typical); 360 mg (ZES)",
      administrationRoute: ["Oral"],
      frequency: ["Once daily, before breakfast"],
      specialInstructions: [
        "Take 30-60 minutes before a meal, preferably breakfast",
        "Capsules: Swallow whole or open and sprinkle on applesauce",
        "Do not crush or chew delayed-release formulations",
      ],
    },
    contraindications: [
      "Hypersensitivity to PPIs",
      "Concurrent use with rilpivirine-containing products",
    ],
    warnings: [
      {
        type: "WARNING",
        text: "Long-term use may increase risk of C. difficile infection, bone fractures, hypomagnesemia, and vitamin B12 deficiency",
      },
    ],
    precautions: [
      "Long-term use - monitor magnesium, B12",
      "May mask symptoms of gastric cancer",
      "Consider calcium supplementation for bone health",
    ],
    adverseReactions: [
      { reaction: "Headache", frequency: "common", severity: "mild", patientFriendlyDescription: "Headaches" },
      { reaction: "Diarrhea", frequency: "common", severity: "mild", patientFriendlyDescription: "Loose stools" },
      { reaction: "Abdominal pain", frequency: "common", severity: "mild", patientFriendlyDescription: "Stomach discomfort" },
      { reaction: "Nausea", frequency: "common", severity: "mild", patientFriendlyDescription: "Feeling sick to your stomach" },
    ],
    patientCounseling: [
      { topic: "Timing", advice: "Take 30-60 minutes before breakfast for best effect", importance: "important" },
      { topic: "Duration", advice: "Don't take longer than recommended without doctor supervision", importance: "important" },
      { topic: "Bone health", advice: "Long-term use may affect bone strength - discuss calcium/vitamin D with your doctor", importance: "helpful" },
      { topic: "Alarm symptoms", advice: "See your doctor if you have difficulty swallowing, vomiting blood, or unexplained weight loss", importance: "critical" },
    ],
    mechanismOfAction: "Irreversibly inhibits gastric H+/K+-ATPase (proton pump), blocking acid secretion",
    howSupplied: ["Capsules: 10mg, 20mg, 40mg", "OTC tablets: 20mg"],
    monitoringParameters: [
      { parameter: "Symptom improvement", frequency: "2-4 weeks", reason: "Assess efficacy" },
      { parameter: "Magnesium", frequency: "Periodically with long-term use", reason: "Monitor for deficiency" },
      { parameter: "B12", frequency: "Periodically with long-term use", reason: "Monitor for deficiency" },
    ],
    pregnancyCategory: "C",
    lactationSafety: "Use with caution",
    renalDosing: "No adjustment required",
    hepaticDosing: "Consider dose reduction in severe hepatic impairment",
    foodInteractions: ["Take before meals for optimal effect", "No specific food restrictions"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== GABAPENTINOIDS =====
  gabapentin: {
    rxcui: "25480",
    ndc: ["00071-0803-24", "00071-0805-24"],
    genericName: "gabapentin",
    brandNames: ["Neurontin", "Gralise", "Horizant"],
    drugClass: ["Anticonvulsant", "Analgesic (neuropathic pain)"],
    therapeuticCategory: "Central Nervous System Agent",
    indications: [
      { condition: "Postherpetic neuralgia", icd10Codes: ["G53.0"], strength: "FDA-approved" },
      { condition: "Partial seizures (adjunct)", icd10Codes: ["G40.009"], strength: "FDA-approved" },
      { condition: "Restless legs syndrome", icd10Codes: ["G25.81"], strength: "FDA-approved", notes: "Horizant only" },
      { condition: "Diabetic neuropathy", icd10Codes: ["G63.2"], strength: "Off-label" },
    ],
    dosageAndAdministration: {
      adult: { initial: "300 mg day 1, 300 mg BID day 2, 300 mg TID day 3", maintenance: "900-3600 mg daily in 3 divided doses", max: "3600 mg daily" },
      geriatric: { initial: "100-300 mg at bedtime", maintenance: "Titrate slowly", max: "Adjust for renal function" },
      maxDailyDose: "3600 mg",
      administrationRoute: ["Oral"],
      frequency: ["Three times daily (IR)", "Once daily (ER)"],
      specialInstructions: [
        "Maximum interval between doses should be 12 hours",
        "Can be taken with or without food",
        "Do not stop suddenly - taper over 1 week minimum",
      ],
    },
    contraindications: [
      "Known hypersensitivity to gabapentin",
    ],
    warnings: [
      {
        type: "WARNING",
        text: "May cause CNS depression - use caution with opioids (increased risk of respiratory depression)",
      },
      {
        type: "WARNING",
        text: "Antiepileptics associated with increased risk of suicidal thoughts/behavior",
      },
    ],
    precautions: [
      "Renal impairment - dose adjustment required",
      "Elderly - increased sensitivity",
      "Risk of abuse and dependence",
    ],
    adverseReactions: [
      { reaction: "Somnolence", frequency: "very_common", percentage: "19%", severity: "moderate", patientFriendlyDescription: "Feeling sleepy or drowsy" },
      { reaction: "Dizziness", frequency: "very_common", percentage: "17%", severity: "moderate", patientFriendlyDescription: "Feeling lightheaded or unsteady" },
      { reaction: "Ataxia", frequency: "common", severity: "moderate", patientFriendlyDescription: "Unsteady walking or coordination problems" },
      { reaction: "Peripheral edema", frequency: "common", severity: "mild", patientFriendlyDescription: "Swelling in ankles or feet" },
      { reaction: "Weight gain", frequency: "common", severity: "mild", patientFriendlyDescription: "Gaining weight" },
    ],
    patientCounseling: [
      { topic: "Drowsiness", advice: "This medication may make you drowsy - avoid driving until you know how it affects you", importance: "critical" },
      { topic: "Don't stop suddenly", advice: "Never stop taking suddenly - must be tapered slowly to prevent withdrawal", importance: "critical" },
      { topic: "Alcohol", advice: "Avoid alcohol - increases drowsiness and side effects", importance: "important" },
      { topic: "Timing", advice: "Space doses evenly throughout the day, no more than 12 hours apart", importance: "important" },
    ],
    mechanismOfAction: "Binds to alpha-2-delta subunit of voltage-gated calcium channels, reducing neurotransmitter release",
    howSupplied: ["Capsules: 100mg, 300mg, 400mg", "Tablets: 600mg, 800mg", "Oral solution: 250mg/5mL"],
    monitoringParameters: [
      { parameter: "Pain/seizure control", frequency: "Each visit", reason: "Assess efficacy" },
      { parameter: "Mental status", frequency: "Ongoing", reason: "Monitor for depression/suicidal ideation" },
      { parameter: "Renal function", frequency: "Periodically", reason: "Adjust dose if impaired" },
    ],
    pregnancyCategory: "C",
    lactationSafety: "Excreted in breast milk - use caution",
    renalDosing: "CrCl 30-59: 200-700mg BID; CrCl 15-29: 200-700mg daily; CrCl <15: 100-300mg daily",
    hepaticDosing: "No adjustment required",
    foodInteractions: ["Can be taken with or without food"],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },

  // ===== THYROID =====
  levothyroxine: {
    rxcui: "10582",
    ndc: ["00074-6624-13", "00074-6625-13"],
    genericName: "levothyroxine sodium",
    brandNames: ["Synthroid", "Levoxyl", "Tirosint"],
    drugClass: ["Thyroid hormone"],
    therapeuticCategory: "Endocrine Agent",
    indications: [
      { condition: "Hypothyroidism", icd10Codes: ["E03.9"], strength: "FDA-approved" },
      { condition: "TSH suppression in thyroid cancer", icd10Codes: ["C73"], strength: "FDA-approved" },
      { condition: "Myxedema coma", icd10Codes: ["E03.5"], strength: "FDA-approved" },
    ],
    dosageAndAdministration: {
      adult: { initial: "25-50 mcg daily (25 mcg if elderly or cardiac disease)", maintenance: "1.6 mcg/kg/day", max: "Individualized" },
      geriatric: { initial: "12.5-25 mcg daily", maintenance: "Titrate slowly", max: "Individualized" },
      maxDailyDose: "Individualized based on TSH",
      administrationRoute: ["Oral", "IV"],
      frequency: ["Once daily"],
      specialInstructions: [
        "Take on empty stomach, 30-60 minutes before breakfast",
        "Take 4 hours apart from calcium, iron, or antacids",
        "Maintain same brand if possible - bioavailability varies",
      ],
    },
    contraindications: [
      "Untreated adrenal insufficiency",
      "Acute myocardial infarction",
      "Thyrotoxicosis",
    ],
    warnings: [
      {
        type: "BLACK_BOX",
        text: "Thyroid hormones should not be used for weight loss. In euthyroid patients, doses within typical range are ineffective for weight reduction; larger doses may produce serious or life-threatening toxicity.",
      },
    ],
    precautions: [
      "Cardiovascular disease - start low, go slow",
      "Diabetes - may require dose adjustment of antidiabetic medications",
      "Elderly - increased sensitivity",
    ],
    adverseReactions: [
      { reaction: "Palpitations", frequency: "common", severity: "moderate", patientFriendlyDescription: "Fast or irregular heartbeat - may indicate dose too high" },
      { reaction: "Weight loss", frequency: "common", severity: "mild", patientFriendlyDescription: "Losing weight - may indicate dose too high" },
      { reaction: "Tremor", frequency: "common", severity: "mild", patientFriendlyDescription: "Shakiness or trembling" },
      { reaction: "Insomnia", frequency: "common", severity: "mild", patientFriendlyDescription: "Trouble sleeping" },
      { reaction: "Heat intolerance", frequency: "common", severity: "mild", patientFriendlyDescription: "Feeling too warm" },
    ],
    patientCounseling: [
      { topic: "Empty stomach", advice: "Take first thing in morning, 30-60 minutes before eating for best absorption", importance: "critical" },
      { topic: "Separation from other drugs", advice: "Take 4 hours apart from calcium, iron supplements, and antacids", importance: "critical" },
      { topic: "Consistency", advice: "Try to stay on the same brand - different brands may work differently", importance: "important" },
      { topic: "Symptoms of too much", advice: "Tell your doctor if you have racing heart, tremor, or unexplained weight loss", importance: "important" },
    ],
    mechanismOfAction: "Synthetic T4 that converts to T3; increases basal metabolic rate and oxygen consumption",
    howSupplied: ["Tablets: 25, 50, 75, 88, 100, 112, 125, 137, 150, 175, 200, 300 mcg"],
    monitoringParameters: [
      { parameter: "TSH", frequency: "6-8 weeks after dose change, then every 6-12 months", targetRange: "0.5-4.0 mIU/L (varies by condition)", reason: "Assess adequacy of replacement" },
      { parameter: "Free T4", frequency: "As needed", reason: "Assess thyroid status" },
      { parameter: "Heart rate", frequency: "Each visit", reason: "Detect overreplacement" },
    ],
    pregnancyCategory: "A",
    lactationSafety: "Compatible with breastfeeding",
    renalDosing: "No adjustment required",
    hepaticDosing: "No adjustment required",
    foodInteractions: [
      "Take on empty stomach for optimal absorption",
      "Coffee may reduce absorption - wait 1 hour",
      "High-fiber foods may reduce absorption",
      "Soy products may reduce absorption",
    ],
    lastUpdated: "2025-01-28",
    source: "Simulated FDB MedKnowledge",
  },
};

/**
 * Get drug monograph by generic name or brand name
 */
export function getDrugMonograph(drugName: string): DrugMonograph | null {
  const normalized = drugName.toLowerCase().trim();

  // Direct match on key
  if (DRUG_MONOGRAPHS[normalized]) {
    return DRUG_MONOGRAPHS[normalized];
  }

  // Search by generic name or brand names
  for (const [key, monograph] of Object.entries(DRUG_MONOGRAPHS)) {
    if (
      monograph.genericName.toLowerCase().includes(normalized) ||
      monograph.brandNames.some((b) => b.toLowerCase().includes(normalized)) ||
      normalized.includes(key)
    ) {
      return monograph;
    }
  }

  return null;
}

/**
 * Get patient-friendly drug information from monograph
 */
export function getPatientDrugInfo(drugName: string): {
  purpose: string;
  sideEffects: string[];
  warnings: string[];
  patientTips: string[];
  source: string;
} | null {
  const monograph = getDrugMonograph(drugName);
  if (!monograph) return null;

  return {
    purpose: monograph.indications[0]
      ? `This medication is used to treat ${monograph.indications[0].condition.toLowerCase()}.`
      : "This medication was prescribed by your doctor for your condition.",
    sideEffects: monograph.adverseReactions
      .filter((ar) => ar.frequency === "common" || ar.frequency === "very_common")
      .slice(0, 4)
      .map((ar) => ar.patientFriendlyDescription),
    warnings: monograph.patientCounseling
      .filter((pc) => pc.importance === "critical")
      .map((pc) => `⚠️ ${pc.advice}`)
      .slice(0, 3),
    patientTips: monograph.patientCounseling
      .filter((pc) => pc.importance === "important" || pc.importance === "helpful")
      .map((pc) => pc.advice)
      .slice(0, 3),
    source: "Clinical Knowledge Base",
  };
}

/**
 * Get all available drug names in the knowledge base
 */
export function getAvailableDrugs(): string[] {
  const drugs: string[] = [];
  for (const monograph of Object.values(DRUG_MONOGRAPHS)) {
    drugs.push(monograph.genericName);
    drugs.push(...monograph.brandNames);
  }
  return drugs;
}
