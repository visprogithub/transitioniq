/**
 * Agent Types for TransitionIQ Discharge Readiness Assessment
 */

export type ToolName =
  | "fetch_patient"
  | "check_drug_interactions"
  | "check_boxed_warnings"
  | "check_drug_recalls"
  | "get_comprehensive_drug_safety"
  | "evaluate_care_gaps"
  | "estimate_costs"
  | "retrieve_knowledge"
  | "analyze_readiness"
  | "generate_plan"
  // ReAct follow-up tools
  | "generate_discharge_plan"
  | "explain_risk_factor"
  | "get_assessment_summary"
  // Allow dynamic tool names from ReAct agents
  | string;

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

export interface BoxedWarningContext {
  drug: string;
  warning: string;
}

export interface DrugRecallContext {
  drugName: string;
  recallNumber: string;
  reason: string;
  classification: string; // Class I, II, or III
  status: string;
  recallDate: string;
}

export interface ComprehensiveDrugSafetyContext {
  drugName: string;
  faersReportCount: number;
  hasBoxedWarning: boolean;
  boxedWarningSummary?: string;
  recentRecalls: DrugRecallContext[];
  topAdverseReactions: string[];
  riskLevel: "high" | "moderate" | "low";
}

export interface CareGapContext {
  guideline: string;
  status: "met" | "unmet" | "not_applicable";
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
    modelUsed?: string;
  };
  plan?: string;
  agentGraph: AgentGraph;
  toolsUsed: ToolCall[];
  requiresInput: boolean;
  suggestedActions?: string[];
  /** ReAct agent trace - shows the Thought→Action→Observation reasoning loop */
  reactTrace?: {
    iterations: number;
    reasoningTrace: string;
    metadata: {
      model: string;
      startTime: string;
      endTime: string;
      totalLatencyMs: number;
    };
  };
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
