/**
 * Agent Memory Management
 *
 * Provides short-term and long-term memory for the discharge agent:
 *
 * 1. Short-term Memory (Session Context):
 *    - Conversation history within a session
 *    - Accumulated tool results
 *    - Current patient context
 *
 * 2. Long-term Memory (Persisted):
 *    - Past assessments for the same patient
 *    - Common risk patterns across patients
 *    - User preferences and workflow history
 *
 * 3. Working Memory:
 *    - Current task state
 *    - Pending actions
 *    - Reasoning traces
 *
 * Memory is integrated with Opik for observability and analysis.
 */

import { Opik } from "opik";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";
import type { Patient } from "@/lib/types/patient";

// Types for memory management
export interface ConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: {
    toolCalls?: Array<{ tool: string; success: boolean }>;
    analysisScore?: number;
    promptCommit?: string;
    model?: string;
    reactIterations?: number;
  };
}

export interface PatientMemoryContext {
  id: string;
  name: string;
  age: number;
  gender: string;
  medicationCount: number;
  conditionCount: number;
  riskLevel?: "high" | "moderate" | "low";
  lastAssessmentDate?: string;
  lastScore?: number;
}

export interface AssessmentHistory {
  patientId: string;
  assessmentDate: string;
  score: number;
  status: "ready" | "caution" | "not_ready";
  riskFactors: Array<{ severity: string; category: string; title: string }>;
  model: string;
  promptCommit?: string;
}

export interface ShortTermMemory {
  sessionId: string;
  conversationHistory: ConversationTurn[];
  currentPatient?: PatientMemoryContext;
  toolResults: Record<string, unknown>;
  workingState: {
    currentGoal: string;
    pendingActions: string[];
    reasoningTrace: string[];
  };
  createdAt: string;
  lastAccessedAt: string;
}

export interface LongTermMemory {
  // Patient history - keyed by patient ID
  patientAssessments: Map<string, AssessmentHistory[]>;

  // Pattern learning - common risk combinations
  riskPatterns: Array<{
    pattern: string[];
    frequency: number;
    avgScore: number;
    outcomeCorrelation?: number;
  }>;

  // User preferences
  userPreferences: {
    preferredModel?: string;
    showDetailedExplanations: boolean;
    autoGeneratePlan: boolean;
  };
}

// In-memory stores (would be Redis/DB in production)
const shortTermStore = new Map<string, ShortTermMemory>();
const longTermStore: LongTermMemory = {
  patientAssessments: new Map(),
  riskPatterns: [],
  userPreferences: {
    showDetailedExplanations: true,
    autoGeneratePlan: false,
  },
};

// Opik client for memory tracing
let opikClient: Opik | null = null;

function getOpik(): Opik | null {
  if (!process.env.OPIK_API_KEY) return null;
  if (!opikClient) {
    opikClient = new Opik({
      apiKey: process.env.OPIK_API_KEY,
      projectName: process.env.OPIK_PROJECT_NAME || "transitioniq",
    });
  }
  return opikClient;
}

/**
 * Create a new short-term memory session
 */
export function createMemorySession(sessionId: string, goal: string): ShortTermMemory {
  const memory: ShortTermMemory = {
    sessionId,
    conversationHistory: [],
    toolResults: {},
    workingState: {
      currentGoal: goal,
      pendingActions: [],
      reasoningTrace: [],
    },
    createdAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
  };

  shortTermStore.set(sessionId, memory);
  return memory;
}

/**
 * Get short-term memory for a session
 */
export function getMemorySession(sessionId: string): ShortTermMemory | undefined {
  const memory = shortTermStore.get(sessionId);
  if (memory) {
    memory.lastAccessedAt = new Date().toISOString();
  }
  return memory;
}

/**
 * Add a conversation turn to short-term memory
 */
export function addConversationTurn(
  sessionId: string,
  turn: Omit<ConversationTurn, "timestamp">
): void {
  const memory = shortTermStore.get(sessionId);
  if (!memory) {
    console.warn(`[Memory] Session ${sessionId} not found`);
    return;
  }

  memory.conversationHistory.push({
    ...turn,
    timestamp: new Date().toISOString(),
  });

  // Keep conversation history bounded (last 50 turns)
  if (memory.conversationHistory.length > 50) {
    // Summarize older turns before removing
    const oldTurns = memory.conversationHistory.slice(0, 10);
    memory.workingState.reasoningTrace.push(
      `[Summary of turns ${oldTurns.length}]: ${summarizeConversation(oldTurns)}`
    );
    memory.conversationHistory = memory.conversationHistory.slice(10);
  }

  memory.lastAccessedAt = new Date().toISOString();
}

