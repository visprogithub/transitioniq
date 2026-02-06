/**
 * Patient Chat API - Multi-turn Agentic Conversation
 *
 * This endpoint implements a conversational patient recovery coach with:
 * 1. Multi-turn message history (context persistence)
 * 2. Tool use for medication lookup, symptom checking, term explanation
 * 3. Guardrails for medical advice boundaries
 * 4. Full Opik tracing for each conversation turn
 * 5. Token/cost limits to prevent excessive API usage
 */

import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { createLLMProvider, getActiveModelId } from "@/lib/integrations/llm-provider";
import { getOpikClient, traceError, flushTraces } from "@/lib/integrations/opik";
import { getPatient } from "@/lib/data/demo-patients";
import {
  PATIENT_COACH_TOOLS,
  executePatientCoachTool,
} from "@/lib/agents/patient-coach-tools";
import {
  createMemorySession,
  getMemorySession,
  addConversationTurn,
  setPatientContext,
  storeToolResult,
  buildContextForLLM,
} from "@/lib/agents/memory";
import { createProgressStream, withProgress } from "@/lib/utils/sse-helpers";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

/**
 * Token/Usage Limits
 * These prevent runaway costs during testing and demos
 */
const LIMITS = {
  // Maximum conversation history to keep (older messages are dropped)
  MAX_HISTORY_MESSAGES: 6, // Keep last 3 user + 3 assistant messages
  // Maximum tokens per request (approximate - checked via character count)
  MAX_PROMPT_CHARS: 8000, // ~2000 tokens
  // Maximum tools per turn to prevent tool loops
  MAX_TOOLS_PER_TURN: 2,
  // Maximum conversation turns before suggesting reset
  MAX_CONVERSATION_TURNS: 10,
  // Cooldown between requests (ms) to prevent rapid-fire requests
  MIN_REQUEST_INTERVAL_MS: 1000,
};

/**
 * Off-topic detection - keywords that indicate the question is about
 * health, recovery, medications, or discharge-related topics
 */
const HEALTH_TOPIC_KEYWORDS = [
  // Medications (generic terms + common drug suffixes)
  "medication", "medicine", "pill", "drug", "dose", "prescription", "pharmacy",
  "warfarin", "aspirin", "lisinopril", "metformin", "atorvastatin", "omeprazole",
  "amoxicillin", "amlodipine", "metoprolol", "furosemide", "insulin", "eliquis",
  "ibuprofen", "acetaminophen", "tylenol", "advil", "prednisone", "hydrochlorothiazide",
  "take", "taking", "refill", "side effect", "antibiotic", "antiviral", "antifungal",
  "painkiller", "blood thinner", "statin", "beta blocker", "ace inhibitor", "diuretic",
  "supplement", "vitamin", "over the counter", "otc", "generic", "brand",
  // Symptoms & Health
  "symptom", "feel", "feeling", "pain", "dizzy", "dizziness", "nausea", "tired",
  "headache", "fever", "swelling", "bleeding", "vomit", "breathe", "breathing",
  "chest", "heart", "blood", "pressure", "sugar", "glucose",
  // Medical care
  "doctor", "nurse", "hospital", "appointment", "follow-up", "follow up",
  "discharge", "recovery", "heal", "healing", "check-up", "checkup",
  // Activities & restrictions
  "exercise", "activity", "walk", "lift", "drive", "driving", "shower", "bath",
  "work", "rest", "sleep", "stairs",
  // Diet
  "eat", "food", "diet", "drink", "salt", "sodium", "fluid", "water", "alcohol",
  "meal", "nutrition",
  // General health
  "health", "care", "warning", "emergency", "911", "urgent", "concern", "worried",
  "sick", "better", "worse", "improve", "help", "normal", "okay", "ok",
  // Body parts & conditions
  "wound", "incision", "surgery", "operation", "condition", "diagnosis",
  // Questions about this chat/coach
  "you", "coach", "assistant", "what can you", "what do you"
];

/**
 * Check if a message is on-topic (related to health/recovery)
 * Returns true if the message appears to be health-related
 */
