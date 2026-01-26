export interface Patient {
  id: string;
  name: string;
  age: number;
  gender: "M" | "F" | "O";
  mrn?: string;
  admissionDate: string;
  diagnoses: Diagnosis[];
  medications: Medication[];
  allergies: string[];
  recentLabs?: LabResult[];
  vitalSigns?: VitalSigns;
}

export interface Diagnosis {
  code: string;
  display: string;
  onsetDate?: string;
  status: "active" | "resolved" | "inactive";
}

export interface Medication {
  name: string;
  dose: string;
  frequency: string;
  route: string;
  startDate?: string;
  rxNormCode?: string;
  ndc?: string;
}

export interface LabResult {
  name: string;
  value: number;
  unit: string;
  referenceRange: string;
  date: string;
  abnormal: boolean;
}

export interface VitalSigns {
  bloodPressure?: string;
  heartRate?: number;
  temperature?: number;
  respiratoryRate?: number;
  oxygenSaturation?: number;
  recordedAt: string;
}
