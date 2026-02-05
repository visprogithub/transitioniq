/**
 * Agent Orchestrator - ReAct-based Discharge Readiness Assessment
 *
 * This orchestrator implements a TRUE ReAct (Reasoning and Acting) agent where:
 * - The LLM decides which tools to call based on its reasoning
 * - The LLM observes tool results and decides what to do next
 * - The LLM determines when it has enough information to provide an answer
 *
 * NO hardcoded pipelines. The agent dynamically reasons about each step.
 */

import { v4 as uuidv4 } from "uuid";
import { executeTool } from "./tools";
import {
  runReActLoop,
  runReActLoopStreaming,
  createReActTool,
  type ReActTool,
  type ReActResult,
  type ReActStreamEvent,
} from "./react-loop";
import { traceAgentExecution, logToolCorrectness } from "./tracing";
import {
  createMemorySession,
  addConversationTurn,
  setPatientContext,
  storeToolResult,
  addReasoningStep,
  storeAssessment,
  getAssessmentContext,
} from "./memory";
import { getActiveModelId } from "@/lib/integrations/llm-provider";
import type {
  AgentState,
  AgentStep,
  ToolCall,
  AgentResponse,
  AgentGraph,
  GraphNode,
  DrugInteractionContext,
  CareGapContext,
  CostContext,
} from "./types";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

/**
 * In-memory session store (would be Redis/DB in production)
 */
const sessions = new Map<string, AgentState>();

const AGENT_SESSION_LIMITS = {
  MAX_SESSIONS: 30,
  SESSION_TTL_MS: 30 * 60 * 1000, // 30 minutes
  CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
};
let lastAgentCleanup = Date.now();

