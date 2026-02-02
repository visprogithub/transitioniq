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

// ---------------------------------------------------------------------------
// Unified prompt cache with 30-minute TTL
// Module-level cache survives across requests on the same Vercel instance.
// TTL ensures prompts eventually refresh if updated in the Opik dashboard.
// ---------------------------------------------------------------------------
const PROMPT_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface PromptCacheEntry {
  prompt: Prompt;
  fetchedAt: number;
}

const promptCache = new Map<string, PromptCacheEntry>();

function getCachedPromptEntry(name: string): Prompt | null {
  const entry = promptCache.get(name);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > PROMPT_CACHE_TTL_MS) {
    promptCache.delete(name);
    return null;
  }
  return entry.prompt;
}

function setCachedPromptEntry(name: string, prompt: Prompt): void {
  promptCache.set(name, { prompt, fetchedAt: Date.now() });
}

// Legacy aliases — keep the module API compatible with initializeOpikPrompts()
// which assigns directly to these after createPrompt() calls.
let cachedPrompt: Prompt | null = null;
let cachedPatientSummaryPrompt: Prompt | null = null;
let cachedLLMJudgePrompt: Prompt | null = null;
let cachedPatientCoachPrompt: Prompt | null = null;
let cachedCareGapEvaluationPrompt: Prompt | null = null;
let cachedCostEstimationPrompt: Prompt | null = null;
let cachedKnowledgeRetrievalPrompt: Prompt | null = null;
let cachedPlanPrompt: Prompt | null = null;

// ---------------------------------------------------------------------------
// Parallel prompt warm-up — fetches all 8 prompts concurrently on first use
// ---------------------------------------------------------------------------
let warmupPromise: Promise<void> | null = null;

/**
 * Pre-fetch ALL prompts from Opik in a single parallel burst.
 * Call this once early (e.g., on the first API request). Subsequent
 * calls are no-ops until the cache TTL expires.
 *
 * Each individual getXxxPrompt() still works standalone if warmup
 * hasn't run — warmup just eliminates sequential cold-start latency.
 */
export async function warmAllPrompts(): Promise<void> {
  // Deduplicate concurrent callers
  if (warmupPromise) return warmupPromise;

  const opik = getOpikClient();
  if (!opik) return;

  // Check if all prompts are already cached & fresh
  const names = [
    "discharge-analysis", "discharge-plan", "patient-summary",
    "llm-judge", "patient-coach", "care-gap-evaluation",
    "cost-estimation", "knowledge-retrieval",
  ];
  const allCached = names.every((n) => getCachedPromptEntry(n) !== null);
  if (allCached) return;

  warmupPromise = (async () => {
    try {
      const results = await Promise.allSettled(
        names.map((name) => opik.getPrompt({ name }))
      );
      for (let i = 0; i < names.length; i++) {
        const r = results[i];
        if (r.status === "fulfilled" && r.value) {
          setCachedPromptEntry(names[i], r.value);
        }
      }
      console.log(`[Opik] Warmed ${results.filter((r) => r.status === "fulfilled" && r.value).length}/${names.length} prompts in parallel`);
    } catch (error) {
      console.warn("[Opik] Prompt warm-up failed (will fetch on demand):", error);
    } finally {
      warmupPromise = null;
    }
  })();

  return warmupPromise;
}

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

/**
 * Patient Summary Prompt - stored in Opik Prompt Library
 * Converts clinical analysis to patient-friendly language
 */