function isOnTopic(message: string): boolean {
  const lowerMessage = message.toLowerCase();

  // Check for health-related keywords
  for (const keyword of HEALTH_TOPIC_KEYWORDS) {
    if (lowerMessage.includes(keyword)) {
      return true;
    }
  }

  // Very short messages (greetings, thanks) are allowed
  if (message.trim().length < 20) {
    return true;
  }

  // Questions about "my" anything are likely on-topic
  if (lowerMessage.includes(" my ") || lowerMessage.startsWith("my ")) {
    return true;
  }

  // Questions starting with common patterns about health
  const healthPatterns = [
    /^(can|should|when|what|how|is it|am i|will i|do i)\s+(i|it|safe|okay|normal)/i,
    /^(why|what happens|what should)/i,
    // "What is X?" questions — very common for asking about drugs and medical terms
    /^what\s+(is|are|does|do)\b/i,
    // "Tell me about X" questions
    /^tell\s+me\s+(about|more)/i,
    // "How does X work" questions
    /^how\s+(does|do|should|long|often|much)\b/i,
  ];

  for (const pattern of healthPatterns) {
    if (pattern.test(lowerMessage)) {
      return true;
    }
  }

  // Detect common drug name suffixes (e.g., amoxicillin, metoprolol, furosemide, amlodipine)
  // This catches drug names we haven't explicitly listed
  const drugSuffixPattern = /\b\w+(cillin|mycin|cycline|azole|prazole|sartan|pril|olol|dipine|statin|mide|formin|gliptin|parin|xaban|oxacin|zepam|zosin|tadine|lukast|afil|ximab|zumab|tinib)\b/i;
  if (drugSuffixPattern.test(lowerMessage)) {
    return true;
  }

  return false;
}

/**
 * Generate a polite off-topic response
 */
function getOffTopicResponse(): string {
  const responses = [
    "I'm your Recovery Coach, so I'm best at answering questions about your health, medications, recovery, and discharge plan. Is there anything about your recovery I can help with?",
    "I'm here to help you with questions about your health and recovery! Feel free to ask me about your medications, symptoms to watch for, diet restrictions, or when to see your doctor.",
    "That's outside my area of expertise as your Recovery Coach. I'm here to help with questions about your discharge, medications, symptoms, and recovery. What health questions can I help you with?",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

// Simple in-memory rate limiting (per patient session)
const lastRequestTime: Map<string, number> = new Map();

interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolResults?: Array<{
    id: string;
    name: string;
    result: unknown;
  }>;
}

interface PatientChatRequest {
  patientId: string;
  message: string;
  conversationHistory: ChatMessage[];
  analysis?: DischargeAnalysis;
}

interface PatientChatResponse {
  response: string;
  toolsUsed: Array<{ name: string; result: unknown }>;
  conversationId: string;
  turnNumber: number;
  tokensUsed?: {
    promptChars: number;
    historyMessages: number;
    truncated: boolean;
  };
  limitWarning?: string;
}

/**
 * System prompt for the patient recovery coach
 */
function buildSystemPrompt(patient: Patient, analysis: DischargeAnalysis | null): string {
  const medicationList = patient.medications.map((m) => `- ${m.name} ${m.dose} (${m.frequency})`).join("\n");
  const diagnosisList = patient.diagnoses.map((d) => `- ${d.display} (${d.status})`).join("\n");

  const riskSummary = analysis
    ? analysis.riskFactors
        .filter((rf) => rf.severity === "high" || rf.severity === "moderate")
        .map((rf) => `- [${rf.severity.toUpperCase()}] ${rf.title}`)
        .join("\n")
    : "Not yet analyzed";

  return `You are a friendly, supportive Patient Recovery Coach helping ${patient.name} prepare to go home from the hospital.

## Your Role
- Explain medical information in simple, everyday language
- Help the patient understand their medications, symptoms, and follow-up care
- Use the available tools to provide accurate, patient-specific information
- Be warm, encouraging, and patient-focused

## Patient Context
Name: ${patient.name}
Age: ${patient.age} years old
Gender: ${patient.gender === "M" ? "Male" : patient.gender === "F" ? "Female" : "Other"}

Current Diagnoses:
${diagnosisList || "None documented"}

Current Medications:
${medicationList || "None documented"}

Allergies: ${patient.allergies.length > 0 ? patient.allergies.join(", ") : "None documented"}

Key Concerns Identified:
${riskSummary}

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
You have access to tools to help answer questions:
- lookupMedication: Get information about medications
- checkSymptom: Assess symptom urgency
- explainMedicalTerm: Explain medical jargon simply
- getFollowUpGuidance: Information about appointments
- getDietaryGuidance: Dietary recommendations
- getActivityGuidance: Activity and restriction guidance

Use tools when the patient asks about:
- Any of their medications or new medications
- Symptoms they're experiencing or might experience
- Medical terms they don't understand
- When to see their doctor or what appointments they need
- What they can eat or dietary restrictions
- What activities they can do

When you use a tool, incorporate the information naturally into your response in a friendly, conversational way.`;
}

/**
 * Parse tool calls from LLM response
 */
function parseToolCalls(
  rawContent: string
): Array<{ name: string; arguments: Record<string, unknown> }> | null {
  // Strip Qwen3 thinking tokens before parsing tool calls
  const content = rawContent.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Look for tool calls in various formats the LLM might use
  const toolCallPatterns = [
    // JSON tool call format
    /\[TOOL_CALL\]\s*(\{[\s\S]*?\})\s*\[\/TOOL_CALL\]/g,
    // Function call format
    /<function_call>\s*(\{[\s\S]*?\})\s*<\/function_call>/g,
    // Simple JSON object with tool_name/function_name
    /\{"(?:tool_name|function_name|name)":\s*"(\w+)"[\s\S]*?\}/g,
  ];

  for (const pattern of toolCallPatterns) {
    const matches = content.matchAll(pattern);
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];

    for (const match of matches) {
      try {
        const parsed = JSON.parse(match[1] || match[0]);
        toolCalls.push({
          name: parsed.tool_name || parsed.function_name || parsed.name,
          arguments: parsed.arguments || parsed.parameters || parsed,
        });
      } catch {
        // Continue if JSON parsing fails
      }
    }

    if (toolCalls.length > 0) {
      return toolCalls;
    }
  }

  return null;
}

