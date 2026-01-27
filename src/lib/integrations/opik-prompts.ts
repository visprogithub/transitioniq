/**
 * Opik Prompt Library Integration
 *
 * Uses Opik's Prompt Library for:
 * - Versioned prompts with commit tracking
 * - A/B testing between prompt versions
 * - Linking prompts to traces for analysis
 *
 * The prompts are stored in Opik's Prompt Library and can be viewed/edited
 * in the Opik dashboard at https://www.comet.com/opik
 */

import { Opik, type Prompt } from "opik";

let opikClient: Opik | null = null;
let cachedPrompt: Prompt | null = null;

function getOpikClient(): Opik | null {
  if (!process.env.OPIK_API_KEY) {
    return null;
  }

  if (!opikClient) {
    opikClient = new Opik({
      apiKey: process.env.OPIK_API_KEY,
      projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
    });
  }

  return opikClient;
}

/**
 * Discharge Analysis Prompt - stored in Opik Prompt Library
 */
let cachedPlanPrompt: Prompt | null = null;

/**
 * Discharge Plan Generation Prompt - stored in Opik Prompt Library
 */
const DISCHARGE_PLAN_PROMPT = `You are generating a discharge checklist for a care team. Generate ONLY actionable task items based on the patient's specific risk factors.

Patient: {{patient_name}}, {{patient_age}}yo {{patient_gender}}
Discharge Readiness Score: {{score}}/100 ({{status}})

HIGH-SEVERITY RISKS:
{{high_risks}}

MODERATE-SEVERITY RISKS:
{{moderate_risks}}

IMPORTANT FORMATTING RULES:
1. Use ONLY these 5 section headers with ** markers:
   **HIGH PRIORITY - Must Complete Before Discharge**
   **MODERATE PRIORITY - Should Complete**
   **STANDARD TASKS**
   **FOLLOW-UP APPOINTMENTS**
   **PATIENT EDUCATION**

2. Under each header, list actionable tasks as checkbox items:
   - [ ] Task description here

3. DO NOT include:
   - Patient demographic headers (name, DOB, etc.)
   - Placeholder fields like "[To be filled]"
   - Signature lines or form fields
   - Any template-style content

4. Each task must be a SPECIFIC ACTION based on the patient's actual risk factors

Example format:
**HIGH PRIORITY - Must Complete Before Discharge**
- [ ] Review warfarin + aspirin interaction with clinical pharmacist
- [ ] Verify INR is within therapeutic range (2.0-3.0) before discharge

**FOLLOW-UP APPOINTMENTS**
- [ ] Schedule cardiology follow-up within 7 days
- [ ] Arrange PCP visit within 14 days for BP monitoring

Generate the checklist now:`;

/**
 * Discharge Analysis Prompt - stored in Opik Prompt Library
 */
const DISCHARGE_ANALYSIS_PROMPT = `You are a clinical decision support system analyzing discharge readiness.

## Patient Information
- Name: {{patient_name}}
- Age: {{patient_age}} years old, {{patient_gender}}
- Admission Date: {{admission_date}}
- Diagnoses: {{diagnoses}}
- Current Medications ({{medication_count}}):
{{medications}}
- Allergies: {{allergies}}

## Drug Interaction Analysis (FDA)
{{drug_interactions}}

## Care Gap Analysis (Clinical Guidelines)
{{care_gaps}}

## Cost Barrier Analysis (CMS)
{{cost_barriers}}

## Recent Lab Results
{{lab_results}}

## Task
Analyze this patient's discharge readiness and provide:

1. An overall readiness score from 0-100 (higher = more ready)
   - 70-100: Ready for discharge
   - 40-69: Caution - address issues before discharge
   - 0-39: Not ready - significant concerns

2. A list of risk factors categorized by severity (high/moderate/low)

3. Specific recommendations for safe discharge

Respond in this exact JSON format:
{
  "score": <number 0-100>,
  "status": "<ready|caution|not_ready>",
  "reasoning": "<2-3 sentence clinical rationale>",
  "riskFactors": [
    {
      "severity": "<high|moderate|low>",
      "category": "<drug_interaction|care_gap|lab_abnormality|cost_barrier|follow_up>",
      "title": "<short title>",
      "description": "<detailed description>",
      "source": "<FDA|CMS|Guidelines|FHIR>",
      "actionable": <true|false>,
      "resolution": "<suggested action if actionable>"
    }
  ],
  "recommendations": ["<recommendation 1>", "<recommendation 2>", ...]
}

Be conservative - if there are major drug interactions or unmet Grade A guidelines, the score should reflect significant risk.`;