/**
 * Set patient context in short-term memory
 */
export function setPatientContext(sessionId: string, patient: Patient): void {
  const memory = shortTermStore.get(sessionId);
  if (!memory) return;

  memory.currentPatient = {
    id: patient.id,
    name: patient.name,
    age: patient.age,
    gender: patient.gender,
    medicationCount: patient.medications.length,
    conditionCount: patient.diagnoses.length,
  };

  // Check if we have history for this patient
  const history = longTermStore.patientAssessments.get(patient.id);
  if (history && history.length > 0) {
    const lastAssessment = history[history.length - 1];
    memory.currentPatient.lastAssessmentDate = lastAssessment.assessmentDate;
    memory.currentPatient.lastScore = lastAssessment.score;
  }
}

/**
 * Store tool results in short-term memory
 */
export function storeToolResult(
  sessionId: string,
  toolName: string,
  result: unknown
): void {
  const memory = shortTermStore.get(sessionId);
  if (!memory) return;

  memory.toolResults[toolName] = result;
  memory.lastAccessedAt = new Date().toISOString();
}

/**
 * Add to reasoning trace
 */
export function addReasoningStep(sessionId: string, step: string): void {
  const memory = shortTermStore.get(sessionId);
  if (!memory) return;

  memory.workingState.reasoningTrace.push(`[${new Date().toISOString()}] ${step}`);

  // Keep bounded
  if (memory.workingState.reasoningTrace.length > 100) {
    memory.workingState.reasoningTrace = memory.workingState.reasoningTrace.slice(-50);
  }
}

/**
 * Store an assessment in long-term memory
 * This is called after each successful analysis
 */
export async function storeAssessment(
  patientId: string,
  analysis: DischargeAnalysis,
  model: string,
  promptCommit?: string
): Promise<void> {
  const history: AssessmentHistory = {
    patientId,
    assessmentDate: new Date().toISOString(),
    score: analysis.score,
    status: analysis.status,
    riskFactors: analysis.riskFactors.map((rf) => ({
      severity: rf.severity,
      category: rf.category,
      title: rf.title,
    })),
    model,
    promptCommit,
  };

  // Add to patient history
  if (!longTermStore.patientAssessments.has(patientId)) {
    longTermStore.patientAssessments.set(patientId, []);
  }
  longTermStore.patientAssessments.get(patientId)!.push(history);

  // Update risk patterns
  updateRiskPatterns(analysis.riskFactors);

  // Log to Opik for analysis
  await logMemoryToOpik("assessment_stored", {
    patientId,
    score: analysis.score,
    status: analysis.status,
    riskFactorCount: analysis.riskFactors.length,
    model,
    promptCommit,
  });
}

/**
 * Get patient assessment history
 */
export function getPatientHistory(patientId: string): AssessmentHistory[] {
  return longTermStore.patientAssessments.get(patientId) || [];
}

/**
 * Get context for a new assessment including history
 */
export function getAssessmentContext(patientId: string): {
  previousAssessments: AssessmentHistory[];
  scoreTrend: "improving" | "declining" | "stable" | "unknown";
  knownRiskPatterns: string[];
} {
  const history = getPatientHistory(patientId);

  let scoreTrend: "improving" | "declining" | "stable" | "unknown" = "unknown";
  if (history.length >= 2) {
    const recentScores = history.slice(-3).map((h) => h.score);
    const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
    const firstScore = recentScores[0];
    const diff = avgRecent - firstScore;

    if (diff > 10) scoreTrend = "improving";
    else if (diff < -10) scoreTrend = "declining";
    else scoreTrend = "stable";
  }

  // Find common risk factors for this patient
  const riskCounts = new Map<string, number>();
  history.forEach((h) => {
    h.riskFactors
      .filter((rf) => rf.severity === "high" || rf.severity === "moderate")
      .forEach((rf) => {
        const key = `${rf.category}:${rf.title}`;
        riskCounts.set(key, (riskCounts.get(key) || 0) + 1);
      });
  });

  const knownRiskPatterns = Array.from(riskCounts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern]) => pattern);

  return {
    previousAssessments: history.slice(-5), // Last 5 assessments
    scoreTrend,
    knownRiskPatterns,
  };
}

/**
 * Update global risk patterns based on new assessment
 */
function updateRiskPatterns(riskFactors: RiskFactor[]): void {
  const highRisks = riskFactors
    .filter((rf) => rf.severity === "high")
    .map((rf) => rf.category);

  if (highRisks.length < 2) return;

  // Sort for consistent pattern matching
  const pattern = [...highRisks].sort();
  const patternKey = pattern.join("+");

  const existing = longTermStore.riskPatterns.find(
    (p) => p.pattern.join("+") === patternKey
  );

  if (existing) {
    existing.frequency++;
  } else {
    longTermStore.riskPatterns.push({
      pattern,
      frequency: 1,
      avgScore: 0,
    });
  }
}

