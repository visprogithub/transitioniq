/**
 * Agent Tracing - Enhanced Opik integration for agent observability
 *
 * Provides:
 * - Agent execution graphs
 * - Tool call tracing with correctness evaluation
 * - Multi-turn conversation tracking
 */

import { Opik } from "opik";
import type { ToolName, AgentGraph, ToolResult } from "./types";

let opikClient: Opik | null = null;

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
 * Trace an entire agent execution as a top-level trace
 */
export async function traceAgentExecution<T>(
  sessionId: string,
  patientId: string,
  fn: () => Promise<T>
): Promise<T> {
  const opik = getOpikClient();
  const startTime = Date.now();

  if (!opik) {
    return fn();
  }

  const trace = opik.trace({
    name: "agent-execution",
    metadata: {
      sessionId,
      patientId,
      agent_type: "discharge-readiness",
      category: "agent",
    },
  });

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    // Extract agent graph if present
    const resultObj = result as Record<string, unknown>;
    const agentGraph = resultObj?.agentGraph as AgentGraph | undefined;
    const toolsUsed = resultObj?.toolsUsed as unknown[] | undefined;

    // Log result via a span
    const resultSpan = trace.span({
      name: "agent-result",
      metadata: {
        duration_ms: duration,
        success: true,
        tools_count: toolsUsed?.length || 0,
        graph_node_count: agentGraph?.nodes?.length || 0,
      },
    });
    resultSpan.end();

    trace.end();
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const duration = Date.now() - startTime;

    const errorSpan = trace.span({
      name: "agent-error",
      metadata: {
        duration_ms: duration,
        success: false,
        error: errorMessage,
      },
    });
    errorSpan.end();

    trace.end();
    throw error;
  }
}

/**
 * Trace individual tool calls within the agent
 */
export async function traceToolCall<T>(
  toolName: ToolName,
  sessionId: string,
  fn: () => Promise<ToolResult<T>>
): Promise<ToolResult<T>> {
  const opik = getOpikClient();
  const startTime = Date.now();

  if (!opik) {
    return fn();
  }

  const trace = opik.trace({
    name: `tool-${toolName}`,
    metadata: {
      sessionId,
      tool: toolName,
      category: "tool_call",
    },
  });

  const span = trace.span({
    name: `${toolName}-execution`,
    metadata: {
      tool: toolName,
    },
  });

  try {
    const result = await fn();
    const duration = Date.now() - startTime;

    // Update span metadata before ending
    span.update({
      metadata: {
        duration_ms: duration,
        success: result.success,
        error: result.error,
      },
    });
    span.end();
    trace.end();
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const duration = Date.now() - startTime;

    span.update({
      metadata: {
        duration_ms: duration,
        success: false,
        error: errorMessage,
      },
    });
    span.end();
    trace.end();
    throw error;
  }
}

/**
 * Log tool correctness evaluation to Opik
 */
export async function logToolCorrectness(
  toolName: ToolName,
  sessionId: string,
  isCorrect: boolean,
  reason: string
): Promise<void> {
  const opik = getOpikClient();
  if (!opik) {
    console.log(`[Tool Correctness] ${toolName}: ${isCorrect ? "PASS" : "FAIL"} - ${reason}`);
    return;
  }

  const trace = opik.trace({
    name: `evaluation-tool-correctness`,
    metadata: {
      sessionId,
      tool: toolName,
      category: "evaluation",
      evaluation_type: "tool_correctness",
      is_correct: isCorrect,
      reason,
    },
  });

  const span = trace.span({
    name: `${toolName}-correctness`,
    metadata: {
      tool: toolName,
      is_correct: isCorrect,
      evaluation_passed: isCorrect,
      reason,
    },
  });
  span.end();
  trace.end();
}

/**
 * Log agent trajectory (sequence of decisions and actions)
 */
export async function logAgentTrajectory(
  sessionId: string,
  patientId: string,
  trajectory: Array<{
    step: number;
    action: string;
    tool?: ToolName;
    reasoning: string;
    success: boolean;
  }>
): Promise<void> {
  const opik = getOpikClient();
  if (!opik) {
    console.log(`[Agent Trajectory] Session ${sessionId}: ${trajectory.length} steps`);
    return;
  }

  const successRate = trajectory.length > 0
    ? trajectory.filter((s) => s.success).length / trajectory.length
    : 0;
  const optimalSteps = 5;
  const efficiency = Math.min(1, optimalSteps / Math.max(1, trajectory.length));

  const trace = opik.trace({
    name: "evaluation-agent-trajectory",
    metadata: {
      sessionId,
      patientId,
      category: "evaluation",
      evaluation_type: "agent_trajectory",
      total_steps: trajectory.length,
      success_rate: successRate,
      efficiency_score: efficiency,
      trajectory_quality: successRate >= 0.8 && efficiency >= 0.8 ? "good" : "needs_improvement",
    },
  });

  // Create a span for each step
  for (const step of trajectory) {
    const span = trace.span({
      name: `step-${step.step}`,
      metadata: {
        step_number: step.step,
        action: step.action,
        tool: step.tool,
        success: step.success,
        reasoning: step.reasoning,
      },
    });
    span.end();
  }

  trace.end();
}

