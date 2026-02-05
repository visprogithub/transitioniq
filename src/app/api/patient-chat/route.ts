/**
 * Patient Chat API - ReAct-based Conversational Agent
 *
 * This endpoint implements a TRUE ReAct (Reasoning and Acting) patient coach where:
 * - The LLM reasons about what the patient is asking
 * - The LLM decides which tools to use based on reasoning (NOT keyword matching)
 * - The LLM can chain multiple tools if needed
 * - The LLM synthesizes tool results into a helpful response
 *
 * NO hardcoded keyword matching. The agent dynamically reasons about each request.
 */

import { NextRequest, NextResponse } from "next/server";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { getActiveModelId } from "@/lib/integrations/llm-provider";
import { getOpikClient, traceError, flushTraces } from "@/lib/integrations/opik";
import { applyInputGuardrails, applyOutputGuardrails } from "@/lib/guardrails";
import { getPatient } from "@/lib/data/demo-patients";
import {
  runReActLoop,
  runReActLoopStreaming,
  createReActSSEStream,
  createReActTool,
  type ReActTool,
} from "@/lib/agents/react-loop";
import {
  executePatientCoachTool,
  PATIENT_COACH_TOOLS,
} from "@/lib/agents/patient-coach-tools";
import {
  createMemorySession,
  getMemorySession,
  addConversationTurn,
  setPatientContext,
  storeToolResult,
  buildContextForLLM,
} from "@/lib/agents/memory";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

/**
 * Configuration limits
 */
const LIMITS = {
  MAX_HISTORY_MESSAGES: 10,
  MAX_REACT_ITERATIONS: 12, // Increased from 6 to allow agent to properly use tool results
  MAX_CONVERSATION_TURNS: 15,
  MIN_REQUEST_INTERVAL_MS: 500,
};

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
  reactTrace?: {
    iterations: number;
    reasoningTrace: string;
  };
  limitWarning?: string;
}

/**
 * Build the system prompt for the patient coach ReAct agent
 */
