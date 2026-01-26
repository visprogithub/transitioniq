import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Patient } from "../types/patient";
import type { DischargeAnalysis, RiskFactor } from "../types/analysis";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
// Use gemini-2.0-flash - available in the API
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

export async function analyzeDischargeReadiness(
  patient: Patient,
  drugInteractions: DrugInteraction[],
  careGaps: CareGap[],
  costEstimates: CostEstimate[]
): Promise<DischargeAnalysis> {
  const prompt = buildAnalysisPrompt(patient, drugInteractions, careGaps, costEstimates);

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  return parseAnalysisResponse(patient.id, responseText);
}

interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: "major" | "moderate" | "minor";
  description: string;
  faersCount?: number;
}

interface CareGap {
  guideline: string;
  recommendation: string;
  grade: string;
  status: "met" | "unmet" | "not_applicable";
}

interface CostEstimate {
  medication: string;
  monthlyOOP: number;
  covered: boolean;
}

function buildAnalysisPrompt(
  patient: Patient,
  drugInteractions: DrugInteraction[],
  careGaps: CareGap[],
  costEstimates: CostEstimate[]
): string {
  return `You are a clinical decision support system analyzing discharge readiness.

## Patient Information
- Name: ${patient.name}
- Age: ${patient.age} years old, ${patient.gender === "M" ? "Male" : patient.gender === "F" ? "Female" : "Other"}
- Admission Date: ${patient.admissionDate}
- Diagnoses: ${patient.diagnoses.map((d) => d.display).join(", ")}
- Current Medications (${patient.medications.length}):
${patient.medications.map((m) => `  - ${m.name} ${m.dose} ${m.frequency}`).join("\n")}
- Allergies: ${patient.allergies.length > 0 ? patient.allergies.join(", ") : "None documented"}

## Drug Interaction Analysis (FDA)
${
  drugInteractions.length > 0
    ? drugInteractions
        .map(
          (i) =>
            `- ${i.drug1} + ${i.drug2}: ${i.severity.toUpperCase()} - ${i.description}${i.faersCount ? ` (${i.faersCount} FAERS reports)` : ""}`
        )
        .join("\n")
    : "No significant interactions detected"
}

## Care Gap Analysis (Clinical Guidelines)
${
  careGaps.filter((g) => g.status === "unmet").length > 0
    ? careGaps
        .filter((g) => g.status === "unmet")
        .map((g) => `- ${g.guideline} (Grade ${g.grade}): ${g.recommendation}`)
        .join("\n")
    : "All applicable guidelines met"
}

## Cost Barrier Analysis (CMS)
${
  costEstimates.filter((c) => c.monthlyOOP > 50).length > 0
    ? costEstimates
        .filter((c) => c.monthlyOOP > 50)
        .map((c) => `- ${c.medication}: $${c.monthlyOOP}/month OOP${!c.covered ? " (NOT COVERED)" : ""}`)
        .join("\n")
    : "No significant cost barriers identified"
}

## Task
Analyze this patient's discharge readiness and provide:

1. An overall readiness score from 0-100 (higher = more ready)
2. A list of risk factors categorized by severity (high/moderate/low)
3. Specific recommendations for safe discharge

Respond in this exact JSON format:
{
  "score": <number 0-100>,
  "status": "<ready|caution|not_ready>",
  "riskFactors": [
    {
      "severity": "<high|moderate|low>",
      "category": "<drug_interaction|care_gap|follow_up|cost_barrier|patient_education>",
      "title": "<short title>",
      "description": "<detailed description>",
      "source": "<FDA|CMS|Guidelines|FHIR>",
      "actionable": <true|false>,
      "resolution": "<suggested action if actionable>"
    }
  ],
  "recommendations": ["<recommendation 1>", "<recommendation 2>", ...]
}

Be conservative - if there are major drug interactions or unmet care gaps, the score should reflect significant risk.`;
}

function parseAnalysisResponse(patientId: string, responseText: string): DischargeAnalysis {
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const riskFactors: RiskFactor[] = (parsed.riskFactors || []).map(
      (rf: Record<string, unknown>, index: number) => ({
        id: `rf-${index}`,
        severity: rf.severity as RiskFactor["severity"],
        category: rf.category as RiskFactor["category"],
        title: rf.title as string,
        description: rf.description as string,
        source: rf.source as RiskFactor["source"],
        actionable: rf.actionable as boolean,
        resolution: rf.resolution as string | undefined,
      })
    );

    return {
      patientId,
      score: Math.max(0, Math.min(100, parsed.score)),
      status: parsed.status,
      riskFactors,
      recommendations: parsed.recommendations || [],
      analyzedAt: new Date().toISOString(),
    };
  } catch {
    return {
      patientId,
      score: 50,
      status: "caution",
      riskFactors: [
        {
          id: "rf-error",
          severity: "moderate",
          category: "patient_education",
          title: "Analysis incomplete",
          description: "Unable to fully analyze patient data. Manual review recommended.",
          source: "Internal",
          actionable: true,
          resolution: "Review patient chart manually",
        },
      ],
      recommendations: ["Manual review recommended due to analysis limitations"],
      analyzedAt: new Date().toISOString(),
    };
  }
}

export async function generateDischargePlan(
  patient: Patient,
  analysis: DischargeAnalysis
): Promise<string> {
  const prompt = `Based on the discharge analysis for ${patient.name} (score: ${analysis.score}/100), generate a discharge checklist.

Risk factors identified:
${analysis.riskFactors.map((rf) => `- [${rf.severity.toUpperCase()}] ${rf.title}: ${rf.description}`).join("\n")}

Generate a practical discharge checklist with:
1. Medication reconciliation tasks
2. Follow-up appointments needed
3. Patient education items
4. Warning signs to watch for

Format as a clear, actionable checklist.`;

  const result = await model.generateContent(prompt);
  return result.response.text();
}
