/**
 * Clinical Guidelines Checker
 * Evaluates patient data against evidence-based clinical guidelines
 */

import type { Patient, Diagnosis, Medication, LabResult } from "../types/patient";

export interface CareGap {
  id: string;
  guideline: string;
  organization: string;
  recommendation: string;
  grade: "A" | "B" | "C" | "D" | "I"; // USPSTF grades
  status: "met" | "unmet" | "not_applicable";
  evidence?: string;
  dueDate?: string;
}

interface GuidelineRule {
  id: string;
  name: string;
  organization: string;
  grade: CareGap["grade"];
  applicableConditions: string[];
  applicableMedications?: string[];
  minAge?: number;
  maxAge?: number;
  gender?: "M" | "F";
  check: (patient: Patient) => CareGap["status"];
  recommendation: string;
  evidence?: string;
}

const CLINICAL_GUIDELINES: GuidelineRule[] = [
  // Heart Failure Guidelines (ACC/AHA)
  {
    id: "hf-ace-arb",
    name: "ACE Inhibitor or ARB for Heart Failure",
    organization: "ACC/AHA",
    grade: "A",
    applicableConditions: ["I50", "heart failure"],
    check: (patient) => {
      const hasHeartFailure = patient.diagnoses.some(
        (d) => d.code.startsWith("I50") || d.display.toLowerCase().includes("heart failure")
      );
      if (!hasHeartFailure) return "not_applicable";

      const hasACEorARB = patient.medications.some((m) => {
        const name = m.name.toLowerCase();
        return (
          name.includes("lisinopril") ||
          name.includes("enalapril") ||
          name.includes("ramipril") ||
          name.includes("losartan") ||
          name.includes("valsartan") ||
          name.includes("sacubitril")
        );
      });
      return hasACEorARB ? "met" : "unmet";
    },
    recommendation: "Patient with heart failure should be on ACE inhibitor, ARB, or ARNI unless contraindicated.",
    evidence: "Reduces mortality by 16-40% in HFrEF patients",
  },
  {
    id: "hf-beta-blocker",
    name: "Beta Blocker for Heart Failure",
    organization: "ACC/AHA",
    grade: "A",
    applicableConditions: ["I50", "heart failure"],
    check: (patient) => {
      const hasHeartFailure = patient.diagnoses.some(
        (d) => d.code.startsWith("I50") || d.display.toLowerCase().includes("heart failure")
      );
      if (!hasHeartFailure) return "not_applicable";

      const hasBetaBlocker = patient.medications.some((m) => {
        const name = m.name.toLowerCase();
        return (
          name.includes("carvedilol") ||
          name.includes("metoprolol") ||
          name.includes("bisoprolol")
        );
      });
      return hasBetaBlocker ? "met" : "unmet";
    },
    recommendation: "Patient with heart failure should be on evidence-based beta-blocker (carvedilol, metoprolol succinate, or bisoprolol).",
    evidence: "Reduces mortality by 34% in HFrEF patients",
  },

  // Diabetes Guidelines (ADA)
  {
    id: "dm-a1c-control",
    name: "HbA1c < 7% for Most Diabetics",
    organization: "ADA",
    grade: "A",
    applicableConditions: ["E11", "diabetes"],
    check: (patient) => {
      const hasDiabetes = patient.diagnoses.some(
        (d) => d.code.startsWith("E11") || d.display.toLowerCase().includes("diabetes")
      );
      if (!hasDiabetes) return "not_applicable";

      const a1cLab = patient.recentLabs?.find((l) =>
        l.name.toLowerCase().includes("a1c") || l.name.toLowerCase().includes("hba1c")
      );
      if (!a1cLab) return "unmet";
      return a1cLab.value < 7.0 ? "met" : "unmet";
    },
    recommendation: "HbA1c target < 7.0% for most non-pregnant adults with diabetes. Current A1c is above target.",
    evidence: "Each 1% reduction in A1c reduces microvascular complications by ~40%",
  },
  {
    id: "dm-statin",
    name: "Statin Therapy for Diabetics 40-75",
    organization: "ADA",
    grade: "A",
    applicableConditions: ["E11", "diabetes"],
    minAge: 40,
    maxAge: 75,
    check: (patient) => {
      const hasDiabetes = patient.diagnoses.some(
        (d) => d.code.startsWith("E11") || d.display.toLowerCase().includes("diabetes")
      );
      if (!hasDiabetes || patient.age < 40 || patient.age > 75) return "not_applicable";

      const hasStatin = patient.medications.some((m) => {
        const name = m.name.toLowerCase();
        return (
          name.includes("statin") ||
          name.includes("atorvastatin") ||
          name.includes("rosuvastatin") ||
          name.includes("simvastatin") ||
          name.includes("pravastatin")
        );
      });
      return hasStatin ? "met" : "unmet";
    },
    recommendation: "Adults 40-75 with diabetes should be on moderate-to-high intensity statin therapy.",
    evidence: "Reduces cardiovascular events by 25-40%",
  },

  // Anticoagulation Guidelines
  {
    id: "afib-anticoag",
    name: "Anticoagulation for Atrial Fibrillation",
    organization: "ACC/AHA/HRS",
    grade: "A",
    applicableConditions: ["I48", "atrial fibrillation", "afib"],
    check: (patient) => {
      const hasAfib = patient.diagnoses.some(
        (d) => d.code.startsWith("I48") || d.display.toLowerCase().includes("atrial fibrillation")
      );
      if (!hasAfib) return "not_applicable";

      const hasAnticoag = patient.medications.some((m) => {
        const name = m.name.toLowerCase();
        return (
          name.includes("warfarin") ||
          name.includes("apixaban") ||
          name.includes("eliquis") ||
          name.includes("rivaroxaban") ||
          name.includes("xarelto") ||
          name.includes("dabigatran") ||
          name.includes("edoxaban")
        );
      });
      return hasAnticoag ? "met" : "unmet";
    },
    recommendation: "Patients with atrial fibrillation should be on anticoagulation if CHA2DS2-VASc score >= 2 (men) or >= 3 (women).",
    evidence: "Reduces stroke risk by 60-70%",
  },
  {
    id: "afib-inr-control",
    name: "INR in Therapeutic Range for Warfarin",
    organization: "ACC/AHA",
    grade: "A",
    applicableMedications: ["warfarin"],
    check: (patient) => {
      const onWarfarin = patient.medications.some((m) =>
        m.name.toLowerCase().includes("warfarin")
      );
      if (!onWarfarin) return "not_applicable";

      const inrLab = patient.recentLabs?.find((l) =>
        l.name.toLowerCase().includes("inr")
      );
      if (!inrLab) return "unmet";
      return inrLab.value >= 2.0 && inrLab.value <= 3.0 ? "met" : "unmet";
    },
    recommendation: "INR should be maintained between 2.0-3.0 for atrial fibrillation. Current INR is out of range.",
    evidence: "Supratherapeutic INR increases bleeding risk; subtherapeutic increases stroke risk",
  },

  // COPD Guidelines (GOLD)
  {
    id: "copd-inhaler",
    name: "Inhaled Bronchodilator for COPD",
    organization: "GOLD",
    grade: "A",
    applicableConditions: ["J44", "copd", "chronic obstructive"],
    check: (patient) => {
      const hasCOPD = patient.diagnoses.some(
        (d) => d.code.startsWith("J44") || d.display.toLowerCase().includes("copd")
      );
      if (!hasCOPD) return "not_applicable";

      const hasInhaler = patient.medications.some((m) => {
        const name = m.name.toLowerCase();
        return (
          name.includes("albuterol") ||
          name.includes("tiotropium") ||
          name.includes("spiriva") ||
          name.includes("ipratropium") ||
          name.includes("formoterol") ||
          name.includes("salmeterol")
        );
      });
      return hasInhaler ? "met" : "unmet";
    },
    recommendation: "COPD patients should have bronchodilator therapy. Consider LAMA or LABA for maintenance.",
    evidence: "Reduces exacerbations and improves quality of life",
  },

  // Hypertension Guidelines (ACC/AHA)
  {
    id: "htn-bp-control",
    name: "Blood Pressure at Target",
    organization: "ACC/AHA",
    grade: "A",
    applicableConditions: ["I10", "hypertension"],
    check: (patient) => {
      const hasHTN = patient.diagnoses.some(
        (d) => d.code.startsWith("I10") || d.display.toLowerCase().includes("hypertension")
      );
      if (!hasHTN) return "not_applicable";

      if (!patient.vitalSigns?.bloodPressure) return "unmet";

      const [systolic, diastolic] = patient.vitalSigns.bloodPressure.split("/").map(Number);
      // Target <130/80 for most patients per 2017 guidelines
      return systolic < 130 && diastolic < 80 ? "met" : "unmet";
    },
    recommendation: "Blood pressure target is <130/80 mmHg for most patients. Current BP is above target.",
    evidence: "Intensive BP control reduces cardiovascular events by 25%",
  },

  // Discharge-specific Guidelines
  {
    id: "discharge-followup",
    name: "Follow-up Appointment Scheduled",
    organization: "CMS/TJC",
    grade: "A",
    applicableConditions: [], // Applies to all
    check: () => {
      // This would need additional data about scheduled appointments
      // For now, return unmet as a conservative default
      return "unmet";
    },
    recommendation: "Schedule follow-up appointment with PCP or specialist within 7-14 days of discharge.",
    evidence: "Reduces 30-day readmission rates by 10-20%",
  },
  {
    id: "discharge-med-reconciliation",
    name: "Medication Reconciliation Completed",
    organization: "TJC",
    grade: "A",
    applicableConditions: [],
    check: (patient) => {
      // If patient has medications documented, assume reconciliation started
      return patient.medications.length > 0 ? "met" : "unmet";
    },
    recommendation: "Complete medication reconciliation comparing admission, inpatient, and discharge medications.",
    evidence: "Reduces medication errors and adverse drug events post-discharge",
  },
];