/**
 * Proactively detect which tool should be used based on message content
 * This bypasses unreliable LLM JSON output by detecting intent directly
 */
function detectRequiredTool(message: string): { name: string; arguments: Record<string, unknown> } | null {
  const lowerMsg = message.toLowerCase();

  // Symptom keywords - use checkSymptom
  const symptomKeywords = [
    "dizzy", "dizziness", "pain", "hurt", "ache", "nausea", "sick", "vomit",
    "fever", "swelling", "swollen", "bleeding", "bleed", "breathe", "breathing",
    "short of breath", "chest", "headache", "tired", "fatigue", "weak", "fall",
    "faint", "confused", "symptom"
  ];
  for (const keyword of symptomKeywords) {
    if (lowerMsg.includes(keyword)) {
      return {
        name: "checkSymptom",
        arguments: { symptom: keyword, severity: "unknown" }
      };
    }
  }

  // Diet keywords - use getDietaryGuidance
  const dietKeywords = [
    "eat", "food", "diet", "drink", "salt", "sodium", "meal", "nutrition",
    "hungry", "appetite", "what can i eat", "what should i eat", "dietary"
  ];
  for (const keyword of dietKeywords) {
    if (lowerMsg.includes(keyword)) {
      // Extract specific topic if possible, otherwise use "general"
      const topicMap: Record<string, string> = {
        salt: "sodium", sodium: "sodium", sugar: "sugar", sweet: "sugar",
        protein: "protein", meat: "protein", fluid: "fluids", water: "fluids",
        drink: "fluids", warfarin: "warfarin",
      };
      const topic = Object.entries(topicMap).find(([k]) => lowerMsg.includes(k))?.[1] || "general";
      return {
        name: "getDietaryGuidance",
        arguments: { topic }
      };
    }
  }

  // Activity keywords - use getActivityGuidance
  const activityKeywords = [
    "exercise", "walk", "activity", "lift", "drive", "driving", "shower",
    "bath", "stairs", "work", "physical", "can i"
  ];
  for (const keyword of activityKeywords) {
    if (lowerMsg.includes(keyword)) {
      // Extract specific activity if possible, otherwise use "general"
      const activityMap: Record<string, string> = {
        walk: "walking", exercise: "exercise", lift: "lifting", drive: "driving",
        driving: "driving", shower: "bathing", bath: "bathing", stairs: "stairs",
        work: "work", physical: "exercise",
      };
      const activity = Object.entries(activityMap).find(([k]) => lowerMsg.includes(k))?.[1] || "general";
      return {
        name: "getActivityGuidance",
        arguments: { activity }
      };
    }
  }

  // Medication keywords - use lookupMedication
  const medicationKeywords = [
    "medication", "medicine", "pill", "drug", "dose", "prescription",
    "warfarin", "aspirin", "lisinopril", "metformin", "what does", "side effect",
    "take", "taking"
  ];
  for (const keyword of medicationKeywords) {
    if (lowerMsg.includes(keyword)) {
      // Try to extract medication name - improved to capture multi-word medication names
      // Patterns to try in order of specificity
      const patterns = [
        // "what is/does [medication name]" - capture up to 3 words
        /(?:what (?:is|does)|tell me about|about)\s+([a-z]+(?:\s+[a-z]+){0,2}?)(?:\s*\?|$|\s+(?:do|for|used|help|work))/i,
        // "[medication] medication/medicine/pill"
        /([a-z]+(?:\s+[a-z]+)?)\s+(?:medication|medicine|pill|drug)/i,
        // "taking [medication]"
        /taking\s+([a-z]+(?:\s+[a-z]+)?)/i,
        // "my [medication]"
        /my\s+([a-z]+(?:\s+[a-z]+)?)\s+(?:medication|medicine|pill|dose)/i,
        // Just capture any known medication names directly
        /(warfarin|coumadin|aspirin|lisinopril|metformin|glucophage|amlodipine|norvasc|metoprolol|lopressor|furosemide|lasix|atorvastatin|lipitor|eliquis|apixaban|insulin|omeprazole|prilosec|pantoprazole|protonix|gabapentin|neurontin|hydrochlorothiazide|hctz|losartan|cozaar|levothyroxine|synthroid|alendronate|fosamax|calcium\s*carbonate|tums|carvedilol|coreg|clopidogrel|plavix|digoxin|lanoxin)/i,
      ];

      let medicationName = "medication";
      for (const pattern of patterns) {
        const match = lowerMsg.match(pattern);
        if (match && match[1]) {
          medicationName = match[1].trim();
          break;
        }
      }

      return {
        name: "lookupMedication",
        arguments: { medicationName }
      };
    }
  }

  // Follow-up keywords - use getFollowUpGuidance
  const followUpKeywords = [
    "appointment", "doctor", "follow-up", "follow up", "when should i see",
    "visit", "check-up", "checkup"
  ];
  for (const keyword of followUpKeywords) {
    if (lowerMsg.includes(keyword)) {
      return {
        name: "getFollowUpGuidance",
        arguments: { question: message }
      };
    }
  }

  return null;
}