/**
 * Get common risk patterns (for insights)
 */
export function getCommonRiskPatterns(): Array<{
  pattern: string[];
  frequency: number;
}> {
  return longTermStore.riskPatterns
    .filter((p) => p.frequency >= 3)
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 10);
}

/**
 * Build context string for LLM including memory
 */
export function buildContextForLLM(sessionId: string): string {
  const memory = getMemorySession(sessionId);
  if (!memory) return "";

  const parts: string[] = [];

  // Add patient history context if available
  if (memory.currentPatient) {
    const context = getAssessmentContext(memory.currentPatient.id);

    if (context.previousAssessments.length > 0) {
      parts.push(`## Patient History`);
      parts.push(`Previous assessments: ${context.previousAssessments.length}`);
      parts.push(`Score trend: ${context.scoreTrend}`);

      if (context.knownRiskPatterns.length > 0) {
        parts.push(`Recurring risk factors: ${context.knownRiskPatterns.join(", ")}`);
      }

      const lastAssessment = context.previousAssessments[context.previousAssessments.length - 1];
      parts.push(`Last score: ${lastAssessment.score} (${lastAssessment.status}) on ${lastAssessment.assessmentDate}`);
    }
  }

  // Add recent conversation context
  const recentTurns = memory.conversationHistory.slice(-10);
  if (recentTurns.length > 0) {
    parts.push(`## Recent Conversation`);
    recentTurns.forEach((turn) => {
      parts.push(`${turn.role}: ${turn.content.slice(0, 200)}...`);
    });
  }

  // Add reasoning trace
  if (memory.workingState.reasoningTrace.length > 0) {
    parts.push(`## Reasoning Trace`);
    memory.workingState.reasoningTrace.slice(-5).forEach((step) => {
      parts.push(`- ${step}`);
    });
  }

  return parts.join("\n");
}

/**
 * Summarize conversation turns for compression
 */
function summarizeConversation(turns: ConversationTurn[]): string {
  const userMessages = turns.filter((t) => t.role === "user").length;
  const assistantMessages = turns.filter((t) => t.role === "assistant").length;
  const toolCalls = turns
    .flatMap((t) => t.metadata?.toolCalls || [])
    .filter((tc) => tc.success).length;

  return `${userMessages} user messages, ${assistantMessages} assistant responses, ${toolCalls} successful tool calls`;
}

/**
 * Log memory operations to Opik
 */
async function logMemoryToOpik(
  operation: string,
  data: Record<string, unknown>
): Promise<void> {
  const opik = getOpik();
  if (!opik) return;

  try {
    const trace = opik.trace({
      name: `memory-${operation}`,
      metadata: {
        operation,
        ...data,
      },
    });
    trace.end();
    await opik.flush();
  } catch (error) {
    console.error(`[Memory] Failed to log to Opik:`, error);
  }
}

/**
 * Clear short-term memory for a session
 */
export function clearSession(sessionId: string): void {
  shortTermStore.delete(sessionId);
}

/**
 * Get memory stats for debugging
 */
export function getMemoryStats(): {
  activeSessions: number;
  totalPatients: number;
  totalAssessments: number;
  riskPatternCount: number;
} {
  let totalAssessments = 0;
  longTermStore.patientAssessments.forEach((history) => {
    totalAssessments += history.length;
  });

  return {
    activeSessions: shortTermStore.size,
    totalPatients: longTermStore.patientAssessments.size,
    totalAssessments,
    riskPatternCount: longTermStore.riskPatterns.length,
  };
}

/**
 * Export memory for persistence (would save to DB in production)
 */
export function exportLongTermMemory(): string {
  const data = {
    patientAssessments: Object.fromEntries(longTermStore.patientAssessments),
    riskPatterns: longTermStore.riskPatterns,
    userPreferences: longTermStore.userPreferences,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Import memory from persistence
 */
export function importLongTermMemory(json: string): void {
  try {
    const data = JSON.parse(json);

    if (data.patientAssessments) {
      longTermStore.patientAssessments = new Map(Object.entries(data.patientAssessments));
    }
    if (data.riskPatterns) {
      longTermStore.riskPatterns = data.riskPatterns;
    }
    if (data.userPreferences) {
      longTermStore.userPreferences = {
        ...longTermStore.userPreferences,
        ...data.userPreferences,
      };
    }

    console.log("[Memory] Long-term memory imported successfully");
  } catch (error) {
    console.error("[Memory] Failed to import long-term memory:", error);
  }
}