/** Evict stale / excess agent sessions */
function cleanupAgentSessions(): void {
  const now = Date.now();
  if (now - lastAgentCleanup < AGENT_SESSION_LIMITS.CLEANUP_INTERVAL_MS) return;
  lastAgentCleanup = now;

  // Evict sessions older than TTL
  for (const [id, state] of sessions.entries()) {
    const updated = new Date(state.updatedAt).getTime();
    if (now - updated > AGENT_SESSION_LIMITS.SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }

  // If still over limit, drop oldest
  if (sessions.size > AGENT_SESSION_LIMITS.MAX_SESSIONS) {
    const sorted = [...sessions.entries()].sort(
      (a, b) => new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime()
    );
    const toRemove = sorted.slice(0, sessions.size - AGENT_SESSION_LIMITS.MAX_SESSIONS);
    for (const [id] of toRemove) {
      sessions.delete(id);
    }
  }
}

/**
 * Accumulated context during agent execution
 */
interface ExecutionContext {
  patient?: Patient;
  drugInteractions?: unknown[];
  careGaps?: unknown[];
  costs?: unknown[];
  knowledgeContext?: unknown;
  analysis?: DischargeAnalysis;
}

/**
 * Create a new agent session
 */
export function createSession(goal: string): AgentState {
  cleanupAgentSessions();

  const sessionId = uuidv4();
  const state: AgentState = {
    sessionId,
    currentGoal: goal,
    steps: [],
    context: {
      conversationHistory: [],
    },
    status: "planning",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  sessions.set(sessionId, state);

  // Initialize memory session
  createMemorySession(sessionId, goal);

  return state;
}

/**
 * Get an existing session
 */
export function getSession(sessionId: string): AgentState | undefined {
  cleanupAgentSessions();
  return sessions.get(sessionId);
}

/**
 * Build the system prompt for the discharge assessment ReAct agent
 */
function buildAssessmentSystemPrompt(patientId: string): string {
  return `You are a clinical discharge readiness assessment agent. Your job is to thoroughly assess whether a patient is ready for hospital discharge.

## Your Goal
Assess discharge readiness for patient "${patientId}" by gathering all relevant information and computing a comprehensive risk assessment.

## Assessment Process
You should reason about what information you need and gather it step by step:

1. **Start by fetching the patient data** - You need to know who the patient is, their conditions, and medications
2. **Check for drug interactions** - Look for dangerous medication combinations
3. **Evaluate care gaps** - Check if clinical guidelines are being followed
4. **Estimate medication costs** - Identify potential financial barriers
5. **Retrieve clinical knowledge** - Get relevant clinical context for the patient's conditions
6. **Analyze readiness** - Once you have all the data, compute the final assessment

## Important
- Be thorough - a missed risk factor could harm the patient
- Reason explicitly about what you've learned and what you still need
- If a tool fails, reason about whether you can proceed or need to try again
- Your final answer should summarize the assessment clearly

## Output Format
Your final answer should include:
- The discharge readiness score (0-100)
- The status (ready, caution, not_ready)
- Key risk factors identified
- Recommendations for the care team`;
}

/**
 * Create the ReAct tools for discharge assessment
 */
function createAssessmentTools(
  sessionId: string,
  patientId: string,
  executionContext: ExecutionContext
): ReActTool[] {
  return [
    createReActTool(
      "fetch_patient",
      "Fetch patient demographic data, diagnoses, medications, allergies, labs, and vital signs. This is usually the first tool you should call.",
      {
        type: "object",
        properties: {
          patientId: { type: "string", description: "The patient ID to fetch" },
        },
        required: ["patientId"],
      },
      async (args) => {
        const result = await executeTool("fetch_patient", { patientId: args.patientId || patientId });
        if (result.success && result.data) {
          const patientData = result.data as { raw: Patient };
          executionContext.patient = patientData.raw;
          setPatientContext(sessionId, patientData.raw);
          storeToolResult(sessionId, "fetch_patient", result.data);
          addReasoningStep(sessionId, `Fetched patient data: ${patientData.raw.name}, ${patientData.raw.age}yo, ${patientData.raw.medications.length} medications`);
        }
        return result.data;
      }
    ),

    createReActTool(
      "check_drug_interactions",
      "Check for dangerous drug-drug interactions in the patient's medication list using FDA data. Requires patient data to be fetched first.",
      {
        type: "object",
        properties: {
          medications: {
            type: "array",
            description: "List of medication objects with name, dose, frequency",
          },
        },
        required: [],
      },
      async (args) => {
        const meds = args.medications || executionContext.patient?.medications || [];
        const result = await executeTool("check_drug_interactions", { medications: meds });
        if (result.success) {
          executionContext.drugInteractions = result.data as unknown[];
          storeToolResult(sessionId, "check_drug_interactions", result.data);
          const interactions = result.data as unknown[];
          addReasoningStep(sessionId, `Found ${interactions.length} drug interactions`);
        }
        return result.data;
      }
    ),

    createReActTool(
      "evaluate_care_gaps",
      "Evaluate compliance with clinical practice guidelines (USPSTF, AHA, etc.) for the patient's conditions. Identifies gaps in recommended care.",
      {
        type: "object",
        properties: {
          patient: {
            type: "object",
            description: "The patient object (optional - uses cached patient if not provided)",
          },
        },
        required: [],
      },
      async (args) => {
        const patient = args.patient || executionContext.patient;
        if (!patient) {
          return { error: "No patient data available. Call fetch_patient first." };
        }
        const result = await executeTool("evaluate_care_gaps", { patient });
        if (result.success) {
          executionContext.careGaps = result.data as unknown[];
          storeToolResult(sessionId, "evaluate_care_gaps", result.data);
          const gaps = result.data as Array<{ status?: string }>;
          const unmetGaps = gaps.filter((g) => g.status === "unmet");
          addReasoningStep(sessionId, `Evaluated care gaps: ${unmetGaps.length} unmet guidelines`);
        }
        return result.data;
      }
    ),

    createReActTool(
      "estimate_costs",
      "Estimate out-of-pocket medication costs using CMS pricing data. Helps identify financial barriers to medication adherence.",
      {
        type: "object",
        properties: {
          medications: {
            type: "array",
            description: "List of medication objects (optional - uses patient medications if not provided)",
          },
        },
        required: [],
      },
      async (args) => {
        const meds = args.medications || executionContext.patient?.medications || [];
        const result = await executeTool("estimate_costs", { medications: meds });
        if (result.success) {
          executionContext.costs = result.data as unknown[];
          storeToolResult(sessionId, "estimate_costs", result.data);
          const costs = result.data as Array<{ monthlyOOP?: number }>;
          const highCost = costs.filter((c) => (c.monthlyOOP || 0) > 50);
          addReasoningStep(sessionId, `Estimated costs: ${highCost.length} medications with high out-of-pocket costs`);
        }
        return result.data;
      }
    ),

    createReActTool(
      "retrieve_knowledge",
      "Retrieve relevant clinical knowledge from the knowledge base using TF-IDF RAG. Provides context about the patient's conditions and medications.",
      {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Optional search query. If not provided, uses patient conditions as context.",
          },
        },
        required: [],
      },
      async (args) => {
        const patient = executionContext.patient;
        const result = await executeTool("retrieve_knowledge", {
          patient,
          query: args.query,
        });
        if (result.success) {
          executionContext.knowledgeContext = result.data;
          storeToolResult(sessionId, "retrieve_knowledge", result.data);
          addReasoningStep(sessionId, "Retrieved clinical knowledge context");
        }
        return result.data;
      }
    ),

    createReActTool(
      "analyze_readiness",
      "Compute the final discharge readiness assessment. Call this ONLY after gathering patient data, drug interactions, care gaps, and costs. This tool uses an LLM to analyze all the data and produce a score.",
      {
        type: "object",
        properties: {
          includeKnowledge: {
            type: "boolean",
            description: "Whether to include knowledge base context in analysis",
          },
        },
        required: [],
      },
      async () => {
        if (!executionContext.patient) {
          return { error: "No patient data. Call fetch_patient first." };
        }
        if (!executionContext.drugInteractions) {
          return { error: "No drug interaction data. Call check_drug_interactions first." };
        }
        if (!executionContext.careGaps) {
          return { error: "No care gap data. Call evaluate_care_gaps first." };
        }

        const result = await executeTool("analyze_readiness", {
          patient: executionContext.patient,
          drugInteractions: executionContext.drugInteractions,
          careGaps: executionContext.careGaps,
          costs: executionContext.costs || [],
          knowledgeContext: executionContext.knowledgeContext,
        });

        if (result.success) {
          executionContext.analysis = result.data as DischargeAnalysis;
          storeToolResult(sessionId, "analyze_readiness", result.data);
          const analysis = result.data as DischargeAnalysis;
          addReasoningStep(sessionId, `Analysis complete: score=${analysis.score}, status=${analysis.status}`);

          // Store assessment for long-term memory
          await storeAssessment(patientId, analysis, getActiveModelId());
        }
        return result.data;
      }
    ),
  ];
}