function buildPatientCoachSystemPrompt(patient: Patient, analysis: DischargeAnalysis | null): string {
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
- Help the patient understand their medications, symptoms, and follow-up care
- Use tools to provide accurate, patient-specific information
- Be warm, encouraging, and use simple everyday language
- NEVER diagnose or tell patients to change medications without consulting their doctor

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
Adjust your language based on the patient's age:
- Children: Simple words, friendly comparisons, encouragement
- Teenagers: Straightforward, explain the "why", don't talk down
- Adults: Clear plain language, brief medical term explanations
- Seniors (65+): Patient, clear steps, involve family when helpful
- Elderly (80+): Short focused explanations, repeat key points

## How to Synthesize Tool Results

Tools return RAW DATA (JSON with lists, medical terms, numbers). Your job is to transform this into helpful patient responses:

1. **Transform to patient-friendly language:**
   - Medical: "Myocardial infarction" → "heart attack"
   - Foods: ["salmon", "quinoa"] → "**grilled salmon** (omega-3s help your heart) and **quinoa** (protein without salt)"

2. **Personalize for THIS ${patient.age} year old:**
   - Reference their age: "At ${patient.age}, gentle activities like..."
   - Mention conditions: "For your [condition], try..."
   - Note medications: "Since you take [med], watch for..."

3. **Format with markdown:**
   - **bold** for food names, medications, timeframes, warning signs
   - Line breaks between suggestions
   - Short paragraphs (2-3 sentences)

4. **Synthesize multiple tools together:**
   If you called both dietary + medication tools: "For your heart failure (medication tool), try **salmon** (dietary tool) but avoid **grapefruit** (interacts with Lipitor)."

5. **Keep it concise:**
   - Under 150 words
   - Answer their specific question
   - Give 3-5 actionable items

**Example:**
Tool: {suggestedFoods: ["salmon", "quinoa"], patientAge: 68, conditions: ["heart failure"]}
❌ BAD: "The tool suggests salmon and quinoa."
✅ GOOD: "For your heart failure, try **grilled salmon** 2-3x weekly (omega-3s reduce inflammation) and **quinoa** instead of rice (protein without sodium). At 68, these gentle foods support your heart health."

## Important Guardrails
NEVER:
- Make specific diagnoses
- Tell patients to stop or change medications
- Dismiss serious symptoms
- Provide emergency medical guidance (always direct to 911)

ALWAYS:
- Encourage patients to ask their healthcare team
- Recommend calling their doctor for concerning symptoms
- Direct to 911 for serious symptoms (chest pain, difficulty breathing, stroke signs)
- Use tools to look up accurate information before answering`;
}

/**
 * Create ReAct tools from patient coach tool definitions
 */
function createPatientCoachReActTools(
  patient: Patient,
  analysis: DischargeAnalysis | null,
  memorySessionId: string
): ReActTool[] {
  return PATIENT_COACH_TOOLS.map((toolDef) =>
    createReActTool(
      toolDef.name,
      toolDef.description,
      toolDef.parameters,
      async (args) => {
        const result = await executePatientCoachTool(
          toolDef.name,
          args,
          patient,
          analysis
        );
        if (result.success) {
          storeToolResult(memorySessionId, toolDef.name, result.result);
        }
        return result.result;
      }
    )
  );
}

/**
 * Build conversation context from history
 */
function buildConversationContext(history: ChatMessage[], maxMessages: number): string {
  const recentHistory = history.slice(-maxMessages);

  if (recentHistory.length === 0) {
    return "";
  }

  const lines: string[] = ["## Recent Conversation"];
  for (const msg of recentHistory) {
    if (msg.role === "user") {
      lines.push(`Patient: ${msg.content.slice(0, 300)}`);
    } else if (msg.role === "assistant") {
      lines.push(`Coach: ${msg.content.slice(0, 200)}...`);
    }
  }

  return lines.join("\n");
}

/**
 * Main chat endpoint - uses ReAct agent for reasoning
 * Supports both streaming (SSE) and non-streaming modes
 *
 * Query params:
 * - stream=true: Return SSE stream showing reasoning in real-time
 */
export async function POST(request: NextRequest) {
  // Session-wide demo rate limit
  const blocked = applyRateLimit(request, "chat");
  if (blocked) return blocked;

  // Check if streaming is requested
  const useStreaming = request.nextUrl.searchParams.get("stream") === "true";

  const opik = getOpikClient();
  const turnId = `turn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  let patientId = "";
  let turnNumber = 0;

  const trace = opik?.trace({
    name: useStreaming ? "patient-chat-react-streaming" : "patient-chat-react",
    metadata: {
      turn_id: turnId,
      model: getActiveModelId(),
      category: "patient-education",
      agentic: true,
      react: true,
      streaming: useStreaming,
    },
  });

  try {
    const body: PatientChatRequest = await request.json();
    const { message, conversationHistory, analysis } = body;
    patientId = body.patientId;

    // Update trace with thread grouping
    const threadId = `chat-${patientId}`;
    trace?.update({
      threadId,
      metadata: { patientId },
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

    // Get patient data
    const patient = getPatient(patientId);
    if (!patient) {
      trace?.update({ output: { error: "Patient not found" } });
      trace?.end();
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Initialize or retrieve memory session
    const memorySessionId = `chat-${patientId}`;
    let memorySession = getMemorySession(memorySessionId);
    if (!memorySession) {
      memorySession = createMemorySession(memorySessionId, `Patient chat for ${patientId}`);
      setPatientContext(memorySessionId, patient);
    }
    addConversationTurn(memorySessionId, { role: "user", content: message });

    // Apply PII guardrails to user input BEFORE processing
    const inputGuardrail = applyInputGuardrails(message, {
      sanitizePII: true,
      usePlaceholders: true,
      blockCriticalPII: true,
      logToOpik: true,
      traceName: "guardrail-patient-chat-input",
    });

    if (inputGuardrail.wasBlocked) {
      return NextResponse.json(
        {
          response: "I cannot process that message as it contains sensitive personal information. Please rephrase without including SSN, credit card numbers, or other private details.",
          blocked: true,
        },
        { status: 400 }
      );
    }

    // Use sanitized message for all further processing
    const sanitizedMessage = inputGuardrail.output;

    // Build context
    const conversationContext = buildConversationContext(conversationHistory, LIMITS.MAX_HISTORY_MESSAGES);
    const memoryContext = buildContextForLLM(memorySessionId);

    // Build the user message with context (using sanitized message)
    let userMessage = sanitizedMessage;
    if (conversationContext || memoryContext) {
      userMessage = `${memoryContext ? `## Memory Context\n${memoryContext}\n\n` : ""}${conversationContext ? `${conversationContext}\n\n` : ""}## Current Question\nPatient: ${sanitizedMessage}`;
    }

    trace?.update({
      metadata: {
        patient_id: patientId,
        turn_number: turnNumber,
        message_length: message.length,
        history_count: conversationHistory.length,
      },
    });

    // Create ReAct tools from patient coach tools
    const tools = createPatientCoachReActTools(patient, analysis || null, memorySessionId);

    const reactOptions = {
      systemPrompt: buildPatientCoachSystemPrompt(patient, analysis || null),
      tools,
      maxIterations: LIMITS.MAX_REACT_ITERATIONS,
      threadId,
      // Use quick grounding check (pattern-based, no LLM call) to catch hallucinated dosages/stats
      verifyGrounding: "quick" as const,
      metadata: {
        patientId,
        turnNumber,
        category: "patient-education",
        streaming: useStreaming,
      },
    };

    // If streaming requested, return SSE stream
    if (useStreaming) {
      const generator = runReActLoopStreaming(userMessage, reactOptions);
      const stream = createReActSSEStream(generator);

      trace?.update({
        output: { streaming: true },
      });
      // Note: trace will be ended when stream completes via generator

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Conversation-Id": turnId,
          "X-Turn-Number": String(turnNumber),
          ...(limitWarning && { "X-Limit-Warning": limitWarning }),
        },
      });
    }

    // Non-streaming path: Run the ReAct loop and return JSON
    const reactResult = await runReActLoop(userMessage, reactOptions);

    // Apply PII guardrails to output BEFORE returning to user
    const outputGuardrail = applyOutputGuardrails(reactResult.answer, {
      sanitizePII: true,
      usePlaceholders: true,
      logToOpik: true,
      traceName: "guardrail-patient-chat-output",
    });

    const sanitizedAnswer = outputGuardrail.output;

    // Extract tools used
    const toolsUsed: Array<{ name: string; result: unknown }> = reactResult.steps
      .filter((s) => s.action && s.observation)
      .map((s) => ({
        name: s.action!.tool,
        result: s.observation ? JSON.parse(s.observation) : null,
      }));

    // Store sanitized assistant response in memory
    addConversationTurn(memorySessionId, {
      role: "assistant",
      content: sanitizedAnswer,
      metadata: {
        toolCalls: toolsUsed.map((t) => ({ tool: t.name, success: true })),
        model: getActiveModelId(),
        reactIterations: reactResult.iterations,
      },
    });

    const responseData: PatientChatResponse = {
      response: sanitizedAnswer,  // Use sanitized output
      toolsUsed,
      conversationId: turnId,
      turnNumber,
      reactTrace: {
        iterations: reactResult.iterations,
        reasoningTrace: reactResult.reasoningTrace,
      },
      limitWarning,
    };

    trace?.update({
      output: {
        response_length: reactResult.answer.length,
        tools_used_count: toolsUsed.length,
        tools_used: toolsUsed.map((t) => t.name),
        react_iterations: reactResult.iterations,
      },
    });
    trace?.end();
    // Single flush at the end — covers all LLM spans created during this request
    await flushTraces();

    return NextResponse.json(responseData);
  } catch (error) {
    console.error("[Patient Chat] Error:", error);

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