/**
 * Initialize prompts in Opik Prompt Library
 * Creates or updates both discharge-analysis and discharge-plan prompts
 *
 * The prompts will be visible in the Opik dashboard under "Prompts" section.
 * Each change to a template creates a new version that can be tracked.
 */
export async function initializeOpikPrompts(): Promise<{
  promptName: string;
  commit: string;
} | null> {
  const opik = getOpikClient();
  if (!opik) {
    console.log("[Opik] No API key - prompts will not be versioned in Opik Prompt Library");
    return null;
  }

  try {
    // Create/update the discharge analysis prompt in Opik Prompt Library
    const analysisPrompt = await opik.createPrompt({
      name: "discharge-analysis",
      prompt: DISCHARGE_ANALYSIS_PROMPT,
      description: "Clinical discharge readiness assessment prompt for TransitionIQ",
      metadata: {
        version: "2.0",
        author: "transitioniq",
        use_case: "healthcare_discharge_assessment",
      },
      tags: ["clinical", "discharge", "healthcare", "transitioniq"],
      changeDescription: "Updated prompt template for discharge readiness scoring",
    });

    // Cache the prompt for reuse
    cachedPrompt = analysisPrompt;

    const versionInfo = analysisPrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: discharge-analysis (version: ${versionInfo})`);

    // Create/update the discharge plan prompt
    const planPrompt = await opik.createPrompt({
      name: "discharge-plan",
      prompt: DISCHARGE_PLAN_PROMPT,
      description: "Discharge checklist generation prompt for TransitionIQ",
      metadata: {
        version: "1.0",
        author: "transitioniq",
        use_case: "healthcare_discharge_planning",
      },
      tags: ["clinical", "discharge", "checklist", "healthcare", "transitioniq"],
      changeDescription: "Initial discharge plan checklist generation prompt",
    });

    // Cache the plan prompt
    cachedPlanPrompt = planPrompt;

    const planVersionInfo = planPrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: discharge-plan (version: ${planVersionInfo})`);
    console.log(`[Opik] View prompts at: https://www.comet.com/opik/prompts`);

    return {
      promptName: "discharge-analysis",
      commit: versionInfo,
    };
  } catch (error) {
    console.error("[Opik] Failed to store prompt in Prompt Library:", error);
    if (error instanceof Error) {
      console.error("[Opik] Error details:", error.message);
    }
    return null;
  }
}

/**
 * Get the discharge analysis prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 *
 * This retrieves the latest version of the prompt from Opik,
 * enabling prompt versioning and A/B testing.
 */
export async function getDischargeAnalysisPrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const opik = getOpikClient();

  // Use cached prompt if available
  if (cachedPrompt) {
    return {
      template: cachedPrompt.prompt,
      commit: cachedPrompt.commit || null,
      fromOpik: true,
    };
  }

  if (opik) {
    try {
      // Retrieve the prompt from Opik Prompt Library
      const prompt = await opik.getPrompt({ name: "discharge-analysis" });
      if (prompt) {
        // Cache for subsequent calls
        cachedPrompt = prompt;

        console.log(`[Opik] Using prompt from Prompt Library (version: ${prompt.commit || "unknown"})`);

        return {
          template: prompt.prompt,
          commit: prompt.commit || null,
          fromOpik: true,
        };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get prompt from Prompt Library, using local template:", error);
    }
  }

  // Fallback to local prompt (not stored in Opik)
  console.log("[Opik] Using local prompt template (not versioned in Opik)");
  return {
    template: DISCHARGE_ANALYSIS_PROMPT,
    commit: null,
    fromOpik: false,
  };
}

/**
 * Get the discharge plan prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 */
export async function getDischargePlanPrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const opik = getOpikClient();

  // Use cached prompt if available
  if (cachedPlanPrompt) {
    return {
      template: cachedPlanPrompt.prompt,
      commit: cachedPlanPrompt.commit || null,
      fromOpik: true,
    };
  }

  if (opik) {
    try {
      // Retrieve the prompt from Opik Prompt Library
      const prompt = await opik.getPrompt({ name: "discharge-plan" });
      if (prompt) {
        // Cache for subsequent calls
        cachedPlanPrompt = prompt;

        console.log(`[Opik] Using discharge-plan prompt from Prompt Library (version: ${prompt.commit || "unknown"})`);

        return {
          template: prompt.prompt,
          commit: prompt.commit || null,
          fromOpik: true,
        };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get discharge-plan prompt from Prompt Library, using local template:", error);
    }
  }

  // Fallback to local prompt (not stored in Opik)
  console.log("[Opik] Using local discharge-plan prompt template (not versioned in Opik)");
  return {
    template: DISCHARGE_PLAN_PROMPT,
    commit: null,
    fromOpik: false,
  };
}