const PATIENT_SUMMARY_PROMPT = `You are a patient communication specialist. Convert the clinical discharge analysis into language appropriate for the patient's age and likely comprehension level.

Patient: {{patientName}}, {{patientAge}} years old
Clinical Score: {{score}}/100
Clinical Status: {{status}}

Risk Factors Identified:
{{riskFactors}}

Current Medications:
{{medications}}

## Adaptive Language
Adjust all text output based on the patient's age:
- Children (under ~10): Very simple words, short sentences, friendly tone. Assume a parent is reading along. Use comforting language.
- Teens (~10-17): Straightforward and relatable. Don't talk down to them but keep medical terms simple.
- Adults (~18-64): Clear plain language with brief explanations of medical terms where needed.
- Older adults (~65-79): Patient, clear explanations. Emphasize involving family or caregivers for complex medication schedules.
- Elderly (~80+): Short focused points. Strongly emphasize caregiver involvement. Warm and respectful tone.

Generate a patient-friendly summary in JSON format. Use simple words appropriate to the patient's age, avoid unnecessary medical jargon, and be encouraging.

Rules:
1. readinessLevel must be "good" (score >= 70), "caution" (score 40-69), or "needs_attention" (score < 40)
2. readinessMessage should be warm and reassuring, 1-2 sentences, written in language appropriate for the patient's age
3. whatYouNeedToKnow: Convert each significant risk factor to plain English appropriate for the patient's age (max 4 items)
   - Use "pill" icon for medication issues
   - Use "heart" icon for vital signs / lab issues
   - Use "calendar" icon for follow-up / scheduling
   - Use "alert" icon for general warnings
4. medicationReminders: Simple instructions for each medication (max 5)
   - Mark blood thinners, insulin, and heart medications as "important"
   - For children: frame instructions for parent/child together ("Your parent will help you take...")
   - For elderly: emphasize timing cues and caregiver reminders
5. questionsForDoctor: Generate 3-4 questions the patient (or their caregiver) should ask (plain English, age-appropriate)
6. nextSteps: 4-5 actionable tasks with priority levels, phrased appropriately for the patient's age

Respond with ONLY valid JSON matching this schema:
{
  "readinessLevel": "good" | "caution" | "needs_attention",
  "readinessMessage": "string",
  "whatYouNeedToKnow": [{ "title": "string", "description": "string", "icon": "pill" | "heart" | "calendar" | "alert" }],
  "medicationReminders": [{ "medication": "string", "instruction": "string", "important": boolean }],
  "questionsForDoctor": ["string"],
  "nextSteps": [{ "task": "string", "completed": false, "priority": "high" | "medium" | "low" }]
}`;

/**
 * LLM-as-Judge Prompt - stored in Opik Prompt Library
 * Evaluates AI-generated discharge assessments for quality
 */
/**
 * Patient Coach Prompt - Agentic multi-turn conversation
 * Used for the patient-facing recovery coach with tool use
 */
const PATIENT_COACH_PROMPT = `You are a friendly, supportive Patient Recovery Coach helping {{patientName}} prepare to go home from the hospital.

## Your Role
- Explain medical information in simple, everyday language
- Help the patient understand their medications, symptoms, and follow-up care
- Use the available tools to provide accurate, patient-specific information
- Be warm, encouraging, and patient-focused

## Patient Context
Name: {{patientName}}
Age: {{patientAge}} years old
Diagnoses: {{diagnoses}}
Current Medications: {{medications}}
Allergies: {{allergies}}

## Adaptive Communication Style
Adjust your language, tone, and explanations based on the patient's age and likely comprehension level. Read the patient's age above and follow these guidelines naturally — do NOT mention that you are adjusting your style.

- **Young children (under ~10):** Use very simple words, short sentences, and friendly comparisons ("Your medicine helps your tummy feel better, kind of like how a bandage helps a cut"). Speak to the child directly but assume a parent/caregiver is present. Offer encouragement ("You're being so brave!").
- **Older children & teenagers (~10-17):** Use straightforward language but don't talk down to them. Be real and relatable. Explain the "why" behind instructions. You can use light humor or analogies they'd understand. Address them directly — they're old enough to participate in their care.
- **Adults (~18-64):** Use clear, plain language. Avoid unnecessary jargon but you can use common medical terms with brief explanations. Be direct and informative.
- **Older adults (~65-79):** Be patient and clear. Use slightly larger conceptual steps — don't rush through complex medication schedules. Emphasize written instructions and remind them to involve family members or caregivers when helpful. Be respectful of their experience and autonomy.
- **Elderly adults (~80+):** Use short, focused explanations. Repeat key points gently. Strongly encourage involving a family member or caregiver for medication management and follow-up scheduling. Speak with warmth and respect for their dignity.

If the patient has complex medication regimens, cognitive concerns, or limited health literacy (inferred from context), simplify further regardless of age.

## Communication Guidelines
1. Use simple, non-medical language whenever possible
2. Explain terms if you must use them
3. Be reassuring but honest
4. Encourage patients to ask their doctor/nurse for clarification
5. Never diagnose or provide specific medical advice - guide them to appropriate care
6. Use the tools available to provide accurate information

## Important Guardrails
⚠️ NEVER:
- Make specific diagnoses
- Tell patients to stop or change medications
- Dismiss serious symptoms
- Guarantee outcomes or timelines
- Provide emergency medical guidance (always direct to 911 for emergencies)

✅ ALWAYS:
- Encourage patients to ask their healthcare team
- Recommend calling their doctor for concerning symptoms
- Direct to 911 or emergency room for serious symptoms
- Use tools to look up accurate medication and symptom information
- Be supportive and encouraging

## Available Tools
You can use these tools to help answer questions:
- lookupMedication: Get information about medications
- checkSymptom: Assess symptom urgency
- explainMedicalTerm: Explain medical jargon simply
- getFollowUpGuidance: Information about appointments
- getDietaryGuidance: Dietary recommendations
- getActivityGuidance: Activity and restriction guidance

When you need to use a tool, respond with ONLY a JSON object:
{"tool_name": "toolName", "arguments": {"paramName": "value"}}

Otherwise, respond conversationally in a friendly, supportive way.`;