/**
 * Compact conversation history by summarizing older messages
 * Keeps recent messages verbatim, summarizes older ones
 */
function compactConversationHistory(history: ChatMessage[]): {
  compacted: string;
  recentMessages: ChatMessage[];
  wasTruncated: boolean;
  summary: string | null;
} {
  // If history is short enough, no compaction needed
  if (history.length <= LIMITS.MAX_HISTORY_MESSAGES) {
    return {
      compacted: "",
      recentMessages: history,
      wasTruncated: false,
      summary: null,
    };
  }

  // Split into old (to summarize) and recent (to keep verbatim)
  const recentCount = Math.floor(LIMITS.MAX_HISTORY_MESSAGES / 2) * 2; // Keep even number for user/assistant pairs
  const oldMessages = history.slice(0, -recentCount);
  const recentMessages = history.slice(-recentCount);

  // Create a brief summary of older messages (no LLM call - just extract key topics)
  const topics = new Set<string>();
  for (const msg of oldMessages) {
    if (msg.role === "user") {
      // Extract keywords from user questions
      const keywords = msg.content.toLowerCase().match(/\b(medication|medicine|pill|symptom|feel|pain|dizzy|appointment|doctor|diet|eat|exercise|activity)\b/g);
      if (keywords) {
        keywords.forEach(k => topics.add(k));
      }
    }
  }

  const summary = topics.size > 0
    ? `Earlier in the conversation, the patient asked about: ${Array.from(topics).join(", ")}.`
    : null;

  return {
    compacted: summary || "[Previous messages summarized]",
    recentMessages,
    wasTruncated: true,
    summary,
  };
}

/**
 * Estimate token count from character count (rough approximation)
 * ~4 characters per token for English text
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Main chat endpoint
 */
