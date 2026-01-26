/**
 * Agent Types for TransitionIQ Discharge Readiness Assessment
 */

export type ToolName = "fetch_patient" | "check_drug_interactions" | "evaluate_care_gaps" | "estimate_costs" | "analyze_readiness" | "generate_plan";

export interface ToolCall {
  id: string;
  tool: ToolName;
  input: Record<string, unknown>;
  output?: unknown;
  success?: boolean;
  error?: string;
  duration?: number;
  timestamp: string;
}

export interface AgentStep {
  id: string;
  type: "plan" | "tool_call" | "reasoning" | "response";
  content: string;
  toolCall?: ToolCall;
  timestamp: string;
}

export interface AgentState {
  sessionId: string;
  patientId?: string;
  currentGoal: string;
  steps: AgentStep[];
  context: AgentContext;
  status: "planning" | "executing" | "waiting_input" | "completed" | "error";
  createdAt: string;
  updatedAt: string;
}

export interface AgentContext {
  patient?: PatientContext;
  drugInteractions?: DrugInteractionContext[];
  careGaps?: CareGapContext[];
  costEstimates?: CostContext[];
  analysis?: AnalysisContext;
  conversationHistory: ConversationMessage[];
}

export interface PatientContext {
  id: string;
  name: string;
  age: number;
  gender: string;
  medicationCount: number;
  conditionCount: number;
}

export interface DrugInteractionContext {
  drug1: string;
  drug2: string;
  severity: "major" | "moderate" | "minor";
  description: string;
}

export interface CareGapContext {
  guideline: string;
  status: "met" | "unmet";
  grade: string;
}

export interface CostContext {
  medication: string;
  monthlyOOP: number;
  covered: boolean;
}

export interface AnalysisContext {
  score: number;
  status: "ready" | "caution" | "not_ready";
  riskFactorCount: number;
  highRiskCount: number;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
}

export interface AgentPlan {
  goal: string;
  steps: PlannedStep[];
  reasoning: string;
}

export interface PlannedStep {
  order: number;
  tool: ToolName;
  description: string;
  dependsOn: number[];
  required: boolean;
}

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

export interface AgentResponse {
  sessionId: string;
  message: string;
  analysis?: {
    score: number;
    status: string;
    riskFactors: unknown[];
    recommendations: string[];
  };
  plan?: string;
  agentGraph: AgentGraph;
  toolsUsed: ToolCall[];
  requiresInput: boolean;
  suggestedActions?: string[];
}

export interface AgentGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphNode {
  id: string;
  type: "start" | "plan" | "tool" | "decision" | "llm" | "end";
  label: string;
  status: "pending" | "running" | "success" | "error" | "skipped";
  duration?: number;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
  condition?: string;
}