/**
 * Convert ReAct result to AgentResponse
 */
function convertToAgentResponse(
  sessionId: string,
  patientId: string,
  reactResult: ReActResult,
  executionContext: ExecutionContext,
  state: AgentState
): AgentResponse {
  // Build the execution graph from ReAct steps
  const graph: AgentGraph = { nodes: [], edges: [] };

  // Start node
  graph.nodes.push({ id: "start", type: "start", label: "Agent Started", status: "success" });

  // Add nodes for each ReAct step
  let prevNodeId = "start";
  for (const step of reactResult.steps) {
    const nodeId = `step-${step.iteration}`;

    if (step.action) {
      graph.nodes.push({
        id: nodeId,
        type: "tool",
        label: `${step.action.tool}`,
        status: step.observation?.includes("error") ? "error" : "success",
        metadata: {
          thought: step.thought,
          tool: step.action.tool,
          args: step.action.args,
        },
      });
    } else if (step.isFinal) {
      graph.nodes.push({
        id: nodeId,
        type: "end",
        label: "Final Answer",
        status: "success",
        metadata: { thought: step.thought },
      });
    }

    graph.edges.push({ from: prevNodeId, to: nodeId });
    prevNodeId = nodeId;
  }

  // Convert tool usages to ToolCall format
  const toolsUsed: ToolCall[] = reactResult.steps
    .filter((s) => s.action)
    .map((s, i) => ({
      id: `call-${i}`,
      tool: s.action!.tool as ToolCall["tool"],
      input: s.action!.args,
      output: s.observation ? JSON.parse(s.observation) : null,
      success: !s.observation?.includes("error"),
      timestamp: s.timestamp,
    }));

  // Build response
  const analysis = executionContext.analysis;

  if (analysis) {
    return {
      sessionId,
      message: reactResult.answer,
      analysis: {
        score: analysis.score,
        status: analysis.status,
        riskFactors: analysis.riskFactors,
        recommendations: analysis.recommendations,
        modelUsed: analysis.modelUsed,
      },
      agentGraph: graph,
      toolsUsed,
      requiresInput: false,
      suggestedActions:
        analysis.status !== "ready"
          ? ["Generate discharge plan", "Review risk factors", "Run another assessment"]
          : ["Generate discharge plan", "Complete discharge"],
      reactTrace: {
        iterations: reactResult.iterations,
        reasoningTrace: reactResult.reasoningTrace,
        metadata: reactResult.metadata,
      },
    };
  }

  return {
    sessionId,
    message: reactResult.answer,
    agentGraph: graph,
    toolsUsed,
    requiresInput: false,
    reactTrace: {
      iterations: reactResult.iterations,
      reasoningTrace: reactResult.reasoningTrace,
      metadata: reactResult.metadata,
    },
  };
}