/**
 * Care Gap Evaluation Prompt - LLM enrichment of rule-based care gap results
 * Used when deterministic rules find < 2 unmet gaps, to discover additional guidelines
 */
const CARE_GAP_EVALUATION_PROMPT = `You are a clinical decision support system analyzing a patient against evidence-based clinical guidelines.

Patient: {{patientName}}, {{patientAge}}yo {{patientGender}}
Diagnoses: {{diagnoses}}
Medications: {{medications}}
Labs: {{labs}}
Vitals: {{vitals}}

Rule-Based Gaps Already Identified:
{{existingGaps}}

Evaluate this patient against the following major clinical guidelines:
1. ACC/AHA Heart Failure Guidelines (if applicable)
2. ADA Diabetes Standards of Care (if applicable)
3. ACC/AHA/HRS Atrial Fibrillation Guidelines (if applicable)
4. GOLD COPD Guidelines (if applicable)
5. Discharge Planning Standards (CMS/TJC)

The rule-based system has already identified the gaps listed above. Your job is to find ADDITIONAL care gaps not already covered by the existing results.

Respond with ONLY a JSON array of additional care gaps found, no other text:
[
  {"guideline": "Guideline Name", "status": "met" or "unmet", "grade": "A" or "B" or "C"},
  ...
]

Notes:
- Grade A = Strong recommendation, high-quality evidence
- Grade B = Moderate recommendation or moderate evidence
- Grade C = Weak recommendation or low-quality evidence
- Only include guidelines that apply to this patient's conditions
- Do NOT duplicate any guideline already listed in "Rule-Based Gaps Already Identified"
- Be thorough but clinically accurate`;

/**
 * Cost Estimation Prompt - LLM fallback for medication cost estimation
 * Only used when CMS client cannot determine costs for a medication
 */
const COST_ESTIMATION_PROMPT = `You are a Medicare Part D cost analysis specialist. Analyze the following medications and their CMS-sourced pricing data for a typical Medicare Part D patient without supplemental coverage.

Medications:
{{medicationList}}

CMS Pricing Data (from Medicare formulary and NDC directory):
{{cmsData}}

Using the CMS data above as your primary source, provide your analysis for each medication:
1. The monthly out-of-pocket cost in USD (use the CMS data; refine only if you have strong evidence of a discrepancy)
2. Whether it's typically covered by Medicare Part D (true/false)

You may also flag:
- Medications where a generic alternative could save money
- Drugs requiring prior authorization that could delay discharge
- Potential copay assistance programs for high-cost specialty medications

Respond with ONLY a JSON array, no other text:
[
  {"medication": "Drug Name", "monthlyOOP": 150, "covered": true},
  ...
]`;

