/**
 * Agent Client - Connects to Python agent backend
 *
 * This module provides the interface between the Next.js frontend
 * and the Python FastAPI agent backend for multi-turn analysis.
 */

export interface PatientData {
  id: string;
  name: string;
  age: number;
  gender: string;
  admissionDate: string;
  diagnoses: Array<{ code: string; display: string }>;
  medications: Array<{ name: string; dose: string; frequency: string }>;
  allergies: string[];
  recentLabs: Array<{
    name: string;
    value: string;
    unit: string;
    referenceRange: string;
    abnormal: boolean;
  }>;
  pcp_followup_scheduled?: boolean;
}

export interface AgentConversationMessage {
  role: string;
  content: string;
  timestamp: string;
  tool_name?: string;
}

export interface AgentAnalysisResponse {
  session_id: string;
  score: number;
  status: "ready" | "caution" | "not_ready";
  risk_factors: Array<{
    id: string;
    severity: "high" | "moderate" | "low";
    category: string;
    title: string;
    description: string;
    source: string;
    actionable: boolean;
    resolution?: string;
  }>;
  recommendations: string[];
  model_used: string;
  turn_count: number;
  analyzed_at: string;
  conversation_history: AgentConversationMessage[];
}

export interface ModelComparisonResult {
  experiment_id: string;
  models: Array<{
    model_id: string;
    results: Array<{
      patient_id: string;
      score?: number;
      status?: string;
      risk_factors?: number;
      success: boolean;
      error?: string;
    }>;
    success_rate: number;
    avg_score: number;
  }>;
  completed_at: string;
}

// Agent backend URL (configurable via environment)
const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || "http://localhost:8000";

/**
 * Check if the agent backend is available
 */
export async function checkAgentHealth(): Promise<{
  available: boolean;
  opik_enabled: boolean;
  default_model: string;
}> {
  try {
    const response = await fetch(`${AGENT_API_URL}/health`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return { available: false, opik_enabled: false, default_model: "" };
    }

    const data = await response.json();
    return {
      available: data.status === "healthy",
      opik_enabled: data.opik_enabled,
      default_model: data.default_model,
    };
  } catch (error) {
    console.log("[Agent] Backend not available, falling back to direct LLM");
    return { available: false, opik_enabled: false, default_model: "" };
  }
}

/**
 * Run multi-turn discharge analysis via the agent backend
 */
export async function runAgentAnalysis(
  patient: PatientData,
  modelId?: string,
  sessionId?: string
): Promise<AgentAnalysisResponse> {
  const response = await fetch(`${AGENT_API_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient,
      model_id: modelId,
      session_id: sessionId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Agent analysis failed");
  }

  return response.json();
}

/**
 * Run model comparison experiment
 */
export async function runModelComparison(
  patientIds: string[],
  patients: Record<string, PatientData>,
  modelIds: string[]
): Promise<ModelComparisonResult> {
  const response = await fetch(`${AGENT_API_URL}/compare-models`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      patient_ids: patientIds,
      patients,
      model_ids: modelIds,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Model comparison failed");
  }

  return response.json();
}

/**
 * Get session details and conversation history
 */
export async function getSessionHistory(
  sessionId: string
): Promise<{
  session_id: string;
  patient_id: string;
  started_at: string;
  completed_at?: string;
  model_used?: string;
  turn_count: number;
  final_score?: number;
  conversation_history: AgentConversationMessage[];
}> {
  const response = await fetch(`${AGENT_API_URL}/session/${sessionId}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Session not found");
  }

  return response.json();
}

/**
 * List all active sessions
 */
export async function listSessions(): Promise<{
  sessions: Array<{
    session_id: string;
    patient_id: string;
    started_at: string;
    completed_at?: string;
    model_used?: string;
    turn_count: number;
    final_score?: number;
  }>;
  total: number;
}> {
  const response = await fetch(`${AGENT_API_URL}/sessions`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error("Failed to list sessions");
  }

  return response.json();
}