/**
 * Main agent execution entry point
 */
export async function runAgent(
  input: { patientId?: string; message?: string; sessionId?: string }
): Promise<AgentResponse> {
  // Get or create session
  let state: AgentState;
  if (input.sessionId && sessions.has(input.sessionId)) {
    state = sessions.get(input.sessionId)!;
  } else {
    const goal = input.patientId
      ? `Assess discharge readiness for patient ${input.patientId}`
      : "Help with discharge readiness assessment";
    state = createSession(goal);
  }

  // Add user message to conversation history
  if (input.message) {
    state.context.conversationHistory.push({
      role: "user",
      content: input.message,
      timestamp: new Date().toISOString(),
    });

    addConversationTurn(state.sessionId, {
      role: "user",
      content: input.message,
    });
  }

  if (input.patientId) {
    state.patientId = input.patientId;

    // Check for patient history in long-term memory
    const patientContext = getAssessmentContext(input.patientId);
    if (patientContext.previousAssessments.length > 0) {
      addReasoningStep(
        state.sessionId,
        `Found ${patientContext.previousAssessments.length} previous assessments. Score trend: ${patientContext.scoreTrend}`
      );
    }
  }

  // If no patient ID, request one
  if (!input.patientId) {
    return {
      sessionId: state.sessionId,
      message: "I need a patient ID to assess discharge readiness. Please provide a patient ID.",
      agentGraph: { nodes: [], edges: [] },
      toolsUsed: [],
      requiresInput: true,
      suggestedActions: ["Provide patient ID", "Select demo patient"],
    };
  }

  // Run the ReAct agent loop with tracing
  return await traceAgentExecution(
    state.sessionId,
    input.patientId,
    async () => {
      // Create execution context to accumulate data across tool calls
      const executionContext: ExecutionContext = {};

      // Create tools with access to execution context
      const tools = createAssessmentTools(state.sessionId, input.patientId!, executionContext);

      // Build the user message for the ReAct loop
      const userMessage = input.message || `Please assess discharge readiness for patient ${input.patientId}`;

      // Run the ReAct loop - the LLM decides what to do
      const reactResult = await runReActLoop(userMessage, {
        systemPrompt: buildAssessmentSystemPrompt(input.patientId!),
        tools,
        maxIterations: 15, // Allow enough iterations for full assessment
        threadId: state.sessionId,
        metadata: {
          patientId: input.patientId,
          sessionId: state.sessionId,
        },
      });

      // Convert to AgentResponse format
      const response = convertToAgentResponse(
        state.sessionId,
        input.patientId!,
        reactResult,
        executionContext,
        state
      );

      // Update state
      state.context.analysis = executionContext.analysis
        ? {
            score: executionContext.analysis.score,
            status: executionContext.analysis.status,
            riskFactorCount: executionContext.analysis.riskFactors.length,
            highRiskCount: executionContext.analysis.riskFactors.filter((r) => r.severity === "high").length,
          }
        : undefined;

      if (executionContext.patient) {
        state.context.patient = {
          id: executionContext.patient.id,
          name: executionContext.patient.name,
          age: executionContext.patient.age,
          gender: executionContext.patient.gender,
          medicationCount: executionContext.patient.medications.length,
          conditionCount: executionContext.patient.diagnoses.length,
        };
      }

      // Add assistant message to history
      state.context.conversationHistory.push({
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
        toolCalls: response.toolsUsed,
      });

      addConversationTurn(state.sessionId, {
        role: "assistant",
        content: response.message,
        metadata: {
          toolCalls: response.toolsUsed.map((tc) => ({ tool: tc.tool, success: tc.success ?? false })),
          analysisScore: executionContext.analysis?.score,
          model: getActiveModelId(),
          reactIterations: reactResult.iterations,
        },
      });

      state.status = "completed";
      state.updatedAt = new Date().toISOString();

      return response;
    },
    { threadId: state.sessionId }
  );
}