/**
 * Log multi-turn conversation metrics
 */
export async function logConversationMetrics(
  sessionId: string,
  turnCount: number,
  toolCallsTotal: number,
  taskCompleted: boolean
): Promise<void> {
  const opik = getOpikClient();
  if (!opik) {
    console.log(`[Conversation] Session ${sessionId}: ${turnCount} turns, ${toolCallsTotal} tool calls`);
    return;
  }

  const trace = opik.trace({
    name: "evaluation-conversation",
    metadata: {
      sessionId,
      category: "evaluation",
      evaluation_type: "multi_turn_conversation",
      turn_count: turnCount,
      tool_calls_total: toolCallsTotal,
      task_completed: taskCompleted,
      turns_per_completion: taskCompleted ? turnCount : -1,
      efficiency: taskCompleted ? Math.max(0, 1 - (turnCount - 1) * 0.1) : 0,
    },
  });

  const span = trace.span({
    name: "conversation-metrics",
    metadata: {
      turn_count: turnCount,
      tool_calls_total: toolCallsTotal,
      task_completed: taskCompleted,
    },
  });
  span.end();
  trace.end();
}

/**
 * Log the agent graph structure for visualization in Opik
 */
export async function logAgentGraph(
  sessionId: string,
  graph: AgentGraph
): Promise<void> {
  const opik = getOpikClient();
  if (!opik) {
    console.log(`[Agent Graph] Session ${sessionId}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    return;
  }

  const trace = opik.trace({
    name: "agent-graph",
    metadata: {
      sessionId,
      category: "agent_graph",
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      successful_nodes: graph.nodes.filter((n) => n.status === "success").length,
      failed_nodes: graph.nodes.filter((n) => n.status === "error").length,
    },
  });

  // Create spans for each node
  for (const node of graph.nodes) {
    const span = trace.span({
      name: node.label,
      metadata: {
        node_id: node.id,
        node_type: node.type,
        status: node.status,
        duration_ms: node.duration,
        success: node.status === "success",
        ...node.metadata,
      },
    });
    span.end();
  }

  trace.end();
}

/**
 * Create a task completion evaluator
 */
export async function evaluateTaskCompletion(
  sessionId: string,
  patientId: string,
  expectedOutcome: {
    hasScore: boolean;
    hasStatus: boolean;
    hasRiskFactors: boolean;
    hasRecommendations: boolean;
  },
  actualOutcome: {
    hasScore: boolean;
    hasStatus: boolean;
    hasRiskFactors: boolean;
    hasRecommendations: boolean;
  }
): Promise<{ passed: boolean; score: number }> {
  const opik = getOpikClient();

  const checks = [
    { name: "has_score", expected: expectedOutcome.hasScore, actual: actualOutcome.hasScore },
    { name: "has_status", expected: expectedOutcome.hasStatus, actual: actualOutcome.hasStatus },
    { name: "has_risk_factors", expected: expectedOutcome.hasRiskFactors, actual: actualOutcome.hasRiskFactors },
    { name: "has_recommendations", expected: expectedOutcome.hasRecommendations, actual: actualOutcome.hasRecommendations },
  ];

  const passedChecks = checks.filter((c) => c.expected === c.actual).length;
  const score = passedChecks / checks.length;
  const passed = score >= 0.75;

  if (!opik) {
    console.log(`[Task Completion] Session ${sessionId}: ${passed ? "PASS" : "FAIL"} (${score * 100}%)`);
    return { passed, score };
  }

  const trace = opik.trace({
    name: "evaluation-task-completion",
    metadata: {
      sessionId,
      patientId,
      category: "evaluation",
      evaluation_type: "task_completion",
      evaluation_passed: passed,
      score,
      checks_passed: passedChecks,
      checks_total: checks.length,
    },
  });

  for (const check of checks) {
    const span = trace.span({
      name: `check-${check.name}`,
      metadata: {
        check_name: check.name,
        expected: check.expected,
        actual: check.actual,
        passed: check.expected === check.actual,
      },
    });
    span.end();
  }

  trace.end();

  return { passed, score };
}
