import type { RiskFactor } from "../types/analysis";

export interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: "major" | "moderate" | "minor";
  description: string;
  faersCount?: number;
}

export interface CareGap {
  guideline: string;
  recommendation: string;
  grade: string;
  status: "met" | "unmet" | "not_applicable";
}

export interface CostEstimate {
  medication: string;
  monthlyOOP: number;
  covered: boolean;
}

export const mockDrugInteractions: Record<string, DrugInteraction[]> = {
  "demo-polypharmacy": [
    {
      drug1: "Warfarin",
      drug2: "Aspirin",
      severity: "major",
      description: "Increased risk of bleeding. Concurrent use significantly elevates hemorrhage risk.",
      faersCount: 847,
    },
    {
      drug1: "Warfarin",
      drug2: "Eliquis",
      severity: "major",
      description: "Duplicate anticoagulation therapy. Should not be used together.",
      faersCount: 234,
    },
    {
      drug1: "Metformin",
      drug2: "Furosemide",
      severity: "moderate",
      description: "Loop diuretics may decrease metformin effectiveness.",
      faersCount: 156,
    },
    {
      drug1: "Lisinopril",
      drug2: "Potassium Chloride",
      severity: "moderate",
      description: "ACE inhibitors can increase potassium levels. Monitor closely.",
      faersCount: 89,
    },
  ],
  "demo-heart-failure": [
    {
      drug1: "Digoxin",
      drug2: "Furosemide",
      severity: "moderate",
      description: "Loop diuretics can cause hypokalemia, increasing digoxin toxicity risk.",
      faersCount: 423,
    },
    {
      drug1: "Carvedilol",
      drug2: "Digoxin",
      severity: "moderate",
      description: "Beta-blockers may increase digoxin levels and bradycardia risk.",
      faersCount: 178,
    },
  ],
  "demo-ready": [],
};

export const mockCareGaps: Record<string, CareGap[]> = {
  "demo-polypharmacy": [
    {
      guideline: "USPSTF Colon Cancer Screening",
      recommendation: "Adults 45-75 should be screened for colorectal cancer",
      grade: "A",
      status: "unmet",
    },
    {
      guideline: "ADA Diabetes Management",
      recommendation: "HbA1c target <7% for most adults with diabetes",
      grade: "A",
      status: "unmet",
    },
    {
      guideline: "ACC/AHA Anticoagulation",
      recommendation: "Single anticoagulant therapy recommended for AFib",
      grade: "A",
      status: "unmet",
    },
  ],
  "demo-heart-failure": [
    {
      guideline: "ACC/AHA Heart Failure Guidelines",
      recommendation: "Beta-blocker and ACE-I optimized dosing",
      grade: "A",
      status: "met",
    },
    {
      guideline: "Heart Failure Self-Care Education",
      recommendation: "Daily weight monitoring education provided",
      grade: "B",
      status: "unmet",
    },
    {
      guideline: "COPD Maintenance Therapy",
      recommendation: "Long-acting bronchodilator use",
      grade: "A",
      status: "met",
    },
  ],
  "demo-ready": [
    {
      guideline: "Post-Surgical Recovery",
      recommendation: "Activity restrictions reviewed",
      grade: "C",
      status: "met",
    },
  ],
};

export const mockCostEstimates: Record<string, CostEstimate[]> = {
  "demo-polypharmacy": [
    { medication: "Eliquis", monthlyOOP: 125, covered: true },
    { medication: "Gabapentin", monthlyOOP: 15, covered: true },
    { medication: "Atorvastatin", monthlyOOP: 8, covered: true },
    { medication: "Metformin", monthlyOOP: 4, covered: true },
    { medication: "Warfarin", monthlyOOP: 12, covered: true },
    { medication: "Lisinopril", monthlyOOP: 6, covered: true },
  ],
  "demo-heart-failure": [
    { medication: "Carvedilol", monthlyOOP: 18, covered: true },
    { medication: "Tiotropium", monthlyOOP: 89, covered: true },
    { medication: "Digoxin", monthlyOOP: 22, covered: true },
  ],
  "demo-ready": [
    { medication: "Acetaminophen", monthlyOOP: 5, covered: true },
    { medication: "Ibuprofen", monthlyOOP: 4, covered: true },
  ],
};