/**
 * Continue a conversation with follow-up using ReAct
 */
export async function continueConversation(
  sessionId: string,
  message: string
): Promise<AgentResponse> {
  const state = getSession(sessionId);
  if (!state) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Add the new message
  state.context.conversationHistory.push({
    role: "user",
    content: message,
    timestamp: new Date().toISOString(),
  });

  addConversationTurn(sessionId, {
    role: "user",
    content: message,
  });

  // Check if asking for different patient
  const patientMatch = message.match(/patient\s+(\S+)/i);
  if (patientMatch) {
    return runAgent({ patientId: patientMatch[1], sessionId });
  }

  // For follow-up requests, use a simplified ReAct loop
  const executionContext: ExecutionContext = {
    patient: state.context.patient as unknown as Patient,
    analysis: state.context.analysis as unknown as DischargeAnalysis,
  };

  // Create follow-up tools
  const followUpTools: ReActTool[] = [
    createReActTool(
      "generate_discharge_plan",
      "Generate a detailed discharge planning checklist based on the assessment. Only available if an assessment has been completed.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        if (!state.context.analysis || !state.context.patient) {
          return { error: "No assessment available. Please run an assessment first." };
        }
        const result = await executeTool("generate_plan", {
          analysis: state.context.analysis,
          patient: state.context.patient,
        });
        return result.data;
      }
    ),
    createReActTool(
      "explain_risk_factor",
      "Explain a specific risk factor from the assessment in more detail.",
      {
        type: "object",
        properties: {
          riskFactor: { type: "string", description: "The risk factor to explain" },
        },
        required: ["riskFactor"],
      },
      async (args) => {
        const analysis = state.context.analysis;
        if (!analysis) {
          return { error: "No assessment available." };
        }
        // Find matching risk factor
        const rf = (analysis as { riskFactors?: Array<{ title: string; description: string; severity: string; resolution?: string }> }).riskFactors?.find(
          (r) => r.title.toLowerCase().includes(String(args.riskFactor).toLowerCase())
        );
        if (rf) {
          return {
            title: rf.title,
            description: rf.description,
            severity: rf.severity,
            resolution: rf.resolution,
          };
        }
        return { error: `Risk factor "${args.riskFactor}" not found in assessment.` };
      }
    ),
    createReActTool(
      "get_assessment_summary",
      "Get a summary of the current assessment including score, status, and key risk factors.",
      {
        type: "object",
        properties: {},
        required: [],
      },
      async () => {
        const analysis = state.context.analysis;
        const patient = state.context.patient;
        if (!analysis) {
          return { error: "No assessment available." };
        }
        return {
          patientName: patient?.name,
          score: analysis.score,
          status: analysis.status,
          riskFactorCount: analysis.riskFactorCount,
          highRiskCount: analysis.highRiskCount,
        };
      }
    ),
  ];

  const followUpSystemPrompt = `You are a clinical discharge readiness assistant continuing a conversation about patient ${state.patientId || "unknown"}.

## Current Context
${state.context.analysis ? `Assessment score: ${state.context.analysis.score}/100, Status: ${state.context.analysis.status}` : "No assessment has been completed yet."}
${state.context.patient ? `Patient: ${state.context.patient.name}` : ""}

## Your Task
Help the user with their follow-up request. You can:
- Generate a discharge plan
- Explain risk factors
- Provide assessment summaries
- Answer questions about the patient's discharge readiness

If the user wants to assess a different patient, tell them to provide a new patient ID.`;

  const reactResult = await runReActLoop(message, {
    systemPrompt: followUpSystemPrompt,
    tools: followUpTools,
    maxIterations: 5,
    threadId: sessionId,
    metadata: {
      patientId: state.patientId,
      isFollowUp: true,
    },
  });

  const toolsUsed: ToolCall[] = reactResult.steps
    .filter((s) => s.action)
    .map((s, i) => ({
      id: `call-${i}`,
      tool: s.action!.tool as ToolCall["tool"],
      input: s.action!.args,
      output: s.observation ? JSON.parse(s.observation) : null,
      success: !s.observation?.includes("error"),
      timestamp: s.timestamp,
    }));

  // Check if a plan was generated
  const planStep = reactResult.steps.find((s) => s.action?.tool === "generate_discharge_plan" && s.observation);
  const plan = planStep?.observation ? JSON.parse(planStep.observation) : undefined;

  const response: AgentResponse = {
    sessionId,
    message: reactResult.answer,
    plan: plan || undefined,
    agentGraph: { nodes: [], edges: [] },
    toolsUsed,
    requiresInput: false,
    suggestedActions: ["Generate discharge plan", "Assess another patient", "Explain risk factors"],
    reactTrace: {
      iterations: reactResult.iterations,
      reasoningTrace: reactResult.reasoningTrace,
      metadata: reactResult.metadata,
    },
  };

  state.context.conversationHistory.push({
    role: "assistant",
    content: response.message,
    timestamp: new Date().toISOString(),
    toolCalls: toolsUsed,
  });

  addConversationTurn(sessionId, {
    role: "assistant",
    content: response.message,
    metadata: {
      toolCalls: toolsUsed.map((tc) => ({ tool: tc.tool, success: tc.success ?? false })),
      reactIterations: reactResult.iterations,
    },
  });

  return response;
}