/**
 * Evaluate patient against clinical guidelines and identify care gaps
 */
export function evaluateCareGaps(patient: Patient): CareGap[] {
  const careGaps: CareGap[] = [];

  for (const rule of CLINICAL_GUIDELINES) {
    // Check age criteria
    if (rule.minAge && patient.age < rule.minAge) continue;
    if (rule.maxAge && patient.age > rule.maxAge) continue;

    // Check gender criteria
    if (rule.gender && patient.gender !== rule.gender) continue;

    const status = rule.check(patient);

    // Only add if applicable (met or unmet)
    if (status !== "not_applicable") {
      careGaps.push({
        id: rule.id,
        guideline: rule.name,
        organization: rule.organization,
        grade: rule.grade,
        status,
        recommendation: rule.recommendation,
        evidence: rule.evidence,
      });
    }
  }

  return careGaps;
}

/**
 * Get only unmet care gaps (action items)
 */
export function getUnmetCareGaps(patient: Patient): CareGap[] {
  return evaluateCareGaps(patient).filter((g) => g.status === "unmet");
}

/**
 * Calculate care gap compliance rate
 */
export function calculateComplianceRate(patient: Patient): number {
  const gaps = evaluateCareGaps(patient).filter((g) => g.status !== "not_applicable");
  if (gaps.length === 0) return 100;

  const metCount = gaps.filter((g) => g.status === "met").length;
  return Math.round((metCount / gaps.length) * 100);
}