/**
 * Format the discharge plan prompt with patient and analysis data
 */
export function formatDischargePlanPrompt(
  template: string,
  data: {
    patient_name: string;
    patient_age: number;
    patient_gender: string;
    score: number;
    status: string;
    high_risks: string;
    moderate_risks: string;
  }
): string {
  let formatted = template;

  // Replace all mustache variables
  for (const [key, value] of Object.entries(data)) {
    formatted = formatted.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }

  return formatted;
}

/**
 * Clear the cached prompt (useful for testing different versions)
 */
export function clearPromptCache(): void {
  cachedPrompt = null;
  cachedPlanPrompt = null;
  console.log("[Opik] Prompt cache cleared");
}

/**
 * Get a specific version of the prompt from Opik
 */
export async function getPromptVersion(commit: string): Promise<{
  template: string;
  commit: string;
} | null> {
  const opik = getOpikClient();
  if (!opik) return null;

  try {
    const prompt = await opik.getPrompt({ name: "discharge-analysis", commit });
    if (prompt) {
      return {
        template: prompt.prompt,
        commit: prompt.commit || commit,
      };
    }
  } catch (error) {
    console.warn(`[Opik] Failed to get prompt version ${commit}:`, error);
  }

  return null;
}

/**
 * Format the discharge analysis prompt with patient data
 */
export function formatDischargePrompt(
  template: string,
  data: {
    patient_name: string;
    patient_age: number;
    patient_gender: string;
    admission_date: string;
    diagnoses: string;
    medication_count: number;
    medications: string;
    allergies: string;
    drug_interactions: string;
    care_gaps: string;
    cost_barriers: string;
    lab_results: string;
  }
): string {
  let formatted = template;

  // Replace all mustache variables
  for (const [key, value] of Object.entries(data)) {
    formatted = formatted.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }

  return formatted;
}

/**
 * Log prompt usage to Opik trace
 */
export async function logPromptUsage(
  traceId: string,
  promptCommit: string | null,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  latencyMs: number,
  modelId?: string
): Promise<void> {
  const opik = getOpikClient();
  if (!opik) return;

  // Get actual model ID being used
  const activeModel = modelId || (input.model_id as string) || "unknown";

  try {
    const trace = opik.trace({
      name: "llm-discharge-analysis",
      input: {
        prompt_name: "discharge-analysis",
        prompt_commit: promptCommit,
        patient_id: input.patient_id,
        ...input,
      },
      output: {
        score: output.score,
        status: output.status,
        risk_factor_count: (output.riskFactors as unknown[])?.length || 0,
        recommendations: output.recommendations,
      },
      metadata: {
        category: "llm_call",
        model: activeModel,
        prompt_name: "discharge-analysis",
        prompt_commit: promptCommit || "local",
        latency_ms: latencyMs,
      },
    });

    const span = trace.span({
      name: "llm-generation",
      input: { prompt_length: JSON.stringify(input).length },
      output: { response_length: JSON.stringify(output).length },
      metadata: {
        model: activeModel,
        latency_ms: latencyMs,
      },
    });

    span.end();
    trace.end();

    await opik.flush();
  } catch (error) {
    console.error("[Opik] Failed to log prompt usage:", error);
  }
}

/**
 * Create a chat prompt for multi-turn conversations
 */
export async function createConversationPrompt(): Promise<{
  promptName: string;
  commit: string;
} | null> {
  const opik = getOpikClient();
  if (!opik) return null;

  try {
    const messages = [
      {
        role: "system",
        content: `You are a clinical decision support assistant helping healthcare providers assess discharge readiness.

You have access to the following patient data:
- Demographics and admission information
- Current medications and allergies
- Drug interaction analysis from FDA
- Care gap analysis from clinical guidelines
- Cost estimates from CMS

Be helpful, accurate, and always prioritize patient safety.`,
      },
      {
        role: "user",
        content: "{{user_message}}",
      },
    ];

    const chatPrompt = await opik.createChatPrompt({
      name: "discharge-assistant",
      messages,
      metadata: {
        version: "1.0",
        author: "transitioniq",
        description: "Multi-turn conversation prompt for discharge assistance",
      },
    });

    console.log(`[Opik] Chat prompt registered: discharge-assistant (commit: ${chatPrompt.commit || "unknown"})`);

    return {
      promptName: "discharge-assistant",
      commit: chatPrompt.commit || "unknown",
    };
  } catch (error) {
    console.error("[Opik] Failed to create chat prompt:", error);
    return null;
  }
}