/**
 * Streaming agent stream event type
 */
export type AgentStreamEvent =
  | ReActStreamEvent
  | { type: "analysis"; analysis: DischargeAnalysis };

/**
 * Streaming version of runAgent - yields events as the agent reasons
 *
 * This allows the UI to show thinking steps in real-time while the agent
 * gathers information and computes the assessment.
 */
export async function* runAgentStreaming(
  input: { patientId?: string; message?: string; sessionId?: string }
): AsyncGenerator<AgentStreamEvent, AgentResponse, unknown> {
  // Get or create session
  let state: AgentState;
  if (input.sessionId && sessions.has(input.sessionId)) {
    state = sessions.get(input.sessionId)!;
  } else {
    const goal = input.patientId
      ? `Assess discharge readiness for patient ${input.patientId}`
      : "Help with discharge readiness assessment";
    state = createSession(goal);
  }

  // Add user message to conversation history
  if (input.message) {
    state.context.conversationHistory.push({
      role: "user",
      content: input.message,
      timestamp: new Date().toISOString(),
    });

    addConversationTurn(state.sessionId, {
      role: "user",
      content: input.message,
    });
  }

  if (input.patientId) {
    state.patientId = input.patientId;

    // Check for patient history in long-term memory
    const patientContext = getAssessmentContext(input.patientId);
    if (patientContext.previousAssessments.length > 0) {
      addReasoningStep(
        state.sessionId,
        `Found ${patientContext.previousAssessments.length} previous assessments. Score trend: ${patientContext.scoreTrend}`
      );
    }
  }

  // If no patient ID, return early with request
  if (!input.patientId) {
    return {
      sessionId: state.sessionId,
      message: "I need a patient ID to assess discharge readiness. Please provide a patient ID.",
      agentGraph: { nodes: [], edges: [] },
      toolsUsed: [],
      requiresInput: true,
      suggestedActions: ["Provide patient ID", "Select demo patient"],
    };
  }

  // Create execution context to accumulate data across tool calls
  const executionContext: ExecutionContext = {};

  // Create tools with access to execution context
  const tools = createAssessmentTools(state.sessionId, input.patientId, executionContext);

  // Build the user message for the ReAct loop
  const userMessage = input.message || `Please assess discharge readiness for patient ${input.patientId}`;

  // Run the streaming ReAct loop
  const generator = runReActLoopStreaming(userMessage, {
    systemPrompt: buildAssessmentSystemPrompt(input.patientId),
    tools,
    maxIterations: 15,
    threadId: state.sessionId,
    metadata: {
      patientId: input.patientId,
      sessionId: state.sessionId,
    },
  });

  let reactResult: ReActResult | undefined;

  // Forward all events from the ReAct loop
  for await (const event of generator) {
    // Yield the event to the caller
    yield event;

    // Capture the final result
    if (event.type === "final") {
      reactResult = event.result;

      // If we captured an analysis in execution context, yield it
      if (executionContext.analysis) {
        yield { type: "analysis", analysis: executionContext.analysis };
      }
    }
  }

  // If we didn't get a result, create a default error response
  if (!reactResult) {
    return {
      sessionId: state.sessionId,
      message: "Analysis failed to complete",
      agentGraph: { nodes: [], edges: [] },
      toolsUsed: [],
      requiresInput: false,
    };
  }

  // Convert to AgentResponse format
  const response = convertToAgentResponse(
    state.sessionId,
    input.patientId,
    reactResult,
    executionContext,
    state
  );

  // Update state
  state.context.analysis = executionContext.analysis
    ? {
        score: executionContext.analysis.score,
        status: executionContext.analysis.status,
        riskFactorCount: executionContext.analysis.riskFactors.length,
        highRiskCount: executionContext.analysis.riskFactors.filter((r) => r.severity === "high").length,
      }
    : undefined;

  if (executionContext.patient) {
    state.context.patient = {
      id: executionContext.patient.id,
      name: executionContext.patient.name,
      age: executionContext.patient.age,
      gender: executionContext.patient.gender,
      medicationCount: executionContext.patient.medications.length,
      conditionCount: executionContext.patient.diagnoses.length,
    };
  }

  // Add assistant message to history
  state.context.conversationHistory.push({
    role: "assistant",
    content: response.message,
    timestamp: new Date().toISOString(),
    toolCalls: response.toolsUsed,
  });

  addConversationTurn(state.sessionId, {
    role: "assistant",
    content: response.message,
    metadata: {
      toolCalls: response.toolsUsed.map((tc) => ({ tool: tc.tool, success: tc.success ?? false })),
      analysisScore: executionContext.analysis?.score,
      model: getActiveModelId(),
      reactIterations: reactResult.iterations,
    },
  });

  state.status = "completed";
  state.updatedAt = new Date().toISOString();

  return response;
}