export async function POST(request: NextRequest) {
  // Session-wide demo rate limit: 20 messages per 15 minutes
  const blocked = applyRateLimit(request, "chat");
  if (blocked) return blocked;

  const body = await request.json();
  const { stream = false } = body;

  // If streaming requested, use SSE
  if (stream) {
    return handleStreamingChat(request, body);
  }

  // Otherwise, use regular JSON response
  const opik = getOpikClient();
  const turnId = `turn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Hoisted so they're available in the catch block for error tracing
  let patientId = "";
  let turnNumber = 0;

  const trace = opik?.trace({
    name: "patient-chat-turn",
    metadata: {
      turn_id: turnId,
      model: getActiveModelId(),
      category: "patient-education",
      agentic: true,
    },
  });

  try {
    const chatRequest: PatientChatRequest = body;
    const { message, conversationHistory, analysis } = chatRequest;
    patientId = chatRequest.patientId;

    // Now that we have patientId, update trace with thread grouping
    const threadId = `chat-${patientId}`;
    trace?.update({
      threadId,
      metadata: {
        patientId,
      },
    });

    // Rate limiting check
    const now = Date.now();
    const lastRequest = lastRequestTime.get(patientId);
    if (lastRequest && now - lastRequest < LIMITS.MIN_REQUEST_INTERVAL_MS) {
      return NextResponse.json(
        { error: "Please wait a moment before sending another message" },
        { status: 429 }
      );
    }
    lastRequestTime.set(patientId, now);

    // Check conversation turn limit
    turnNumber = Math.floor(conversationHistory.length / 2) + 1;
    let limitWarning: string | undefined;
    if (turnNumber >= LIMITS.MAX_CONVERSATION_TURNS) {
      limitWarning = `You've reached ${turnNumber} messages. Consider starting a new conversation for complex questions.`;
    }

    // Check for off-topic messages (guardrail)
    if (!isOnTopic(message)) {
      console.log(`[Patient Chat] Off-topic message detected: "${message.slice(0, 50)}..."`);
      trace?.update({
        metadata: { off_topic: true, message_snippet: message.slice(0, 50) },
        output: { blocked: true, reason: "off_topic" },
      });
      trace?.end();

      return NextResponse.json({
        response: getOffTopicResponse(),
        toolsUsed: [],
        conversationId: turnId,
        turnNumber,
        tokensUsed: {
          promptChars: 0,
          historyMessages: 0,
          truncated: false,
        },
        offTopic: true,
      });
    }

    // Get patient data
    const patient = getPatient(patientId);
    if (!patient) {
      trace?.update({ output: { error: "Patient not found" } });
      trace?.end();
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Initialize or retrieve memory session for this patient chat
    const memorySessionId = `chat-${patientId}`;
    let memorySession = getMemorySession(memorySessionId);
    if (!memorySession) {
      memorySession = createMemorySession(memorySessionId, `Patient chat for ${patientId}`);
      setPatientContext(memorySessionId, patient);
    }
    addConversationTurn(memorySessionId, { role: "user", content: message });

    // Compact conversation history (summarize old, keep recent verbatim)
    const {
      recentMessages,
      wasTruncated,
      summary: conversationSummary,
    } = compactConversationHistory(conversationHistory);

    trace?.update({
      metadata: {
        patient_id: patientId,
        turn_number: turnNumber,
        message_length: message.length,
        history_compacted: wasTruncated,
        original_history_count: conversationHistory.length,
        recent_messages_kept: recentMessages.length,
      },
    });

    // Build conversation context — keep system prompt separate for proper role-based messaging
    const systemPrompt = buildSystemPrompt(patient, analysis || null);
    const provider = createLLMProvider();

    // Build memory context from previous sessions/turns
    const memoryContext = buildContextForLLM(memorySessionId);

    // Build user prompt (context + history + current message + instructions)
    // System prompt is passed separately via provider options for proper role:"system" handling
    let userPrompt = "";

    if (memoryContext) {
      userPrompt += `## Memory Context\n${memoryContext}\n\n`;
    }

    userPrompt += `## Conversation History\n`;

    // Add summary of older messages if conversation was compacted
    if (wasTruncated && conversationSummary) {
      userPrompt += `[Summary of earlier conversation: ${conversationSummary}]\n\n`;
    }

    // Add recent messages verbatim (but still with length limits)
    for (const msg of recentMessages) {
      if (msg.role === "user") {
        // Truncate very long messages
        const content = msg.content.length > 500 ? msg.content.slice(0, 500) + "..." : msg.content;
        userPrompt += `Patient: ${content}\n`;
      } else if (msg.role === "assistant") {
        // Truncate assistant responses more aggressively
        const content = msg.content.length > 300 ? msg.content.slice(0, 300) + "..." : msg.content;
        userPrompt += `Coach: ${content}\n`;
      } else if (msg.role === "tool") {
        userPrompt += `[Tool used]\n`;
      }
    }

    // Check if user prompt is too long (system prompt is separate)
    const userPromptCharCount = userPrompt.length;
    if (userPromptCharCount > LIMITS.MAX_PROMPT_CHARS) {
      // Truncate the user prompt
      console.warn(`[Patient Chat] User prompt too long (${userPromptCharCount} chars), truncating`);
      userPrompt = userPrompt.slice(0, LIMITS.MAX_PROMPT_CHARS) + "\n[Earlier context truncated]\n";
    }

    userPrompt += `\nPatient: ${message}\n\n`;
    userPrompt += `## Instructions
You are responding to the patient's message above. Give a COMPLETE, helpful answer.

IMPORTANT: For these types of questions, you MUST use a tool first:
- Questions about symptoms (dizziness, pain, nausea, etc.) → use checkSymptom
- Questions about medications → use lookupMedication
- Questions about medical terms → use explainMedicalTerm
- Questions about diet → use getDietaryGuidance
- Questions about activity/exercise → use getActivityGuidance
- Questions about follow-up appointments → use getFollowUpGuidance

Available tools:
${PATIENT_COACH_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

If you need to use a tool, respond with ONLY a JSON object (no other text):
{"tool_name": "toolName", "arguments": {"paramName": "value"}}

If this is a general question that doesn't need a tool, respond directly with a COMPLETE answer.

NEVER say things like "let's check" or "I'll look that up" without actually using a tool.
NEVER give incomplete answers. Always provide actionable guidance.

Remember:
- Use simple language a patient can understand
- Be warm and supportive
- For serious symptoms, always mention when to call 911
- Encourage asking their healthcare team for clarification

Coach:`;

    // Combined prompt for Opik logging (full context for observability)
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    // PROACTIVE TOOL DETECTION: Detect required tool from message content
    // This bypasses unreliable LLM JSON output
    const proactiveTool = detectRequiredTool(message);
    const toolsUsed: Array<{ name: string; result: unknown }> = [];
    let finalResponse = "";

    if (proactiveTool) {
      // Tool detected from message - execute it directly without asking LLM
      console.log(`[Patient Chat] Proactive tool detected: ${proactiveTool.name}`);

      const toolSpan = trace?.span({
        name: `tool-${proactiveTool.name}`,
        type: "tool",
        metadata: {
          tool_name: proactiveTool.name,
          arguments: proactiveTool.arguments,
          proactive: true,
        },
      });

      const toolResult = await executePatientCoachTool(
        proactiveTool.name,
        proactiveTool.arguments,
        patient,
        analysis || null
      );

      toolsUsed.push({
        name: proactiveTool.name,
        result: toolResult.result,
      });
      storeToolResult(memorySessionId, proactiveTool.name, toolResult.result);

      toolSpan?.update({
        output: {
          success: toolResult.success,
          result_summary:
            typeof toolResult.result === "object"
              ? JSON.stringify(toolResult.result).slice(0, 300)
              : String(toolResult.result),
        },
      });
      toolSpan?.end();

      // Generate response using tool results (system prompt passed separately via options)
      const toolResultsPrompt = `${userPrompt}

I looked up information to help answer your question:

Tool: ${proactiveTool.name}
Result: ${JSON.stringify(toolResult.result, null, 2)}

You MUST use the tool results above to give a complete, specific answer to the patient's question.
Do NOT ask follow-up questions or say "tell me more" — answer directly using the data provided.
Use simple language. Be specific and actionable. Include any relevant warnings (when to call 911, when to call the doctor).

Coach:`;

      const responseSpan = trace?.span({
        name: "final-generation",
        type: "llm",
        metadata: { purpose: "generate-response-with-tools", proactive: true },
      });

      const finalLLMResponse = await provider.generate(toolResultsPrompt, {
        spanName: "patient-chat-with-tool",
        systemPrompt,
        metadata: {
          patient_id: patientId,
          purpose: "final-response",
          tools_used: [proactiveTool.name],
        },
      });

      responseSpan?.update({
        output: { response: finalLLMResponse.content.slice(0, 500) },
      });
      responseSpan?.end();

      finalResponse = finalLLMResponse.content;
    } else {
      // No proactive tool needed - let LLM respond directly or request a tool
      const initialSpan = trace?.span({
        name: "initial-generation",
        type: "llm",
        metadata: { purpose: "determine-response-or-tool" },
      });

      const initialResponse = await provider.generate(userPrompt, {
        spanName: "patient-chat-initial",
        systemPrompt,
        metadata: {
          patient_id: patientId,
          purpose: "initial-response",
        },
      });

      initialSpan?.update({
        output: { response: initialResponse.content.slice(0, 500) },
      });
      initialSpan?.end();

      // Check if LLM wants to use a tool (fallback)
      const toolCalls = parseToolCalls(initialResponse.content);
      finalResponse = initialResponse.content;

      if (toolCalls && toolCalls.length > 0) {
      // Limit tool calls to prevent runaway usage
      const limitedToolCalls = toolCalls.slice(0, LIMITS.MAX_TOOLS_PER_TURN);
      if (toolCalls.length > LIMITS.MAX_TOOLS_PER_TURN) {
        console.warn(`[Patient Chat] Tool calls limited from ${toolCalls.length} to ${LIMITS.MAX_TOOLS_PER_TURN}`);
      }

      // Execute tool calls
      for (const toolCall of limitedToolCalls) {
        const toolSpan = trace?.span({
          name: `tool-${toolCall.name}`,
          type: "tool",
          metadata: {
            tool_name: toolCall.name,
            arguments: toolCall.arguments,
          },
        });

        const toolResult = await executePatientCoachTool(
          toolCall.name,
          toolCall.arguments,
          patient,
          analysis || null
        );

        toolsUsed.push({
          name: toolCall.name,
          result: toolResult.result,
        });
        storeToolResult(memorySessionId, toolCall.name, toolResult.result);

        toolSpan?.update({
          output: {
            success: toolResult.success,
            result_summary:
              typeof toolResult.result === "object"
                ? JSON.stringify(toolResult.result).slice(0, 300)
                : String(toolResult.result),
          },
        });
        toolSpan?.end();
      }

      // Second LLM call - generate response using tool results (system prompt passed separately)
      const toolResultsPrompt = `${userPrompt}

I used the following tools to help answer the patient's question:

${toolsUsed
  .map(
    (t) => `Tool: ${t.name}
Result: ${JSON.stringify(t.result, null, 2)}`
  )
  .join("\n\n")}

You MUST use the tool results above to give a complete, specific answer to the patient's question.
Do NOT ask follow-up questions or say "tell me more" — answer directly using the data provided.
Incorporate the information naturally without mentioning that you used tools.
Use simple language and be encouraging.

Coach:`;

      const responseSpan = trace?.span({
        name: "final-generation",
        type: "llm",
        metadata: { purpose: "generate-response-with-tools" },
      });

      const finalLLMResponse = await provider.generate(toolResultsPrompt, {
        spanName: "patient-chat-final",
        systemPrompt,
        metadata: {
          patient_id: patientId,
          purpose: "final-response",
          tools_used: toolsUsed.map((t) => t.name),
        },
      });

      responseSpan?.update({
        output: { response: finalLLMResponse.content.slice(0, 500) },
      });
      responseSpan?.end();

      finalResponse = finalLLMResponse.content;
      }
    }

    // Clean up the response (remove thinking tokens, tool call syntax, JSON artifacts)
    finalResponse = finalResponse
      // Remove Qwen3/LLM thinking tokens (closed and unclosed)
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/<think>[\s\S]*/g, "")  // Unclosed think block (hit token limit)
      // Remove complete JSON tool calls
      .replace(/\{"tool_name"[\s\S]*?\}/g, "")
      .replace(/\{"name"[\s\S]*?"arguments"[\s\S]*?\}/g, "")
      .replace(/\[TOOL_CALL\][\s\S]*?\[\/TOOL_CALL\]/g, "")
      .replace(/<function_call>[\s\S]*?<\/function_call>/g, "")
      // Remove any standalone JSON-like artifacts (stray braces, brackets)
      .replace(/^\s*[\{\}]\s*$/gm, "")
      .replace(/\n\s*[\{\}]\s*\n/g, "\n")
      // Remove trailing/leading braces that might be left over
      .replace(/^\s*\}\s*/g, "")
      .replace(/\s*\{\s*$/g, "")
      // Clean up extra whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // If response is empty after cleanup, provide a fallback
    if (!finalResponse) {
      finalResponse =
        "I'd be happy to help you with that! Could you tell me a bit more about what you'd like to know?";
    }

    // Store assistant response in memory
    addConversationTurn(memorySessionId, {
      role: "assistant",
      content: finalResponse,
      metadata: {
        toolCalls: toolsUsed.map((t) => ({ tool: t.name, success: true })),
        model: getActiveModelId(),
      },
    });

    const responseData: PatientChatResponse = {
      response: finalResponse,
      toolsUsed,
      conversationId: turnId,
      turnNumber,
      tokensUsed: {
        promptChars: userPromptCharCount,
        historyMessages: recentMessages.length,
        truncated: wasTruncated,
      },
      limitWarning,
    };

    trace?.update({
      output: {
        response_length: finalResponse.length,
        tools_used_count: toolsUsed.length,
        tools_used: toolsUsed.map((t) => t.name),
      },
      metadata: {
        prompt_chars: userPromptCharCount,
        estimated_prompt_tokens: estimateTokens(fullPrompt),
        history_compacted: wasTruncated,
      },
    });
    trace?.end();
    // Single flush at the end — covers all LLM spans created during this request
    await flushTraces();

    return NextResponse.json(responseData);
  } catch (error) {
    traceError("api-patient-chat", error);

    // Build errorInfo so Opik dashboard counts this as an error trace
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorInfo = {
      exceptionType: error instanceof Error ? error.name : "Error",
      message: errorMessage,
      traceback: error instanceof Error ? (error.stack ?? errorMessage) : errorMessage,
    };

    // Create proper error span on the trace for visibility in Opik
    const errorSpan = trace?.span({
      name: "error",
      metadata: {
        success: false,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    errorSpan?.end();

    // Set errorInfo on the trace itself (this is what the dashboard widget reads)
    trace?.update({
      errorInfo,
      output: { error: errorMessage },
    });
    trace?.end();

    // Also log standalone error trace for aggregation/filtering
    // (traceError calls flushTraces internally, so this also serves as the final flush)
    await traceError("api-patient-chat", error, {
      patientId,
      threadId: patientId ? `chat-${patientId}` : undefined,
    });

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to process chat message",
      },
      { status: 500 }
    );
  }
}