export const mockFollowUpStatus: Record<string, { hasPCP: boolean; hasSpecialist: boolean; within7Days: boolean }> = {
  "demo-polypharmacy": { hasPCP: false, hasSpecialist: false, within7Days: false },
  "demo-heart-failure": { hasPCP: true, hasSpecialist: true, within7Days: true },
  "demo-ready": { hasPCP: true, hasSpecialist: false, within7Days: true },
};

export function getMockRiskFactors(patientId: string): RiskFactor[] {
  const interactions = mockDrugInteractions[patientId] || [];
  const gaps = mockCareGaps[patientId] || [];
  const costs = mockCostEstimates[patientId] || [];
  const followUp = mockFollowUpStatus[patientId] || { hasPCP: true, hasSpecialist: true, within7Days: true };

  const factors: RiskFactor[] = [];

  interactions.forEach((interaction, idx) => {
    factors.push({
      id: `int-${idx}`,
      severity: interaction.severity === "major" ? "high" : "moderate",
      category: "drug_interaction",
      title: `${interaction.drug1} + ${interaction.drug2} Interaction`,
      description: `${interaction.description}${interaction.faersCount ? ` (${interaction.faersCount} FAERS adverse event reports)` : ""}`,
      source: "FDA",
      actionable: true,
      resolution:
        interaction.severity === "major"
          ? "Consult pharmacy for medication review before discharge"
          : "Monitor closely and document rationale for concurrent use",
    });
  });

  gaps
    .filter((g) => g.status === "unmet")
    .forEach((gap, idx) => {
      factors.push({
        id: `gap-${idx}`,
        severity: gap.grade === "A" ? "high" : "moderate",
        category: "care_gap",
        title: `${gap.guideline}`,
        description: gap.recommendation,
        source: "Guidelines",
        actionable: true,
        resolution: `Address ${gap.guideline.toLowerCase()} before discharge or schedule follow-up`,
      });
    });

  if (!followUp.hasPCP) {
    factors.push({
      id: "fu-pcp",
      severity: "high",
      category: "follow_up",
      title: "No PCP Follow-up Scheduled",
      description: "Patient does not have a primary care follow-up appointment within 7 days of discharge",
      source: "FHIR",
      actionable: true,
      resolution: "Schedule PCP appointment before discharge",
    });
  }

  if (!followUp.hasSpecialist && interactions.some((i) => i.severity === "major")) {
    factors.push({
      id: "fu-spec",
      severity: "moderate",
      category: "follow_up",
      title: "Specialist Follow-up Recommended",
      description: "Complex medication regimen warrants cardiology/pharmacy follow-up",
      source: "Internal",
      actionable: true,
      resolution: "Schedule specialist appointment within 2 weeks",
    });
  }

  const highCostMeds = costs.filter((c) => c.monthlyOOP > 50);
  if (highCostMeds.length > 0) {
    const totalMonthly = highCostMeds.reduce((sum, c) => sum + c.monthlyOOP, 0);
    factors.push({
      id: "cost-barrier",
      severity: totalMonthly > 150 ? "high" : "moderate",
      category: "cost_barrier",
      title: `High Medication Costs: $${totalMonthly}/month`,
      description: `${highCostMeds.length} medication(s) with significant out-of-pocket costs: ${highCostMeds.map((c) => `${c.medication} ($${c.monthlyOOP})`).join(", ")}`,
      source: "CMS",
      actionable: true,
      resolution: "Discuss generic alternatives or patient assistance programs",
    });
  }

  return factors;
}
