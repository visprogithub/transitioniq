/**
 * @deprecated OBSOLETE — This local prompt registry has been superseded by
 * `src/lib/integrations/opik-prompts.ts`, which manages all prompt templates
 * through the Opik Prompt Library with versioning, caching, and fallback.
 *
 * This file is retained for reference only. Do not add new prompts here.
 * All new prompt work should go through opik-prompts.ts.
 *
 * Original purpose:
 * Prompt Registry - Versioned prompts for Opik tracking and A/B experiments
 *
 * Each prompt has:
 * - A unique ID and version
 * - The actual prompt template
 * - Metadata for Opik tracking
 *
 * This enables:
 * - Prompt versioning (track which version produced which results)
 * - A/B experiments (compare prompt variants)
 * - Opik evaluation dashboard integration
 */

export interface PromptVersion {
  id: string;
  version: string;
  name: string;
  template: string;
  variables: string[];
  metadata: {
    author: string;
    createdAt: string;
    description: string;
    tags: string[];
  };
}

export interface PromptRegistry {
  [promptId: string]: PromptVersion[];
}

/**
 * All prompts used by the agent, versioned for tracking
 */
export const PROMPT_REGISTRY: PromptRegistry = {
  "discharge-analysis": [
    {
      id: "discharge-analysis",
      version: "1.0.0",
      name: "Discharge Analysis Prompt v1",
      template: `You are a clinical decision support AI assessing discharge readiness.

Patient: {{patientName}} ({{patientAge}}{{patientGender}})
Medications: {{medicationCount}} active medications
Conditions: {{conditionList}}

Risk Factors Identified:
{{riskFactorSummary}}

Drug Interactions: {{interactionCount}} found
Care Gaps: {{careGapCount}} unmet guidelines

Based on this data, provide:
1. A discharge readiness score from 0-100
2. Status: ready, caution, or not_ready
3. Top 3 recommendations

Respond in JSON format:
{
  "score": number,
  "status": "ready" | "caution" | "not_ready",
  "reasoning": "string",
  "recommendations": ["string", "string", "string"]
}`,
      variables: [
        "patientName",
        "patientAge",
        "patientGender",
        "medicationCount",
        "conditionList",
        "riskFactorSummary",
        "interactionCount",
        "careGapCount",
      ],
      metadata: {
        author: "system",
        createdAt: "2025-01-26T00:00:00Z",
        description: "Initial discharge analysis prompt - straightforward clinical assessment",
        tags: ["discharge", "clinical", "v1"],
      },
    },
    {
      id: "discharge-analysis",
      version: "1.1.0",
      name: "Discharge Analysis Prompt v1.1 (Enhanced)",
      template: `You are an expert clinical decision support AI specializing in discharge readiness assessment and readmission prevention.

## Patient Summary
- Name: {{patientName}}
- Age: {{patientAge}} | Gender: {{patientGender}}
- Active Medications: {{medicationCount}}
- Primary Conditions: {{conditionList}}

## Risk Assessment Data

### Drug Interactions ({{interactionCount}} identified)
{{riskFactorSummary}}

### Guideline Compliance
- Care Gaps: {{careGapCount}} unmet recommendations
- Critical gaps require immediate attention before discharge

## Your Task

Analyze this patient's discharge readiness considering:
1. Medication safety (interactions, polypharmacy risk)
2. Care gap severity (Grade A vs B vs C recommendations)
3. Patient complexity (age, comorbidities)
4. Readmission risk factors

Provide your assessment as JSON:
{
  "score": <0-100, where 70+ is ready, 40-69 is caution, <40 is not ready>,
  "status": "ready" | "caution" | "not_ready",
  "confidence": <0.0-1.0>,
  "reasoning": "<2-3 sentence clinical rationale>",
  "recommendations": [
    "<most critical action>",
    "<second priority>",
    "<third priority>"
  ],
  "readmissionRisk": "low" | "moderate" | "high"
}`,
      variables: [
        "patientName",
        "patientAge",
        "patientGender",
        "medicationCount",
        "conditionList",
        "riskFactorSummary",
        "interactionCount",
        "careGapCount",
      ],
      metadata: {
        author: "system",
        createdAt: "2025-01-26T00:00:00Z",
        description: "Enhanced prompt with structured sections, confidence score, and readmission risk",
        tags: ["discharge", "clinical", "v1.1", "enhanced"],
      },
    },
  ],

  "risk-explanation": [
    {
      id: "risk-explanation",
      version: "1.0.0",
      name: "Risk Factor Explanation",
      template: `Explain this clinical risk factor in patient-friendly language:

Risk: {{riskTitle}}
Severity: {{severity}}
Category: {{category}}
Details: {{description}}

Provide:
1. A simple explanation (2-3 sentences, no medical jargon)
2. Why this matters for discharge
3. What the patient/caregiver should watch for`,
      variables: ["riskTitle", "severity", "category", "description"],
      metadata: {
        author: "system",
        createdAt: "2025-01-26T00:00:00Z",
        description: "Explains risk factors for patient education",
        tags: ["education", "patient-facing"],
      },
    },
  ],

  "plan-generation": [
    {
      id: "plan-generation",
      version: "1.0.0",
      name: "Discharge Plan Generation",
      template: `Generate a discharge planning checklist for:

Patient: {{patientName}}
Score: {{score}}/100 ({{status}})
High-Risk Factors: {{highRiskCount}}
Moderate-Risk Factors: {{moderateRiskCount}}

Risk Details:
{{riskDetails}}

Create a prioritized checklist with:
1. MUST DO items (high-risk factors)
2. SHOULD DO items (moderate-risk factors)
3. STANDARD items (routine discharge tasks)

Format as a clear, actionable checklist.`,
      variables: [
        "patientName",
        "score",
        "status",
        "highRiskCount",
        "moderateRiskCount",
        "riskDetails",
      ],
      metadata: {
        author: "system",
        createdAt: "2025-01-26T00:00:00Z",
        description: "Generates actionable discharge checklist",
        tags: ["planning", "checklist"],
      },
    },
  ],
};

/**
 * Get the latest version of a prompt
 */
export function getLatestPrompt(promptId: string): PromptVersion | undefined {
  const versions = PROMPT_REGISTRY[promptId];
  if (!versions || versions.length === 0) return undefined;
  return versions[versions.length - 1];
}

/**
 * Get a specific version of a prompt
 */
export function getPromptVersion(promptId: string, version: string): PromptVersion | undefined {
  const versions = PROMPT_REGISTRY[promptId];
  if (!versions) return undefined;
  return versions.find((p) => p.version === version);
}

/**
 * List all prompts with their versions
 */
export function listPrompts(): Array<{ id: string; versions: string[]; latest: string }> {
  return Object.entries(PROMPT_REGISTRY).map(([id, versions]) => ({
    id,
    versions: versions.map((v) => v.version),
    latest: versions[versions.length - 1]?.version || "none",
  }));
}

/**
 * Fill a prompt template with variables
 */
export function fillPrompt(prompt: PromptVersion, variables: Record<string, string | number>): string {
  let filled = prompt.template;
  for (const [key, value] of Object.entries(variables)) {
    filled = filled.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }
  return filled;
}

/**
 * Get prompt metadata for Opik tracing
 */
export function getPromptMetadata(prompt: PromptVersion): Record<string, string | number> {
  return {
    prompt_id: prompt.id,
    prompt_version: prompt.version,
    prompt_name: prompt.name,
    prompt_author: prompt.metadata.author,
    prompt_tags: prompt.metadata.tags.join(","),
  };
}