/**
 * Handle streaming patient chat with SSE progress updates for tool calls
 */
async function handleStreamingChat(
  request: NextRequest,
  chatRequest: PatientChatRequest & { stream?: boolean }
) {
  const { stream: sseStream, emitStep, emitResult, emitError, complete } = createProgressStream();
  const { patientId, message, conversationHistory, analysis } = chatRequest;

  // Start async work that emits progress events
  (async () => {
    try {
      // Get patient
      const patient = getPatient(patientId);
      if (!patient) {
        emitError("Patient not found");
        complete();
        return;
      }

      // Check if message is on-topic
      if (!isOnTopic(message)) {
        emitResult({
          response: getOffTopicResponse(),
          toolsUsed: [],
        });
        complete();
        return;
      }

      // Detect which tool to use
      const toolToUse = detectRequiredTool(message);
      const toolsUsed: Array<{ name: string; result: unknown }> = [];

      if (toolToUse) {
        // Emit progress for tool execution
        const toolResult = await withProgress(
          emitStep,
          toolToUse.name,
          getToolProgressLabel(toolToUse.name),
          "tool",
          async () => {
            return await executePatientCoachTool(
              toolToUse.name,
              toolToUse.arguments,
              patient,
              analysis || null
            );
          }
        );

        toolsUsed.push({
          name: toolToUse.name,
          result: toolResult.success ? toolResult.result : { error: toolResult.error },
        });
      }

      // Emit progress for LLM response generation
      const response = await withProgress(
        emitStep,
        "llm-response",
        "Generating response",
        "llm",
        async () => {
          // Build system prompt
          const systemPrompt = buildSystemPrompt(patient, analysis || null);

          // Build conversation context
          const messages = [
            { role: "system" as const, content: systemPrompt },
            ...conversationHistory.slice(-LIMITS.MAX_HISTORY_MESSAGES),
            { role: "user" as const, content: message },
          ];

          // Add tool results if any
          if (toolsUsed.length > 0) {
            const toolContext = toolsUsed
              .map((t) => `[Tool: ${t.name}]\n${JSON.stringify(t.result, null, 2)}`)
              .join("\n\n");
            messages.push({
              role: "system" as const,
              content: `Tool results:\n${toolContext}\n\nIncorporate this information naturally into your response.`,
            });
          }

          const provider = createLLMProvider();
          const llmResponse = await provider.generate(
            messages.map((m) => m.content).join("\n\n"),
            {
              spanName: "patient-chat-response",
              metadata: { patientId, turn: conversationHistory.length + 1 },
            }
          );

          return llmResponse.content;
        }
      );

      // Send final result
      emitResult({
        response,
        toolsUsed,
        conversationId: patientId,
        turnNumber: Math.floor(conversationHistory.length / 2) + 1,
      });

      complete();
    } catch (error) {
      traceError("api-patient-chat-stream", error);
      emitError(error instanceof Error ? error.message : "Chat failed");
      complete();
    }
  })();

  // Return SSE stream immediately
  return new Response(sseStream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

/**
 * Get user-friendly label for tool progress
 */
function getToolProgressLabel(toolName: string): string {
  const labels: Record<string, string> = {
    lookupMedication: "Looking up medication information",
    checkSymptom: "Checking symptom severity",
    explainMedicalTerm: "Explaining medical term",
    getFollowUpGuidance: "Getting follow-up guidance",
    getDietaryGuidance: "Looking up dietary recommendations",
    getActivityGuidance: "Checking activity restrictions",
  };
  return labels[toolName] || `Executing ${toolName}`;
}