const KNOWLEDGE_RETRIEVAL_PROMPT = `You are a clinical knowledge synthesis specialist. A TF-IDF search over the TransitionIQ clinical knowledge base has returned the following relevant entries for the patient context below.

Patient Context:
- Name: {{patientName}}, Age: {{patientAge}}, Gender: {{patientGender}}
- Diagnoses: {{diagnoses}}
- Current medications: {{medications}}

Search Query: {{query}}

Retrieved Knowledge Base Entries:
{{retrievedContext}}

Using ONLY the retrieved knowledge base entries above as your primary source (do not hallucinate data not present in the entries), synthesize a clinically relevant summary that:

1. Highlights information directly relevant to THIS patient's conditions and medications
2. Flags any drug interactions, contraindications, or warnings found in the entries
3. Notes relevant patient counseling points or self-care guidance
4. Identifies monitoring parameters that apply to this patient
5. Calls out any red flags or urgent considerations

Be concise and actionable. If the retrieved entries do not contain relevant information for the query, say so clearly rather than guessing.

Respond with ONLY a JSON object:
{
  "summary": "Concise clinical summary of relevant findings",
  "relevantFindings": [
    {"category": "drug_info|interaction|symptom|guideline|education", "finding": "...", "importance": "critical|important|informational"}
  ],
  "patientCounselingPoints": ["Point 1", "Point 2"],
  "monitoringNeeded": ["Parameter 1", "Parameter 2"],
  "redFlags": ["Any urgent items found"]
}`;

const LLM_JUDGE_PROMPT = `You are an expert medical quality assurance reviewer evaluating AI-generated discharge readiness assessments.

Your role is to critically evaluate the assessment on four dimensions:

1. SAFETY (Weight: 40%)
   - Does the assessment identify all critical risks that could harm the patient?
   - Are drug interactions properly flagged?
   - Are contraindications mentioned?
   - Would acting on this assessment put the patient at risk?

2. ACCURACY (Weight: 25%)
   - Does the score match the clinical picture?
   - Are the risk factors correctly categorized by severity?
   - Is the status (ready/caution/not_ready) appropriate given the findings?

3. ACTIONABILITY (Weight: 20%)
   - Are recommendations specific and implementable?
   - Can a clinician act on these recommendations immediately?
   - Are next steps clear?

4. COMPLETENESS (Weight: 15%)
   - Are all relevant patient factors considered?
   - Are there any obvious gaps in the assessment?
   - Is important context missing?

For each dimension, provide:
- A score from 0.0 to 1.0 (where 1.0 is perfect)
- A brief reasoning (1-2 sentences)

Respond with ONLY valid JSON in this exact format:
{
  "safety": { "score": 0.0, "reasoning": "..." },
  "accuracy": { "score": 0.0, "reasoning": "..." },
  "actionability": { "score": 0.0, "reasoning": "..." },
  "completeness": { "score": 0.0, "reasoning": "..." },
  "summary": "One sentence overall assessment"
}`;

/**
 * Discharge Plan Generation Prompt - stored in Opik Prompt Library
 */
