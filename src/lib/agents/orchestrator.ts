/**
 * Agent Orchestrator - Plans and executes discharge readiness assessment
 *
 * Implements a ReAct-style agent loop:
 * 1. Plan: Determine which tools to call based on the goal
 * 2. Execute: Run tools in sequence, tracking results
 * 3. Reason: Analyze results and decide next steps
 * 4. Respond: Generate final response or request more input
 */

import { v4 as uuidv4 } from "uuid";
import { executeTool } from "./tools";
import { traceAgentExecution, traceToolCall, logToolCorrectness } from "./tracing";
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
  AgentPlan,
  PlannedStep,
  ToolCall,
  AgentResponse,
  AgentGraph,
  GraphNode,
  DrugInteractionContext,
  CareGapContext,
  CostContext,
  ToolName,
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

    // Also add to memory system
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

  // Run the agent loop with tracing
  return await traceAgentExecution(state.sessionId, state.patientId || "unknown", async () => {
    return await agentLoop(state);
  }, { threadId: state.sessionId });
}

/**
 * The main agent loop - implements ReAct pattern
 */
async function agentLoop(state: AgentState): Promise<AgentResponse> {
  const graph: AgentGraph = { nodes: [], edges: [] };
  const toolsUsed: ToolCall[] = [];

  // Start node
  addGraphNode(graph, "start", "start", "Agent Started", "success");

  try {
    // Phase 1: Planning
    state.status = "planning";
    const planStep = addStep(state, "plan", "Analyzing request and planning execution...");
    addGraphNode(graph, "plan", "plan", "Plan Execution", "running");

    const plan = await createPlan(state);
    planStep.content = `Plan: ${plan.reasoning}`;
    updateGraphNode(graph, "plan", "success");
    addGraphEdge(graph, "start", "plan");

    // Phase 2: Tool Execution — dependency-aware with parallel batches
    // Steps whose dependencies are all satisfied run concurrently via
    // Promise.allSettled, giving ~2-3× speedup for the typical 6-step plan
    // (steps 2-5 fan out in parallel after step 1).
    state.status = "executing";
    let patient: Patient | undefined;
    let drugInteractions: unknown[] = [];
    let careGaps: unknown[] = [];
    let costs: unknown[] = [];
    let knowledgeContext: unknown = undefined;
    let analysis: DischargeAnalysis | undefined;

    const completedOrders = new Set<number>();

    // Group steps into batches where each batch's dependencies are already done
    while (completedOrders.size < plan.steps.length) {
      // Find all steps whose dependencies are satisfied and haven't run yet
      const batch = plan.steps.filter(
        (s) =>
          !completedOrders.has(s.order) &&
          s.dependsOn.every((dep) => completedOrders.has(dep))
      );

      if (batch.length === 0) {
        // Safety: avoid infinite loop if deps can never be satisfied
        throw new Error("Dependency deadlock: no runnable steps remaining");
      }

      // Set up graph nodes + edges for every step in this batch
      for (const plannedStep of batch) {
        const nodeId = `tool-${plannedStep.order}`;
        addGraphNode(graph, nodeId, "tool", plannedStep.description, "running", {
          tool: plannedStep.tool,
        });

        if (plannedStep.dependsOn.length === 0) {
          addGraphEdge(graph, "plan", nodeId);
        } else {
          for (const dep of plannedStep.dependsOn) {
            addGraphEdge(graph, `tool-${dep}`, nodeId);
          }
        }
      }

      // Execute the entire batch concurrently
      const batchPromises = batch.map(async (plannedStep) => {
        const input = buildToolInput(plannedStep.tool, {
          patientId: state.patientId,
          patient,
          drugInteractions,
          careGaps,
          costs,
          knowledgeContext,
          analysis,
        });

        const toolCall = await executeTracedTool(plannedStep.tool, input, state.sessionId);
        return { plannedStep, toolCall, input };
      });

      const batchResults = await Promise.allSettled(batchPromises);

      // Process results in order so context updates are deterministic
      for (const result of batchResults) {
        if (result.status === "rejected") {
          throw new Error(`Tool execution failed: ${result.reason}`);
        }

        const { plannedStep, toolCall, input } = result.value;
        const nodeId = `tool-${plannedStep.order}`;
        toolsUsed.push(toolCall);
        addStep(state, "tool_call", `Executed ${plannedStep.tool}`, toolCall);

        if (toolCall.success) {
          updateGraphNode(graph, nodeId, "success", toolCall.duration);
          storeToolResult(state.sessionId, plannedStep.tool, toolCall.output);
          addReasoningStep(state.sessionId, `Tool ${plannedStep.tool} completed successfully`);

          // Update context with tool results
          switch (plannedStep.tool) {
            case "fetch_patient":
              const patientResult = toolCall.output as { raw: Patient };
              patient = patientResult.raw;
              state.context.patient = {
                id: patient.id,
                name: patient.name,
                age: patient.age,
                gender: patient.gender,
                medicationCount: patient.medications.length,
                conditionCount: patient.diagnoses.length,
              };
              setPatientContext(state.sessionId, patient);
              break;
            case "check_drug_interactions":
              drugInteractions = toolCall.output as unknown[];
              state.context.drugInteractions = drugInteractions as DrugInteractionContext[];
              break;
            case "evaluate_care_gaps":
              careGaps = toolCall.output as unknown[];
              state.context.careGaps = careGaps as CareGapContext[];
              break;
            case "estimate_costs":
              costs = toolCall.output as unknown[];
              state.context.costEstimates = costs as CostContext[];
              break;
            case "retrieve_knowledge":
              knowledgeContext = toolCall.output;
              break;
            case "analyze_readiness":
              analysis = toolCall.output as DischargeAnalysis;
              state.context.analysis = {
                score: analysis.score,
                status: analysis.status,
                riskFactorCount: analysis.riskFactors.length,
                highRiskCount: analysis.riskFactors.filter((r) => r.severity === "high").length,
              };

              if (state.patientId) {
                await storeAssessment(
                  state.patientId,
                  analysis,
                  getActiveModelId()
                );
                addReasoningStep(
                  state.sessionId,
                  `Assessment stored: score=${analysis.score}, status=${analysis.status}`
                );
              }
              break;
          }

          // Evaluate tool correctness (fire-and-forget for parallel steps)
          evaluateToolCorrectness(plannedStep.tool, input, toolCall.output, state.sessionId);
        } else {
          updateGraphNode(graph, nodeId, "error", toolCall.duration);
          addStep(state, "reasoning", `Tool ${plannedStep.tool} failed: ${toolCall.error}`);

          if (plannedStep.required) {
            throw new Error(`Required tool ${plannedStep.tool} failed: ${toolCall.error}`);
          }
        }

        completedOrders.add(plannedStep.order);
      }
    }

    // Phase 3: Response Generation
    const lastOrder = Math.max(...plan.steps.map((s) => s.order));
    addGraphNode(graph, "respond", "end", "Generate Response", "running");
    addGraphEdge(graph, `tool-${lastOrder}`, "respond");

    const response = generateResponse(state, analysis, graph, toolsUsed);
    updateGraphNode(graph, "respond", "success");

    // Add assistant message to history
    state.context.conversationHistory.push({
      role: "assistant",
      content: response.message,
      timestamp: new Date().toISOString(),
      toolCalls: toolsUsed,
    });

    // Also add to memory system with metadata
    addConversationTurn(state.sessionId, {
      role: "assistant",
      content: response.message,
      metadata: {
        toolCalls: toolsUsed.map((tc) => ({ tool: tc.tool, success: tc.success ?? false })),
        analysisScore: analysis?.score,
        model: getActiveModelId(),
      },
    });

    state.status = "completed";
    state.updatedAt = new Date().toISOString();

    return response;
  } catch (error) {
    state.status = "error";
    addStep(state, "reasoning", `Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    addGraphNode(graph, "error", "end", "Error", "error");

    return {
      sessionId: state.sessionId,
      message: `I encountered an error while assessing discharge readiness: ${error instanceof Error ? error.message : "Unknown error"}`,
      agentGraph: graph,
      toolsUsed,
      requiresInput: false,
    };
  }
}

/**
 * Create an execution plan based on the current goal and context
 */
async function createPlan(state: AgentState): Promise<AgentPlan> {
  const steps: PlannedStep[] = [];

  // If we have a patient ID, plan the full assessment workflow
  if (state.patientId) {
    steps.push({
      order: 1,
      tool: "fetch_patient",
      description: "Fetch patient data (FHIR-structured synthetic data)",
      dependsOn: [],
      required: true,
    });

    steps.push({
      order: 2,
      tool: "check_drug_interactions",
      description: "Check drug interactions via FDA",
      dependsOn: [1],
      required: true,
    });

    steps.push({
      order: 3,
      tool: "evaluate_care_gaps",
      description: "Evaluate clinical guideline compliance",
      dependsOn: [1],
      required: true,
    });

    steps.push({
      order: 4,
      tool: "estimate_costs",
      description: "Estimate medication costs via CMS",
      dependsOn: [1],
      required: false,
    });

    steps.push({
      order: 5,
      tool: "retrieve_knowledge",
      description: "Retrieve relevant clinical knowledge via TF-IDF RAG",
      dependsOn: [1],
      required: false,
    });

    steps.push({
      order: 6,
      tool: "analyze_readiness",
      description: "Compute discharge readiness score",
      dependsOn: [2, 3, 4, 5],
      required: true,
    });

    return {
      goal: state.currentGoal,
      steps,
      reasoning: `Will assess patient ${state.patientId} by: 1) Fetching patient data, 2) Checking FDA drug interactions, 3) Evaluating care gaps, 4) Estimating costs, 5) Retrieving clinical knowledge via RAG, 6) Computing readiness score`,
    };
  }

  // If no patient ID, we need more input
  return {
    goal: state.currentGoal,
    steps: [],
    reasoning: "Need patient ID to proceed with assessment",
  };
}

/**
 * Build input for a tool based on accumulated context
 */
function buildToolInput(
  tool: ToolName,
  context: {
    patientId?: string;
    patient?: Patient;
    drugInteractions?: unknown[];
    careGaps?: unknown[];
    costs?: unknown[];
    knowledgeContext?: unknown;
    analysis?: DischargeAnalysis;
  }
): Record<string, unknown> {
  switch (tool) {
    case "fetch_patient":
      return { patientId: context.patientId };
    case "check_drug_interactions":
      return { medications: context.patient?.medications || [] };
    case "evaluate_care_gaps":
      return { patient: context.patient };
    case "estimate_costs":
      return { medications: context.patient?.medications || [] };
    case "retrieve_knowledge":
      return { patient: context.patient };
    case "analyze_readiness":
      return {
        patient: context.patient,
        drugInteractions: context.drugInteractions,
        careGaps: context.careGaps,
        costs: context.costs,
        knowledgeContext: context.knowledgeContext,
      };
    case "generate_plan":
      return {
        analysis: context.analysis,
        patient: context.patient,
      };
    default:
      return {};
  }
}

/**
 * Execute a tool with tracing
 */
async function executeTracedTool(
  tool: ToolName,
  input: Record<string, unknown>,
  sessionId: string
): Promise<ToolCall> {
  const callId = uuidv4();

  const result = await traceToolCall(tool, sessionId, async () => {
    return await executeTool(tool, input);
  }, { threadId: sessionId });

  return {
    id: callId,
    tool,
    input,
    output: result.data,
    success: result.success,
    error: result.error,
    duration: result.duration,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Evaluate tool correctness and log to Opik
 */
async function evaluateToolCorrectness(
  tool: ToolName,
  input: Record<string, unknown>,
  output: unknown,
  sessionId: string
): Promise<void> {
  let isCorrect = true;
  let reason = "Tool executed successfully";

  // Tool-specific correctness checks
  switch (tool) {
    case "fetch_patient":
      const patientOutput = output as { id?: string };
      isCorrect = !!patientOutput?.id;
      reason = isCorrect ? "Patient data retrieved" : "No patient data returned";
      break;

    case "check_drug_interactions":
      const interactions = output as unknown[];
      // Correct if it returned an array (even empty)
      isCorrect = Array.isArray(interactions);
      reason = isCorrect ? `Found ${interactions.length} interactions` : "Invalid interaction format";
      break;

    case "evaluate_care_gaps":
      const gaps = output as unknown[];
      isCorrect = Array.isArray(gaps);
      reason = isCorrect ? `Evaluated ${gaps.length} guidelines` : "Invalid care gap format";
      break;

    case "analyze_readiness":
      const analysis = output as { score?: number; status?: string };
      isCorrect = typeof analysis?.score === "number" && !!analysis?.status;
      reason = isCorrect
        ? `Score: ${analysis.score}, Status: ${analysis.status}`
        : "Invalid analysis output";
      break;
  }

  await logToolCorrectness(tool, sessionId, isCorrect, reason);
}

/**
 * Generate the final response
 */
function generateResponse(
  state: AgentState,
  analysis: DischargeAnalysis | undefined,
  graph: AgentGraph,
  toolsUsed: ToolCall[]
): AgentResponse {
  if (!analysis) {
    return {
      sessionId: state.sessionId,
      message: "I need a patient ID to assess discharge readiness. Please provide a patient ID.",
      agentGraph: graph,
      toolsUsed,
      requiresInput: true,
      suggestedActions: ["Provide patient ID", "Select demo patient"],
    };
  }

  // Use supportive clinical language — this is decision SUPPORT, not a verdict
  const statusNarrativeMap: Record<string, string> = {
    ready: "Assessment indicates patient is on track for transition",
    caution: "Assessment identified items for review before transition",
    not_ready: "Assessment identified significant concerns requiring further review",
  };
  const statusText = statusNarrativeMap[analysis.status] || "Assessment in progress";

  const highRisks = analysis.riskFactors.filter((r) => r.severity === "high");
  const riskSummary = highRisks.length > 0
    ? ` Found ${highRisks.length} high-risk factor(s) that need attention.`
    : "";

  return {
    sessionId: state.sessionId,
    message: `Assessment complete for ${state.context.patient?.name || state.patientId}. Score: ${analysis.score}/100. ${statusText}.${riskSummary}`,
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
    suggestedActions: analysis.status !== "ready"
      ? ["Generate discharge plan", "Review risk factors", "Run another assessment"]
      : ["Generate discharge plan", "Complete discharge"],
  };
}

/**
 * Helper: Add a step to the agent state
 */
function addStep(state: AgentState, type: AgentStep["type"], content: string, toolCall?: ToolCall): AgentStep {
  const step: AgentStep = {
    id: uuidv4(),
    type,
    content,
    toolCall,
    timestamp: new Date().toISOString(),
  };
  state.steps.push(step);
  return step;
}

/**
 * Helper: Add a node to the agent graph
 */
function addGraphNode(
  graph: AgentGraph,
  id: string,
  type: GraphNode["type"],
  label: string,
  status: GraphNode["status"],
  metadata?: Record<string, unknown>
): void {
  graph.nodes.push({ id, type, label, status, metadata });
}

/**
 * Helper: Update a node's status in the graph
 */
function updateGraphNode(
  graph: AgentGraph,
  id: string,
  status: GraphNode["status"],
  duration?: number
): void {
  const node = graph.nodes.find((n) => n.id === id);
  if (node) {
    node.status = status;
    if (duration) node.duration = duration;
  }
}

/**
 * Helper: Add an edge to the agent graph
 */
function addGraphEdge(graph: AgentGraph, from: string, to: string, label?: string): void {
  graph.edges.push({ from, to, label });
}

/**
 * Continue a conversation with follow-up
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

  // Handle follow-up requests
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("generate plan") || lowerMessage.includes("discharge plan")) {
    // Generate discharge plan if we have analysis
    if (state.context.analysis && state.context.patient) {
      const toolCall = await executeTracedTool(
        "generate_plan",
        {
          analysis: state.context.analysis,
          patient: state.context.patient,
        },
        sessionId
      );

      const response: AgentResponse = {
        sessionId,
        message: "Here is the discharge planning checklist:",
        plan: toolCall.output as string,
        agentGraph: { nodes: [], edges: [] },
        toolsUsed: [toolCall],
        requiresInput: false,
      };

      state.context.conversationHistory.push({
        role: "assistant",
        content: response.message,
        timestamp: new Date().toISOString(),
        toolCalls: [toolCall],
      });

      return response;
    }
  }

  // Check if asking for different patient
  const patientMatch = message.match(/patient\s+(\S+)/i);
  if (patientMatch) {
    return runAgent({ patientId: patientMatch[1], sessionId });
  }

  // Generic follow-up response
  return {
    sessionId,
    message: "How can I help you further? You can ask me to generate a discharge plan, assess a different patient, or explain any risk factors.",
    agentGraph: { nodes: [], edges: [] },
    toolsUsed: [],
    requiresInput: true,
    suggestedActions: ["Generate discharge plan", "Assess another patient", "Explain risk factors"],
  };
}
