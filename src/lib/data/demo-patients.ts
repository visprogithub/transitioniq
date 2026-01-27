import type { Patient } from "../types/patient";

export const demoPatients: Record<string, Patient> = {
  "demo-polypharmacy": {
    id: "demo-polypharmacy",
    name: "John Smith",
    age: 68,
    gender: "M",
    mrn: "MRN-2024-001",
    admissionDate: "2026-01-20",
    diagnoses: [
      {
        code: "I25.10",
        display: "Atherosclerotic heart disease",
        status: "active",
      },
      {
        code: "I10",
        display: "Essential hypertension",
        status: "active",
      },
      {
        code: "E11.9",
        display: "Type 2 diabetes mellitus",
        status: "active",
      },
      {
        code: "I48.91",
        display: "Atrial fibrillation",
        status: "active",
      },
    ],
    medications: [
      { name: "Warfarin", dose: "5mg", frequency: "daily", route: "oral", rxNormCode: "855318" },
      { name: "Aspirin", dose: "81mg", frequency: "daily", route: "oral", rxNormCode: "243670" },
      { name: "Metformin", dose: "1000mg", frequency: "twice daily", route: "oral", rxNormCode: "861004" },
      { name: "Lisinopril", dose: "20mg", frequency: "daily", route: "oral", rxNormCode: "314076" },
      { name: "Atorvastatin", dose: "40mg", frequency: "daily", route: "oral", rxNormCode: "617311" },
      { name: "Metoprolol", dose: "50mg", frequency: "twice daily", route: "oral", rxNormCode: "866426" },
      { name: "Amlodipine", dose: "10mg", frequency: "daily", route: "oral", rxNormCode: "308135" },
      { name: "Furosemide", dose: "40mg", frequency: "daily", route: "oral", rxNormCode: "310429" },
      { name: "Potassium Chloride", dose: "20mEq", frequency: "daily", route: "oral", rxNormCode: "628958" },
      { name: "Omeprazole", dose: "20mg", frequency: "daily", route: "oral", rxNormCode: "402014" },
      { name: "Gabapentin", dose: "300mg", frequency: "three times daily", route: "oral", rxNormCode: "310431" },
      { name: "Eliquis", dose: "5mg", frequency: "twice daily", route: "oral", rxNormCode: "1364430" },
    ],
    allergies: ["Penicillin", "Sulfa drugs"],
    recentLabs: [
      { name: "INR", value: 3.8, unit: "", referenceRange: "2.0-3.0", date: "2026-01-25", abnormal: true },
      { name: "Creatinine", value: 1.6, unit: "mg/dL", referenceRange: "0.7-1.3", date: "2026-01-25", abnormal: true },
      { name: "HbA1c", value: 8.2, unit: "%", referenceRange: "<7.0", date: "2026-01-24", abnormal: true },
      { name: "Potassium", value: 3.4, unit: "mEq/L", referenceRange: "3.5-5.0", date: "2026-01-25", abnormal: true },
    ],
    vitalSigns: {
      bloodPressure: "142/88",
      heartRate: 78,
      temperature: 98.6,
      respiratoryRate: 18,
      oxygenSaturation: 95,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  "demo-heart-failure": {
    id: "demo-heart-failure",
    name: "Mary Johnson",
    age: 72,
    gender: "F",
    mrn: "MRN-2024-002",
    admissionDate: "2026-01-22",
    diagnoses: [
      {
        code: "I50.9",
        display: "Heart failure, unspecified",
        status: "active",
      },
      {
        code: "I10",
        display: "Essential hypertension",
        status: "active",
      },
      {
        code: "J44.1",
        display: "COPD with acute exacerbation",
        status: "active",
      },
    ],
    medications: [
      { name: "Carvedilol", dose: "25mg", frequency: "twice daily", route: "oral", rxNormCode: "200031" },
      { name: "Furosemide", dose: "80mg", frequency: "daily", route: "oral", rxNormCode: "310429" },
      { name: "Spironolactone", dose: "25mg", frequency: "daily", route: "oral", rxNormCode: "313096" },
      { name: "Lisinopril", dose: "10mg", frequency: "daily", route: "oral", rxNormCode: "314076" },
      { name: "Digoxin", dose: "0.125mg", frequency: "daily", route: "oral", rxNormCode: "197604" },
      { name: "Albuterol", dose: "2 puffs", frequency: "every 4-6 hours as needed", route: "inhalation", rxNormCode: "801917" },
      { name: "Tiotropium", dose: "18mcg", frequency: "daily", route: "inhalation", rxNormCode: "1666775" },
    ],
    allergies: ["Codeine"],
    recentLabs: [
      { name: "BNP", value: 890, unit: "pg/mL", referenceRange: "<100", date: "2026-01-25", abnormal: true },
      { name: "Creatinine", value: 1.4, unit: "mg/dL", referenceRange: "0.6-1.1", date: "2026-01-25", abnormal: true },
      { name: "Sodium", value: 132, unit: "mEq/L", referenceRange: "136-145", date: "2026-01-25", abnormal: true },
    ],
    vitalSigns: {
      bloodPressure: "118/72",
      heartRate: 82,
      temperature: 98.4,
      respiratoryRate: 22,
      oxygenSaturation: 92,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  "demo-ready": {
    id: "demo-ready",
    name: "Robert Chen",
    age: 45,
    gender: "M",
    mrn: "MRN-2024-003",
    admissionDate: "2026-01-24",
    diagnoses: [
      {
        code: "K35.80",
        display: "Acute appendicitis, unspecified",
        status: "resolved",
      },
    ],
    medications: [
      { name: "Acetaminophen", dose: "650mg", frequency: "every 6 hours as needed", route: "oral", rxNormCode: "313782" },
      { name: "Ibuprofen", dose: "400mg", frequency: "every 6 hours as needed", route: "oral", rxNormCode: "310965" },
    ],
    allergies: [],
    recentLabs: [
      { name: "WBC", value: 8.2, unit: "x10^9/L", referenceRange: "4.5-11.0", date: "2026-01-25", abnormal: false },
      { name: "Hemoglobin", value: 14.1, unit: "g/dL", referenceRange: "13.5-17.5", date: "2026-01-25", abnormal: false },
    ],
    vitalSigns: {
      bloodPressure: "122/78",
      heartRate: 72,
      temperature: 98.6,
      respiratoryRate: 16,
      oxygenSaturation: 98,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // ============ NEW TEST PATIENTS ============

  // Pediatric patient - post-tonsillectomy (expected: ready, score 85-100)
  "demo-pediatric": {
    id: "demo-pediatric",
    name: "Emily Wilson",
    age: 8,
    gender: "F",
    mrn: "MRN-2024-004",
    admissionDate: "2026-01-25",
    diagnoses: [
      {
        code: "J35.1",
        display: "Hypertrophy of tonsils",
        status: "resolved",
      },
      {
        code: "Z96.89",
        display: "Status post tonsillectomy",
        status: "active",
      },
    ],
    medications: [
      { name: "Acetaminophen", dose: "250mg", frequency: "every 6 hours as needed", route: "oral", rxNormCode: "313782" },
      { name: "Amoxicillin", dose: "250mg", frequency: "three times daily", route: "oral", rxNormCode: "308182" },
    ],
    allergies: [],
    recentLabs: [
      { name: "WBC", value: 9.5, unit: "x10^9/L", referenceRange: "5.0-14.5", date: "2026-01-26", abnormal: false },
    ],
    vitalSigns: {
      bloodPressure: "98/62",
      heartRate: 88,
      temperature: 98.8,
      respiratoryRate: 20,
      oxygenSaturation: 99,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // Geriatric patient with fall risk and cognitive decline (expected: not_ready, score 20-40)
  "demo-geriatric-fall": {
    id: "demo-geriatric-fall",
    name: "Dorothy Martinez",
    age: 88,
    gender: "F",
    mrn: "MRN-2024-005",
    admissionDate: "2026-01-18",
    diagnoses: [
      {
        code: "W19",
        display: "Unspecified fall",
        status: "resolved",
      },
      {
        code: "S72.001A",
        display: "Fracture of unspecified part of neck of right femur",
        status: "active",
      },
      {
        code: "F03.90",
        display: "Unspecified dementia without behavioral disturbance",
        status: "active",
      },
      {
        code: "I10",
        display: "Essential hypertension",
        status: "active",
      },
    ],
    medications: [
      { name: "Amlodipine", dose: "5mg", frequency: "daily", route: "oral", rxNormCode: "308135" },
      { name: "Donepezil", dose: "10mg", frequency: "daily", route: "oral", rxNormCode: "579411" },
      { name: "Lorazepam", dose: "0.5mg", frequency: "at bedtime", route: "oral", rxNormCode: "197901" },
      { name: "Tramadol", dose: "50mg", frequency: "every 6 hours as needed", route: "oral", rxNormCode: "835603" },
      { name: "Vitamin D3", dose: "2000IU", frequency: "daily", route: "oral", rxNormCode: "636676" },
      { name: "Calcium Carbonate", dose: "600mg", frequency: "twice daily", route: "oral", rxNormCode: "318076" },
    ],
    allergies: ["Morphine"],
    recentLabs: [
      { name: "Vitamin D", value: 18, unit: "ng/mL", referenceRange: "30-100", date: "2026-01-25", abnormal: true },
      { name: "Hemoglobin", value: 10.2, unit: "g/dL", referenceRange: "12.0-16.0", date: "2026-01-25", abnormal: true },
      { name: "Creatinine", value: 1.3, unit: "mg/dL", referenceRange: "0.6-1.1", date: "2026-01-25", abnormal: true },
    ],
    vitalSigns: {
      bloodPressure: "108/62",
      heartRate: 68,
      temperature: 97.8,
      respiratoryRate: 16,
      oxygenSaturation: 96,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // Pregnancy with gestational diabetes (expected: caution, score 50-70)
  "demo-pregnancy-gdm": {
    id: "demo-pregnancy-gdm",
    name: "Sarah Thompson",
    age: 32,
    gender: "F",
    mrn: "MRN-2024-006",
    admissionDate: "2026-01-23",
    diagnoses: [
      {
        code: "O24.419",
        display: "Gestational diabetes mellitus in pregnancy, unspecified control",
        status: "active",
      },
      {
        code: "Z33.1",
        display: "Pregnant state, incidental",
        status: "active",
      },
      {
        code: "O13",
        display: "Gestational hypertension",
        status: "active",
      },
    ],
    medications: [
      { name: "Insulin Lispro", dose: "8 units", frequency: "with meals", route: "subcutaneous", rxNormCode: "86009" },
      { name: "Insulin Glargine", dose: "20 units", frequency: "at bedtime", route: "subcutaneous", rxNormCode: "261542" },
      { name: "Labetalol", dose: "200mg", frequency: "twice daily", route: "oral", rxNormCode: "197380" },
      { name: "Prenatal Vitamins", dose: "1 tablet", frequency: "daily", route: "oral", rxNormCode: "1037045" },
    ],
    allergies: [],
    recentLabs: [
      { name: "Glucose Fasting", value: 128, unit: "mg/dL", referenceRange: "<95", date: "2026-01-26", abnormal: true },
      { name: "HbA1c", value: 6.8, unit: "%", referenceRange: "<6.0", date: "2026-01-24", abnormal: true },
      { name: "Urine Protein", value: 150, unit: "mg/24hr", referenceRange: "<150", date: "2026-01-25", abnormal: false },
    ],
    vitalSigns: {
      bloodPressure: "148/92",
      heartRate: 84,
      temperature: 98.4,
      respiratoryRate: 16,
      oxygenSaturation: 99,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // CKD Stage 4 on dialysis (expected: not_ready, score 30-50)
  "demo-renal-dialysis": {
    id: "demo-renal-dialysis",
    name: "William Jackson",
    age: 65,
    gender: "M",
    mrn: "MRN-2024-007",
    admissionDate: "2026-01-19",
    diagnoses: [
      {
        code: "N18.4",
        display: "Chronic kidney disease, stage 4",
        status: "active",
      },
      {
        code: "Z99.2",
        display: "Dependence on renal dialysis",
        status: "active",
      },
      {
        code: "E11.65",
        display: "Type 2 diabetes mellitus with hyperglycemia",
        status: "active",
      },
      {
        code: "D63.1",
        display: "Anemia in chronic kidney disease",
        status: "active",
      },
    ],
    medications: [
      { name: "Sevelamer", dose: "800mg", frequency: "three times daily with meals", route: "oral", rxNormCode: "203155" },
      { name: "Epoetin Alfa", dose: "4000 units", frequency: "three times weekly", route: "subcutaneous", rxNormCode: "105017" },
      { name: "Ferrous Sulfate", dose: "325mg", frequency: "daily", route: "oral", rxNormCode: "310325" },
      { name: "Calcitriol", dose: "0.25mcg", frequency: "daily", route: "oral", rxNormCode: "197659" },
      { name: "Insulin Glargine", dose: "30 units", frequency: "at bedtime", route: "subcutaneous", rxNormCode: "261542" },
      { name: "Metoprolol", dose: "25mg", frequency: "twice daily", route: "oral", rxNormCode: "866426" },
      { name: "Amlodipine", dose: "10mg", frequency: "daily", route: "oral", rxNormCode: "308135" },
    ],
    allergies: ["Iodinated contrast"],
    recentLabs: [
      { name: "Creatinine", value: 6.8, unit: "mg/dL", referenceRange: "0.7-1.3", date: "2026-01-26", abnormal: true },
      { name: "BUN", value: 78, unit: "mg/dL", referenceRange: "7-20", date: "2026-01-26", abnormal: true },
      { name: "Potassium", value: 5.8, unit: "mEq/L", referenceRange: "3.5-5.0", date: "2026-01-26", abnormal: true },
      { name: "Hemoglobin", value: 9.4, unit: "g/dL", referenceRange: "13.5-17.5", date: "2026-01-26", abnormal: true },
      { name: "Phosphorus", value: 7.2, unit: "mg/dL", referenceRange: "2.5-4.5", date: "2026-01-26", abnormal: true },
    ],
    vitalSigns: {
      bloodPressure: "158/92",
      heartRate: 88,
      temperature: 98.2,
      respiratoryRate: 18,
      oxygenSaturation: 95,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // Psychiatric patient with bipolar disorder on lithium (expected: caution, score 40-60)
  "demo-psychiatric-bipolar": {
    id: "demo-psychiatric-bipolar",
    name: "Jennifer Adams",
    age: 45,
    gender: "F",
    mrn: "MRN-2024-008",
    admissionDate: "2026-01-21",
    diagnoses: [
      {
        code: "F31.9",
        display: "Bipolar disorder, unspecified",
        status: "active",
      },
      {
        code: "F41.1",
        display: "Generalized anxiety disorder",
        status: "active",
      },
      {
        code: "E03.9",
        display: "Hypothyroidism, unspecified",
        status: "active",
      },
    ],
    medications: [
      { name: "Lithium Carbonate", dose: "600mg", frequency: "twice daily", route: "oral", rxNormCode: "197880" },
      { name: "Quetiapine", dose: "200mg", frequency: "at bedtime", route: "oral", rxNormCode: "312615" },
      { name: "Levothyroxine", dose: "75mcg", frequency: "daily", route: "oral", rxNormCode: "966247" },
      { name: "Buspirone", dose: "15mg", frequency: "twice daily", route: "oral", rxNormCode: "198015" },
    ],
    allergies: ["Lamotrigine"],
    recentLabs: [
      { name: "Lithium Level", value: 1.4, unit: "mEq/L", referenceRange: "0.6-1.2", date: "2026-01-26", abnormal: true },
      { name: "TSH", value: 6.8, unit: "mIU/L", referenceRange: "0.4-4.0", date: "2026-01-25", abnormal: true },
      { name: "Creatinine", value: 1.1, unit: "mg/dL", referenceRange: "0.6-1.1", date: "2026-01-26", abnormal: false },
    ],
    vitalSigns: {
      bloodPressure: "118/76",
      heartRate: 74,
      temperature: 98.6,
      respiratoryRate: 16,
      oxygenSaturation: 98,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // Oncology patient post-chemo with neutropenia (expected: not_ready, score 30-50)
  "demo-oncology-neutropenic": {
    id: "demo-oncology-neutropenic",
    name: "Michael Brown",
    age: 58,
    gender: "M",
    mrn: "MRN-2024-009",
    admissionDate: "2026-01-17",
    diagnoses: [
      {
        code: "C18.9",
        display: "Malignant neoplasm of colon, unspecified",
        status: "active",
      },
      {
        code: "D70.1",
        display: "Agranulocytosis secondary to cancer chemotherapy",
        status: "active",
      },
      {
        code: "R50.9",
        display: "Fever, unspecified",
        status: "resolved",
      },
    ],
    medications: [
      { name: "Filgrastim", dose: "300mcg", frequency: "daily", route: "subcutaneous", rxNormCode: "203384" },
      { name: "Ondansetron", dose: "8mg", frequency: "every 8 hours as needed", route: "oral", rxNormCode: "312086" },
      { name: "Prochlorperazine", dose: "10mg", frequency: "every 6 hours as needed", route: "oral", rxNormCode: "197980" },
      { name: "Acyclovir", dose: "400mg", frequency: "twice daily", route: "oral", rxNormCode: "197397" },
      { name: "Fluconazole", dose: "100mg", frequency: "daily", route: "oral", rxNormCode: "197696" },
      { name: "Omeprazole", dose: "40mg", frequency: "daily", route: "oral", rxNormCode: "402014" },
    ],
    allergies: ["Sulfa drugs"],
    recentLabs: [
      { name: "WBC", value: 1.2, unit: "x10^9/L", referenceRange: "4.5-11.0", date: "2026-01-26", abnormal: true },
      { name: "ANC", value: 0.4, unit: "x10^9/L", referenceRange: ">1.5", date: "2026-01-26", abnormal: true },
      { name: "Hemoglobin", value: 8.9, unit: "g/dL", referenceRange: "13.5-17.5", date: "2026-01-26", abnormal: true },
      { name: "Platelets", value: 85, unit: "x10^9/L", referenceRange: "150-400", date: "2026-01-26", abnormal: true },
    ],
    vitalSigns: {
      bloodPressure: "108/68",
      heartRate: 92,
      temperature: 99.1,
      respiratoryRate: 18,
      oxygenSaturation: 97,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // Simple surgery - laparoscopic cholecystectomy (expected: ready, score 85-100)
  "demo-simple-surgery": {
    id: "demo-simple-surgery",
    name: "Lisa Garcia",
    age: 35,
    gender: "F",
    mrn: "MRN-2024-010",
    admissionDate: "2026-01-25",
    diagnoses: [
      {
        code: "K80.00",
        display: "Calculus of gallbladder with acute cholecystitis",
        status: "resolved",
      },
      {
        code: "Z96.89",
        display: "Status post laparoscopic cholecystectomy",
        status: "active",
      },
    ],
    medications: [
      { name: "Acetaminophen", dose: "500mg", frequency: "every 6 hours as needed", route: "oral", rxNormCode: "313782" },
      { name: "Ondansetron", dose: "4mg", frequency: "every 8 hours as needed", route: "oral", rxNormCode: "312086" },
    ],
    allergies: [],
    recentLabs: [
      { name: "WBC", value: 7.8, unit: "x10^9/L", referenceRange: "4.5-11.0", date: "2026-01-26", abnormal: false },
      { name: "Hemoglobin", value: 12.8, unit: "g/dL", referenceRange: "12.0-16.0", date: "2026-01-26", abnormal: false },
    ],
    vitalSigns: {
      bloodPressure: "118/74",
      heartRate: 72,
      temperature: 98.4,
      respiratoryRate: 16,
      oxygenSaturation: 99,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // Extreme polypharmacy patient (expected: not_ready, score 10-30)
  "demo-extreme-polypharmacy": {
    id: "demo-extreme-polypharmacy",
    name: "Harold Wilson",
    age: 75,
    gender: "M",
    mrn: "MRN-2024-011",
    admissionDate: "2026-01-15",
    diagnoses: [
      {
        code: "I25.10",
        display: "Atherosclerotic heart disease",
        status: "active",
      },
      {
        code: "I50.9",
        display: "Heart failure, unspecified",
        status: "active",
      },
      {
        code: "E11.9",
        display: "Type 2 diabetes mellitus",
        status: "active",
      },
      {
        code: "I48.91",
        display: "Atrial fibrillation",
        status: "active",
      },
      {
        code: "N18.3",
        display: "Chronic kidney disease, stage 3",
        status: "active",
      },
      {
        code: "J44.9",
        display: "Chronic obstructive pulmonary disease",
        status: "active",
      },
      {
        code: "G47.33",
        display: "Obstructive sleep apnea",
        status: "active",
      },
      {
        code: "M19.90",
        display: "Osteoarthritis, unspecified",
        status: "active",
      },
    ],
    medications: [
      { name: "Warfarin", dose: "7.5mg", frequency: "daily", route: "oral", rxNormCode: "855318" },
      { name: "Metformin", dose: "500mg", frequency: "twice daily", route: "oral", rxNormCode: "861004" },
      { name: "Glipizide", dose: "5mg", frequency: "twice daily", route: "oral", rxNormCode: "310488" },
      { name: "Lisinopril", dose: "10mg", frequency: "daily", route: "oral", rxNormCode: "314076" },
      { name: "Carvedilol", dose: "12.5mg", frequency: "twice daily", route: "oral", rxNormCode: "200031" },
      { name: "Furosemide", dose: "40mg", frequency: "twice daily", route: "oral", rxNormCode: "310429" },
      { name: "Spironolactone", dose: "25mg", frequency: "daily", route: "oral", rxNormCode: "313096" },
      { name: "Digoxin", dose: "0.125mg", frequency: "daily", route: "oral", rxNormCode: "197604" },
      { name: "Atorvastatin", dose: "40mg", frequency: "daily", route: "oral", rxNormCode: "617311" },
      { name: "Aspirin", dose: "81mg", frequency: "daily", route: "oral", rxNormCode: "243670" },
      { name: "Omeprazole", dose: "40mg", frequency: "daily", route: "oral", rxNormCode: "402014" },
      { name: "Albuterol", dose: "2 puffs", frequency: "every 4 hours as needed", route: "inhalation", rxNormCode: "801917" },
      { name: "Tiotropium", dose: "18mcg", frequency: "daily", route: "inhalation", rxNormCode: "1666775" },
      { name: "Gabapentin", dose: "300mg", frequency: "three times daily", route: "oral", rxNormCode: "310431" },
      { name: "Tramadol", dose: "50mg", frequency: "every 6 hours as needed", route: "oral", rxNormCode: "835603" },
      { name: "Amlodipine", dose: "5mg", frequency: "daily", route: "oral", rxNormCode: "308135" },
      { name: "Potassium Chloride", dose: "20mEq", frequency: "daily", route: "oral", rxNormCode: "628958" },
      { name: "Ferrous Sulfate", dose: "325mg", frequency: "daily", route: "oral", rxNormCode: "310325" },
    ],
    allergies: ["Penicillin", "Sulfa drugs", "Codeine", "NSAIDs"],
    recentLabs: [
      { name: "INR", value: 4.2, unit: "", referenceRange: "2.0-3.0", date: "2026-01-26", abnormal: true },
      { name: "Creatinine", value: 2.1, unit: "mg/dL", referenceRange: "0.7-1.3", date: "2026-01-26", abnormal: true },
      { name: "eGFR", value: 32, unit: "mL/min/1.73m2", referenceRange: ">60", date: "2026-01-26", abnormal: true },
      { name: "HbA1c", value: 9.1, unit: "%", referenceRange: "<7.0", date: "2026-01-24", abnormal: true },
      { name: "Potassium", value: 5.6, unit: "mEq/L", referenceRange: "3.5-5.0", date: "2026-01-26", abnormal: true },
      { name: "Digoxin Level", value: 2.4, unit: "ng/mL", referenceRange: "0.8-2.0", date: "2026-01-26", abnormal: true },
      { name: "BNP", value: 1250, unit: "pg/mL", referenceRange: "<100", date: "2026-01-26", abnormal: true },
    ],
    vitalSigns: {
      bloodPressure: "98/58",
      heartRate: 52,
      temperature: 97.2,
      respiratoryRate: 22,
      oxygenSaturation: 89,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },

  // Social risk patient - homeless with COPD (expected: not_ready, score 20-50)
  "demo-social-risk": {
    id: "demo-social-risk",
    name: "David Thompson",
    age: 52,
    gender: "M",
    mrn: "MRN-2024-012",
    admissionDate: "2026-01-20",
    diagnoses: [
      {
        code: "J44.1",
        display: "COPD with acute exacerbation",
        status: "active",
      },
      {
        code: "Z59.0",
        display: "Homelessness",
        status: "active",
      },
      {
        code: "F10.20",
        display: "Alcohol use disorder, moderate",
        status: "active",
      },
      {
        code: "F17.210",
        display: "Nicotine dependence, cigarettes",
        status: "active",
      },
    ],
    medications: [
      { name: "Prednisone", dose: "40mg", frequency: "daily", route: "oral", rxNormCode: "312617" },
      { name: "Albuterol", dose: "2 puffs", frequency: "every 4 hours", route: "inhalation", rxNormCode: "801917" },
      { name: "Ipratropium-Albuterol", dose: "3mL", frequency: "every 6 hours", route: "nebulizer", rxNormCode: "826717" },
      { name: "Azithromycin", dose: "500mg", frequency: "daily", route: "oral", rxNormCode: "308460" },
      { name: "Thiamine", dose: "100mg", frequency: "daily", route: "oral", rxNormCode: "198313" },
      { name: "Folic Acid", dose: "1mg", frequency: "daily", route: "oral", rxNormCode: "310367" },
    ],
    allergies: [],
    recentLabs: [
      { name: "WBC", value: 14.2, unit: "x10^9/L", referenceRange: "4.5-11.0", date: "2026-01-26", abnormal: true },
      { name: "ABG pH", value: 7.32, unit: "", referenceRange: "7.35-7.45", date: "2026-01-26", abnormal: true },
      { name: "pCO2", value: 52, unit: "mmHg", referenceRange: "35-45", date: "2026-01-26", abnormal: true },
      { name: "GGT", value: 185, unit: "U/L", referenceRange: "9-48", date: "2026-01-25", abnormal: true },
    ],
    vitalSigns: {
      bloodPressure: "138/86",
      heartRate: 98,
      temperature: 99.4,
      respiratoryRate: 24,
      oxygenSaturation: 90,
      recordedAt: "2026-01-26T08:00:00Z",
    },
  },
};

export function getPatient(id: string): Patient | null {
  return demoPatients[id] || null;
}

export function getAllPatients(): Patient[] {
  return Object.values(demoPatients);
}