const DISCHARGE_PLAN_PROMPT = `You are generating a discharge checklist for a care team. Generate ONLY actionable task items based on the patient's specific risk factors. Tailor patient education tasks to the patient's age and likely comprehension level.

Patient: {{patient_name}}, {{patient_age}}yo {{patient_gender}}
Discharge Readiness Score: {{score}}/100 ({{status}})

HIGH-SEVERITY RISKS:
{{high_risks}}

MODERATE-SEVERITY RISKS:
{{moderate_risks}}

## Age-Appropriate Discharge Planning
Consider the patient's age when generating tasks:
- Pediatric patients (under 18): Include parent/guardian education tasks. Frame medication tasks around caregiver administration. Include age-appropriate patient education (e.g., coloring sheets for young children, teen-friendly handouts for adolescents).
- Older adults (65+): Include caregiver coordination tasks. Emphasize medication reconciliation and simplified schedules. Add fall prevention and home safety checks where relevant.
- Elderly (80+): Prioritize caregiver involvement in every discharge task. Include cognitive assessment follow-up if complex medication regimens exist.
- Adults (18-64): Standard clinical discharge tasks.

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

IMPORTANT SOURCE LABELING RULES:
- Drug interactions from FDA/RxNorm data → "FDA"
- Lab abnormalities related to medication monitoring (e.g., INR for warfarin, drug levels, creatinine/renal function affecting drug dosing) → "FDA"
- General lab abnormalities not tied to medications → "FHIR"
- Care gaps from clinical guidelines → "Guidelines"
- Cost/affordability barriers → "CMS"

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

    // Cache the prompt for reuse (both legacy var and TTL Map)
    cachedPrompt = analysisPrompt;
    setCachedPromptEntry("discharge-analysis", analysisPrompt);

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

    cachedPlanPrompt = planPrompt;
    setCachedPromptEntry("discharge-plan", planPrompt);

    const planVersionInfo = planPrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: discharge-plan (version: ${planVersionInfo})`);

    // Create/update the patient summary prompt
    const patientSummaryPrompt = await opik.createPrompt({
      name: "patient-summary",
      prompt: PATIENT_SUMMARY_PROMPT,
      description: "Patient-friendly summary generation prompt for TransitionIQ",
      metadata: {
        version: "1.0",
        author: "transitioniq",
        use_case: "patient_education",
      },
      tags: ["patient", "education", "summary", "healthcare", "transitioniq"],
      changeDescription: "Patient-friendly discharge summary prompt",
    });

    cachedPatientSummaryPrompt = patientSummaryPrompt;
    setCachedPromptEntry("patient-summary", patientSummaryPrompt);
    const patientSummaryVersionInfo = patientSummaryPrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: patient-summary (version: ${patientSummaryVersionInfo})`);

    // Create/update the LLM judge prompt
    const llmJudgePrompt = await opik.createPrompt({
      name: "llm-judge",
      prompt: LLM_JUDGE_PROMPT,
      description: "LLM-as-Judge evaluation prompt for TransitionIQ quality assurance",
      metadata: {
        version: "1.0",
        author: "transitioniq",
        use_case: "quality_assurance",
      },
      tags: ["evaluation", "judge", "quality", "healthcare", "transitioniq"],
      changeDescription: "LLM-as-Judge prompt for discharge assessment evaluation",
    });

    cachedLLMJudgePrompt = llmJudgePrompt;
    setCachedPromptEntry("llm-judge", llmJudgePrompt);
    const llmJudgeVersionInfo = llmJudgePrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: llm-judge (version: ${llmJudgeVersionInfo})`);

    // Create/update the patient coach prompt
    const patientCoachPrompt = await opik.createPrompt({
      name: "patient-coach",
      prompt: PATIENT_COACH_PROMPT,
      description: "Agentic patient recovery coach prompt with multi-turn tool use for TransitionIQ",
      metadata: {
        version: "1.0",
        author: "transitioniq",
        use_case: "patient_education_agentic",
        agentic: true,
        tools: ["lookupMedication", "checkSymptom", "explainMedicalTerm", "getFollowUpGuidance", "getDietaryGuidance", "getActivityGuidance"],
      },
      tags: ["patient", "education", "agentic", "chat", "healthcare", "transitioniq"],
      changeDescription: "Agentic patient coach prompt with tool use support",
    });

    cachedPatientCoachPrompt = patientCoachPrompt;
    setCachedPromptEntry("patient-coach", patientCoachPrompt);
    const patientCoachVersionInfo = patientCoachPrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: patient-coach (version: ${patientCoachVersionInfo})`);

    // Create/update the care gap evaluation prompt
    const careGapPrompt = await opik.createPrompt({
      name: "care-gap-evaluation",
      prompt: CARE_GAP_EVALUATION_PROMPT,
      description: "LLM enrichment prompt for care gap evaluation beyond rule-based checks",
      metadata: {
        version: "1.0",
        author: "transitioniq",
        use_case: "healthcare_care_gap_evaluation",
      },
      tags: ["clinical", "guidelines", "care-gaps", "healthcare", "transitioniq"],
      changeDescription: "Care gap evaluation prompt with rule-based gap awareness",
    });

    cachedCareGapEvaluationPrompt = careGapPrompt;
    setCachedPromptEntry("care-gap-evaluation", careGapPrompt);
    const careGapVersionInfo = careGapPrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: care-gap-evaluation (version: ${careGapVersionInfo})`);

    // Create/update the cost estimation prompt
    const costPrompt = await opik.createPrompt({
      name: "cost-estimation",
      prompt: COST_ESTIMATION_PROMPT,
      description: "LLM fallback prompt for medication cost estimation when CMS data unavailable",
      metadata: {
        version: "1.0",
        author: "transitioniq",
        use_case: "healthcare_cost_estimation",
      },
      tags: ["clinical", "costs", "medications", "healthcare", "transitioniq"],
      changeDescription: "Cost estimation prompt for Medicare Part D OOP estimates",
    });

    cachedCostEstimationPrompt = costPrompt;
    setCachedPromptEntry("cost-estimation", costPrompt);
    const costVersionInfo = costPrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: cost-estimation (version: ${costVersionInfo})`);

    // Create/update the knowledge retrieval prompt
    const knowledgePrompt = await opik.createPrompt({
      name: "knowledge-retrieval",
      prompt: KNOWLEDGE_RETRIEVAL_PROMPT,
      description: "RAG synthesis prompt for TF-IDF knowledge base retrieval in TransitionIQ",
      metadata: {
        version: "1.0",
        author: "transitioniq",
        use_case: "healthcare_knowledge_retrieval",
        rag_type: "tfidf_in_memory",
      },
      tags: ["rag", "knowledge-base", "clinical", "retrieval", "healthcare", "transitioniq"],
      changeDescription: "Knowledge retrieval synthesis prompt for in-memory TF-IDF RAG",
    });

    cachedKnowledgeRetrievalPrompt = knowledgePrompt;
    setCachedPromptEntry("knowledge-retrieval", knowledgePrompt);
    const knowledgeVersionInfo = knowledgePrompt.commit || "initial";
    console.log(`[Opik] Prompt stored in Prompt Library: knowledge-retrieval (version: ${knowledgeVersionInfo})`);

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
  const cached = getCachedPromptEntry("discharge-analysis") || cachedPrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "discharge-analysis" });
      if (prompt) {
        setCachedPromptEntry("discharge-analysis", prompt);
        cachedPrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get discharge-analysis prompt, using local:", error);
    }
  }

  return { template: DISCHARGE_ANALYSIS_PROMPT, commit: null, fromOpik: false };
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
  const cached = getCachedPromptEntry("discharge-plan") || cachedPlanPrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "discharge-plan" });
      if (prompt) {
        setCachedPromptEntry("discharge-plan", prompt);
        cachedPlanPrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get discharge-plan prompt, using local:", error);
    }
  }

  return { template: DISCHARGE_PLAN_PROMPT, commit: null, fromOpik: false };
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
  promptCache.clear();
  cachedPrompt = null;
  cachedPlanPrompt = null;
  cachedPatientSummaryPrompt = null;
  cachedLLMJudgePrompt = null;
  cachedPatientCoachPrompt = null;
  cachedCareGapEvaluationPrompt = null;
  cachedCostEstimationPrompt = null;
  cachedKnowledgeRetrievalPrompt = null;
  console.log("[Opik] Prompt cache cleared");
}

/**
 * Get the patient coach prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 */
export async function getPatientCoachPrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const cached = getCachedPromptEntry("patient-coach") || cachedPatientCoachPrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "patient-coach" });
      if (prompt) {
        setCachedPromptEntry("patient-coach", prompt);
        cachedPatientCoachPrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get patient-coach prompt, using local:", error);
    }
  }

  return { template: PATIENT_COACH_PROMPT, commit: null, fromOpik: false };
}

/**
 * Format the patient coach prompt with patient data
 */
export function formatPatientCoachPrompt(
  template: string,
  data: {
    patientName: string;
    patientAge: number;
    diagnoses: string;
    medications: string;
    allergies: string;
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
 * Get the care gap evaluation prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 */
export async function getCareGapEvaluationPrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const cached = getCachedPromptEntry("care-gap-evaluation") || cachedCareGapEvaluationPrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "care-gap-evaluation" });
      if (prompt) {
        setCachedPromptEntry("care-gap-evaluation", prompt);
        cachedCareGapEvaluationPrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get care-gap-evaluation prompt, using local:", error);
    }
  }

  return { template: CARE_GAP_EVALUATION_PROMPT, commit: null, fromOpik: false };
}

/**
 * Format the care gap evaluation prompt with patient data
 */
export function formatCareGapEvaluationPrompt(
  template: string,
  data: {
    patientName: string;
    patientAge: number;
    patientGender: string;
    diagnoses: string;
    medications: string;
    labs: string;
    vitals: string;
    existingGaps: string;
  }
): string {
  let formatted = template;
  for (const [key, value] of Object.entries(data)) {
    formatted = formatted.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }
  return formatted;
}

/**
 * Get the cost estimation prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 */
export async function getCostEstimationPrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const cached = getCachedPromptEntry("cost-estimation") || cachedCostEstimationPrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "cost-estimation" });
      if (prompt) {
        setCachedPromptEntry("cost-estimation", prompt);
        cachedCostEstimationPrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get cost-estimation prompt, using local:", error);
    }
  }

  return { template: COST_ESTIMATION_PROMPT, commit: null, fromOpik: false };
}

/**
 * Format the cost estimation prompt with medication data
 */
export function formatCostEstimationPrompt(
  template: string,
  data: {
    medicationList: string;
    cmsData: string;
  }
): string {
  let formatted = template;
  for (const [key, value] of Object.entries(data)) {
    formatted = formatted.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }
  return formatted;
}

/**
 * Get the knowledge retrieval prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 */
export async function getKnowledgeRetrievalPrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const cached = getCachedPromptEntry("knowledge-retrieval") || cachedKnowledgeRetrievalPrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "knowledge-retrieval" });
      if (prompt) {
        setCachedPromptEntry("knowledge-retrieval", prompt);
        cachedKnowledgeRetrievalPrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get knowledge-retrieval prompt, using local:", error);
    }
  }

  return { template: KNOWLEDGE_RETRIEVAL_PROMPT, commit: null, fromOpik: false };
}

/**
 * Format the knowledge retrieval prompt with patient and search data
 */
export function formatKnowledgeRetrievalPrompt(
  template: string,
  data: {
    patientName: string;
    patientAge: number;
    patientGender: string;
    diagnoses: string;
    medications: string;
    query: string;
    retrievedContext: string;
  }
): string {
  let formatted = template;
  for (const [key, value] of Object.entries(data)) {
    formatted = formatted.replace(new RegExp(`{{${key}}}`, "g"), String(value));
  }
  return formatted;
}

/**
 * Get the patient summary prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 */
export async function getPatientSummaryPrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const cached = getCachedPromptEntry("patient-summary") || cachedPatientSummaryPrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "patient-summary" });
      if (prompt) {
        setCachedPromptEntry("patient-summary", prompt);
        cachedPatientSummaryPrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get patient-summary prompt, using local:", error);
    }
  }

  return { template: PATIENT_SUMMARY_PROMPT, commit: null, fromOpik: false };
}

/**
 * Get the LLM judge prompt from Opik Prompt Library
 * Falls back to local prompt if Opik unavailable
 */
export async function getLLMJudgePrompt(): Promise<{
  template: string;
  commit: string | null;
  fromOpik: boolean;
}> {
  const cached = getCachedPromptEntry("llm-judge") || cachedLLMJudgePrompt;
  if (cached) {
    return { template: cached.prompt, commit: cached.commit || null, fromOpik: true };
  }

  const opik = getOpikClient();
  if (opik) {
    try {
      const prompt = await opik.getPrompt({ name: "llm-judge" });
      if (prompt) {
        setCachedPromptEntry("llm-judge", prompt);
        cachedLLMJudgePrompt = prompt;
        return { template: prompt.prompt, commit: prompt.commit || null, fromOpik: true };
      }
    } catch (error) {
      console.warn("[Opik] Failed to get llm-judge prompt, using local:", error);
    }
  }

  return { template: LLM_JUDGE_PROMPT, commit: null, fromOpik: false };
}

/**
 * Format the patient summary prompt with patient data
 */
export function formatPatientSummaryPrompt(
  template: string,
  data: {
    patientName: string;
    patientAge: number;
    score: number;
    status: string;
    riskFactors: string;
    medications: string;
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
  modelId?: string,
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  },
  estimatedCost?: number
): Promise<void> {
  const opik = getOpikClient();
  if (!opik) return;

  // Get actual model ID being used
  const activeModel = modelId || (input.model_id as string) || "unknown";

  // Map model to Opik provider string
  const providerMap: Record<string, string> = {
    gemini: "google_ai",
    openai: "openai",
    anthropic: "anthropic",
    huggingface: "huggingface",
  };
  const provider = Object.entries(providerMap).find(([key]) =>
    activeModel.toLowerCase().startsWith(key)
  )?.[1] || "unknown";

  // Debug: log token usage being sent to Opik
  console.log(`[Opik] logPromptUsage tokenUsage:`, JSON.stringify(tokenUsage), `cost: $${estimatedCost?.toFixed(6) || "N/A"}`);

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

    // Create LLM span with token usage — this is what Opik uses for token/cost charts
    const span = trace.span({
      name: "llm-generation",
      type: "llm",
      input: { prompt_length: JSON.stringify(input).length },
      output: { response_length: JSON.stringify(output).length },
      usage: tokenUsage ? {
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        totalTokens: tokenUsage.totalTokens,
      } : undefined,
      model: activeModel,
      provider,
      totalEstimatedCost: estimatedCost,
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
