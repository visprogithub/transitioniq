export interface DischargeAnalysis {
  patientId: string;
  score: number;
  status: "ready" | "caution" | "not_ready";
  riskFactors: RiskFactor[];
  recommendations: string[];
  analyzedAt: string;
  tracingId?: string;
  modelUsed?: string;
}

export interface RiskFactor {
  id: string;
  severity: "high" | "moderate" | "low";
  category: RiskCategory;
  title: string;
  description: string;
  source: DataSource;
  actionable: boolean;
  resolution?: string;
}

export type RiskCategory =
  | "drug_interaction"
  | "care_gap"
  | "follow_up"
  | "cost_barrier"
  | "patient_education"
  | "lab_abnormality"
  | "vital_sign"
  | "social_determinant";

export type DataSource = "FHIR" | "FDA" | "CMS" | "Guidelines" | "Internal";

export interface DischargePlan {
  patientId: string;
  generatedAt: string;
  checklist: ChecklistItem[];
  medicationList: MedicationReconciliation[];
  followUpAppointments: FollowUpAppointment[];
  patientInstructions: string[];
}

export interface ChecklistItem {
  id: string;
  category: string;
  task: string;
  completed: boolean;
  required: boolean;
  assignedTo?: string;
}

export interface MedicationReconciliation {
  medication: string;
  status: "continue" | "discontinue" | "new" | "modified";
  instructions: string;
  warnings?: string[];
}

export interface FollowUpAppointment {
  specialty: string;
  provider?: string;
  timeframe: string;
  scheduled: boolean;
  reason: string;
}

// Clinician edits overlay — additions and dismissals on top of AI-generated plan
export interface ClinicianEdit {
  id: string;
  text: string;
  priority: "high" | "moderate" | "standard";
  addedAt: string;
}

export interface ClinicianEdits {
  customItems: ClinicianEdit[];
  dismissedItemKeys: string[]; // keys like "0-2" (sectionIdx-itemIdx)
}
