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
};

export function getPatient(id: string): Patient | null {
  return demoPatients[id] || null;
}

export function getAllPatients(): Patient[] {
  return Object.values(demoPatients);
}
