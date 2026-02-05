"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Users, RefreshCw, ChevronDown, Sparkles, FileText, CheckCircle, FlaskConical, LayoutDashboard, Cpu, AlertTriangle, Heart, Info, X, ShieldAlert } from "lucide-react";
import { PatientHeader } from "@/components/PatientHeader";
import { DischargeScore } from "@/components/DischargeScore";
import { RiskFactorCard } from "@/components/RiskFactorCard";
import { EvaluationDashboard } from "@/components/EvaluationDashboard";
import { PatientRecoveryCoach, type PatientSummary } from "@/components/PatientRecoveryCoach";
import { SafetyDisclaimer, MedicalCaveats, ResponsibleAIBadge } from "@/components/SafetyDisclaimer";
import { ModelSelector } from "@/components/ModelSelector";
import { DischargePlan } from "@/components/DischargePlan";
import { Tooltip } from "@/components/Tooltip";
import { JudgeScoreBadge, type JudgeEvaluation } from "@/components/JudgeScoreBadge";
import { ThinkingSteps } from "@/components/ThinkingSteps";
import { useReActStream, type ReActStep } from "@/hooks/useReActStream";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis, RiskFactor, ClinicianEdits } from "@/lib/types/analysis";

// Extended analysis type with model and agent info
interface AnalysisWithModel extends DischargeAnalysis {
  modelUsed?: string;
  modelRequested?: string;
  agentUsed?: boolean;
  agentFallbackUsed?: boolean;
  agentFallbackReason?: string;
  sessionId?: string;
  message?: string;
  toolsUsed?: Array<{
    id: string;
    tool: string;
    success?: boolean;
    duration?: number;
  }>;
  agentGraph?: {
    nodes: Array<{ id: string; label: string; status: string; duration?: number }>;
    edges: Array<{ from: string; to: string }>;
  };
  steps?: Array<{
    id: string;
    type: string;
    content: string;
    timestamp: string;
  }>;
}

type TabType = "dashboard" | "patient" | "evaluation";

// Kill-switch: set NEXT_PUBLIC_DISABLE_EVALUATION=true to hide the evaluation tab
const evaluationEnabled = process.env.NEXT_PUBLIC_DISABLE_EVALUATION !== "true";

// ---------------------------------------------------------------------------
// sessionStorage analysis cache — auto-clears on tab close; 10-min TTL
// ---------------------------------------------------------------------------
const ANALYSIS_CACHE_PREFIX = "tiq-analysis-";
const ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CachedAnalysis {
  data: AnalysisWithModel;
  timestamp: number;
}

function analysisCacheKey(patientId: string, modelId: string): string {
  return `${ANALYSIS_CACHE_PREFIX}${patientId}:${modelId || "default"}`;
}

/** Remove all stale (>10 min) analysis entries from sessionStorage. */
function cleanupAnalysisCache(): void {
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(ANALYSIS_CACHE_PREFIX)) continue;
      try {
        const entry = JSON.parse(sessionStorage.getItem(key)!) as CachedAnalysis;
        if (now - entry.timestamp > ANALYSIS_CACHE_TTL_MS) {
          keysToRemove.push(key);
        }
      } catch {
        keysToRemove.push(key!); // corrupt entry — remove
      }
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // sessionStorage unavailable (SSR, incognito quota, etc.) — ignore
  }
}

function getCachedAnalysis(patientId: string, modelId: string): AnalysisWithModel | null {
  try {
    const raw = sessionStorage.getItem(analysisCacheKey(patientId, modelId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CachedAnalysis;
    if (Date.now() - entry.timestamp > ANALYSIS_CACHE_TTL_MS) {
      sessionStorage.removeItem(analysisCacheKey(patientId, modelId));
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function cacheAnalysis(patientId: string, modelId: string, data: AnalysisWithModel): void {
  try {
    const entry: CachedAnalysis = { data, timestamp: Date.now() };
    sessionStorage.setItem(analysisCacheKey(patientId, modelId), JSON.stringify(entry));
  } catch {
    // quota exceeded or unavailable — silently skip
  }
}

// Demo patients for quick selection
const DEMO_PATIENTS = [
  { id: "demo-polypharmacy", name: "John Smith", description: "68M, 12 medications, AFib + Diabetes" },
  { id: "demo-heart-failure", name: "Mary Johnson", description: "72F, CHF + COPD" },
  { id: "demo-ready", name: "Robert Chen", description: "45M, Post-appendectomy (Ready)" },
  { id: "demo-pediatric", name: "Emily Wilson", description: "8F, Post-tonsillectomy (Ready)" },
  { id: "demo-geriatric-fall", name: "Dorothy Martinez", description: "88F, Hip fracture + Dementia" },
  { id: "demo-pregnancy-gdm", name: "Sarah Thompson", description: "32F, Gestational diabetes" },
  { id: "demo-renal-dialysis", name: "William Jackson", description: "65M, CKD Stage 4 + Dialysis" },
  { id: "demo-psychiatric-bipolar", name: "Jennifer Adams", description: "45F, Bipolar + Lithium" },
  { id: "demo-oncology-neutropenic", name: "Michael Brown", description: "58M, Post-chemo neutropenia" },
  { id: "demo-simple-surgery", name: "Lisa Garcia", description: "35F, Cholecystectomy (Ready)" },
  { id: "demo-extreme-polypharmacy", name: "Harold Wilson", description: "75M, 18 medications, Multiple issues" },
  { id: "demo-social-risk", name: "David Thompson", description: "52M, Homeless + COPD" },
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabType>("dashboard");
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [patient, setPatient] = useState<Patient | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisWithModel | null>(null);
  const [currentModel, setCurrentModel] = useState<string>("");
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingPlan, setIsGeneratingPlan] = useState(false);
  const [dischargePlan, setDischargePlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [showDemoNote, setShowDemoNote] = useState(true);
  const [expandedRiskFactors, setExpandedRiskFactors] = useState<Set<string>>(new Set());
  const [modelLimitError, setModelLimitError] = useState<{
    modelId: string;
    provider: string;
    availableModels: string[];
  } | null>(null);
  const [judgeEvaluation, setJudgeEvaluation] = useState<JudgeEvaluation | null>(null);
  const [isRunningJudge, setIsRunningJudge] = useState(false);
  const [judgeError, setJudgeError] = useState<string | null>(null);
  // Patient summary state - lifted here to persist across tab switches
  const [patientSummary, setPatientSummary] = useState<PatientSummary | null>(null);
  // Rate limit state for discharge plan generation
  const [planRateLimitReset, setPlanRateLimitReset] = useState<number | null>(null);
  const [planRateLimitCountdown, setPlanRateLimitCountdown] = useState("");
  // Clinician edits overlay on AI-generated discharge plan
  const [clinicianEdits, setClinicianEdits] = useState<ClinicianEdits>({
    customItems: [],
    dismissedItemKeys: [],
  });

  // Streaming state for plan generation ReAct steps
  const [planStreamingSteps, setPlanStreamingSteps] = useState<ReActStep[]>([]);
  const [planStreamingError, setPlanStreamingError] = useState<string | null>(null);

  // Streaming state for analysis ReAct steps
  const [analysisStreamingSteps, setAnalysisStreamingSteps] = useState<ReActStep[]>([]);
  const [analysisStreamingError, setAnalysisStreamingError] = useState<string | null>(null);

  // Initialize session cookie on first visit (for server-side rate limiting)
  useEffect(() => {
    if (!document.cookie.includes("tiq_session=")) {
      const sessionId = crypto.randomUUID();
      document.cookie = `tiq_session=${sessionId}; path=/; max-age=${60 * 60 * 24 * 7}; SameSite=Lax`;
    }
    // Clean up stale analysis entries (>10 min) on every page load
    cleanupAnalysisCache();
  }, []);

  // Countdown timer for plan generation rate limit
  useEffect(() => {
    if (!planRateLimitReset) {
      setPlanRateLimitCountdown("");
      return;
    }
    const tick = () => {
      const remaining = planRateLimitReset - Date.now();
      if (remaining <= 0) {
        setPlanRateLimitReset(null);
        setPlanRateLimitCountdown("");
        return;
      }
      const m = Math.floor(remaining / 60000);
      const s = Math.ceil((remaining % 60000) / 1000);
      setPlanRateLimitCountdown(m > 0 ? `${m}m ${s}s` : `${s}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [planRateLimitReset]);

  // Load patient data when selection changes
  useEffect(() => {
    if (!selectedPatientId) return;

    async function loadPatient() {
      setIsLoadingPatient(true);
      setError(null);
      setAnalysis(null);
      setDischargePlan(null);
      setClinicianEdits({ customItems: [], dismissedItemKeys: [] });
      setJudgeEvaluation(null);
      setJudgeError(null);
      setPatientSummary(null); // Clear cached summary when patient changes

      try {
        const response = await fetch(`/api/patient/${selectedPatientId}`);
        if (!response.ok) throw new Error("Failed to load patient");
        const data = await response.json();
        setPatient(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load patient");
        setPatient(null);
      } finally {
        setIsLoadingPatient(false);
      }
    }

    loadPatient();
  }, [selectedPatientId]);

  // Run discharge analysis with streaming (checks sessionStorage cache first)
  async function runAnalysis() {
    if (!patient) return;

    setIsAnalyzing(true);
    setError(null);
    setModelLimitError(null);
    setDischargePlan(null);
    setClinicianEdits({ customItems: [], dismissedItemKeys: [] });
    setPlanRateLimitReset(null);
    setJudgeEvaluation(null);
    setJudgeError(null);
    setAnalysisStreamingSteps([]);
    setAnalysisStreamingError(null);

    // Check sessionStorage cache for same patient + model
    const cached = getCachedAnalysis(patient.id, currentModel);
    if (cached) {
      setAnalysis(cached);
      setPatientSummary(null);
      const highRiskIds = new Set<string>(
        cached.riskFactors
          .filter((rf: RiskFactor) => rf.severity === "high")
          .map((rf: RiskFactor) => rf.id)
      );
      setExpandedRiskFactors(highRiskIds);
      setIsAnalyzing(false);
      // Still trigger judge in background for cached analysis
      runJudgeEvaluation(patient.id, cached);
      return;
    }

    try {
      // Use streaming API to show thinking steps in real-time
      const streamUrl = `/api/analyze?stream=true`;
      const response = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id, modelId: currentModel || undefined }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Analysis failed" }));

        // Check for demo rate limit (429 without suggestModelSwitch)
        if (response.status === 429 && !errorData.suggestModelSwitch) {
          throw new Error(errorData.message || "Demo rate limit reached. Please try again in a few minutes.");
        }

        // Check for model provider rate limit / usage limit error
        if (response.status === 429 && errorData.suggestModelSwitch) {
          setModelLimitError({
            modelId: errorData.modelId,
            provider: errorData.provider,
            availableModels: errorData.availableModels || [],
          });
          setIsAnalyzing(false);
          return;
        }

        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let analysisData: AnalysisWithModel | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);

              switch (event.type) {
                case "thought":
                  setAnalysisStreamingSteps((prev) => [
                    ...prev,
                    {
                      type: "thought",
                      iteration: event.iteration,
                      content: event.thought,
                      timestamp: event.timestamp,
                    },
                  ]);
                  break;

                case "action":
                  setAnalysisStreamingSteps((prev) => [
                    ...prev,
                    {
                      type: "action",
                      iteration: event.iteration,
                      content: `Calling ${event.tool}`,
                      tool: event.tool,
                      timestamp: event.timestamp,
                    },
                  ]);
                  break;

                case "observation":
                  setAnalysisStreamingSteps((prev) => [
                    ...prev,
                    {
                      type: "observation",
                      iteration: event.iteration,
                      content: event.observation,
                      timestamp: event.timestamp,
                    },
                  ]);
                  break;

                case "analysis":
                  // Analysis data received from ReAct loop
                  if (event.analysis) {
                    analysisData = event.analysis;
                  }
                  break;

                case "result":
                  // Final result with full analysis data
                  if (event.data) {
                    analysisData = event.data;
                  }
                  break;

                case "error":
                  // Make rate limit and timeout errors more user-friendly
                  let userFriendlyError = event.error;

                  if (event.error.includes("rate limit") || event.error.includes("RATE_LIMITED")) {
                    userFriendlyError = `⚠️ The ${currentModel} model is currently rate limited. Please wait a moment and try again, or switch to a different model using the dropdown above.`;
                  } else if (event.error.includes("timed out") || event.error.includes("timeout")) {
                    userFriendlyError = `⏱️ The ${currentModel} model took too long to respond (>30s). This model may be overloaded. Please try again or switch to a different model.`;
                  } else if (event.error.includes("quota") || event.error.includes("insufficient_quota")) {
                    userFriendlyError = `💳 API quota exceeded for ${currentModel}. Please check your API credits or switch to a different model.`;
                  }

                  setAnalysisStreamingError(userFriendlyError);
                  throw new Error(userFriendlyError);
              }
            } catch (parseError) {
              if (parseError instanceof Error && parseError.message !== data) {
                console.warn("[Analysis] Failed to parse SSE event:", data, parseError);
              }
            }
          }
        }
      }

      // Use the analysis data from the stream
      if (analysisData) {
        // Cache the fresh analysis in sessionStorage
        cacheAnalysis(patient.id, currentModel, analysisData);

        setAnalysis(analysisData);
        // Clear cached patient summary since analysis changed
        setPatientSummary(null);

        // Auto-expand high-severity risk factors
        const highRiskIds = new Set<string>(
          (analysisData.riskFactors || [])
            .filter((rf: RiskFactor) => rf.severity === "high")
            .map((rf: RiskFactor) => rf.id)
        );
        setExpandedRiskFactors(highRiskIds);

        // Auto-trigger LLM-as-Judge evaluation (in background)
        runJudgeEvaluation(patient.id, analysisData);

        // Clear streaming steps after analysis completes
        setAnalysisStreamingSteps([]);
      } else {
        throw new Error("Analysis completed but no results received");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
      setAnalysisStreamingSteps([]);
    } finally {
      setIsAnalyzing(false);
    }
  }

  // Run LLM-as-Judge evaluation on the analysis
  async function runJudgeEvaluation(patientId: string, analysisToJudge: DischargeAnalysis) {
    setIsRunningJudge(true);
    setJudgeError(null);
    setJudgeEvaluation(null);

    try {
      const response = await fetch("/api/evaluate/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId,
          analysis: analysisToJudge,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Judge evaluation failed");
      }

      const data = await response.json();
      setJudgeEvaluation(data.evaluation);
    } catch (err) {
      setJudgeError(err instanceof Error ? err.message : "Judge evaluation failed");
    } finally {
      setIsRunningJudge(false);
    }
  }

  // Generate discharge plan with streaming ReAct steps
  async function generatePlan() {
    if (!patient || !analysis) return;

    setIsGeneratingPlan(true);
    setError(null);
    setPlanRateLimitReset(null);
    setPlanStreamingSteps([]);
    setPlanStreamingError(null);
    setDischargePlan(null);

    try {
      // Use streaming endpoint
      const response = await fetch("/api/generate-plan?stream=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id, analysis, modelId: currentModel || undefined }),
      });

      // Handle non-streaming errors (rate limit, etc)
      if (!response.ok) {
        const contentType = response.headers.get("content-type");
        if (contentType?.includes("application/json")) {
          const data = await response.json();
          if (response.status === 429) {
            const resetTime = Date.now() + (data.retryAfterMs || 60000);
            setPlanRateLimitReset(resetTime);
            setIsGeneratingPlan(false);
            return;
          }
          throw new Error(data.error || "Plan generation failed");
        }
        throw new Error(`HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      // Process SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;

            try {
              const event = JSON.parse(data);

              switch (event.type) {
                case "thought":
                  setPlanStreamingSteps(prev => [...prev, {
                    type: "thought",
                    iteration: event.iteration,
                    content: event.thought,
                    timestamp: event.timestamp,
                  }]);
                  break;

                case "action":
                  setPlanStreamingSteps(prev => [...prev, {
                    type: "action",
                    iteration: event.iteration,
                    content: `Calling ${event.tool}`,
                    tool: event.tool,
                    timestamp: event.timestamp,
                  }]);
                  break;

                case "observation":
                  setPlanStreamingSteps(prev => [...prev, {
                    type: "observation",
                    iteration: event.iteration,
                    content: event.observation,
                    timestamp: event.timestamp,
                  }]);
                  break;

                case "final":
                  // Extract plan from result
                  const plan = event.result?.answer || event.answer;
                  const planStr = typeof plan === "string" ? plan : JSON.stringify(plan, null, 2);
                  setDischargePlan(planStr);
                  setIsGeneratingPlan(false);
                  break;

                case "error":
                  setPlanStreamingError(event.error);
                  setError(event.error);
                  setIsGeneratingPlan(false);
                  break;
              }
            } catch (parseErr) {
              console.warn("[generatePlan] Failed to parse SSE event:", data);
            }
          }
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Plan generation failed";
      setError(errorMsg);
      setPlanStreamingError(errorMsg);
    } finally {
      setIsGeneratingPlan(false);
    }
  }

  // Clinician edit handlers
  function addCustomItem(text: string, priority: "high" | "moderate" | "standard") {
    setClinicianEdits((prev) => ({
      ...prev,
      customItems: [
        ...prev.customItems,
        { id: crypto.randomUUID(), text, priority, addedAt: new Date().toISOString() },
      ],
    }));
  }

  function dismissItem(key: string) {
    setClinicianEdits((prev) => ({
      ...prev,
      dismissedItemKeys: [...prev.dismissedItemKeys, key],
    }));
  }

  function restoreItem(key: string) {
    setClinicianEdits((prev) => ({
      ...prev,
      dismissedItemKeys: prev.dismissedItemKeys.filter((k) => k !== key),
    }));
  }

  function removeCustomItem(id: string) {
    setClinicianEdits((prev) => ({
      ...prev,
      customItems: prev.customItems.filter((i) => i.id !== id),
    }));
  }

  const toggleRiskFactor = (id: string) => {
    setExpandedRiskFactors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Safety Banner */}
      <SafetyDisclaimer variant="banner" />

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8">
          {/* Mobile: Stack vertically, Desktop: Single row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between py-2 sm:py-0 sm:h-16 gap-2 sm:gap-4">
            {/* Logo - Hidden on mobile to save space */}
            <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <Activity className="w-6 h-6 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900">TransitionIQ</h1>
                  <ResponsibleAIBadge />
                </div>
                <p className="text-xs text-gray-500">Discharge Readiness Assessment</p>
              </div>
            </div>

            {/* Tab Navigation - Full width on mobile */}
            <nav className="flex items-center justify-center gap-1 bg-gray-100 rounded-lg p-1 w-full sm:w-auto">
              <Tooltip content="Clinical discharge readiness assessment" position="bottom">
                <button
                  onClick={() => setActiveTab("dashboard")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 sm:flex-none justify-center ${
                    activeTab === "dashboard"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  <span className="text-xs sm:text-sm">Clinical</span>
                </button>
              </Tooltip>
              <Tooltip content="Patient-friendly recovery guidance" position="bottom">
                <button
                  onClick={() => setActiveTab("patient")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 sm:flex-none justify-center whitespace-nowrap ${
                    activeTab === "patient"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <Heart className="w-4 h-4" />
                  <span className="text-xs sm:text-sm">Patient View</span>
                </button>
              </Tooltip>
              {evaluationEnabled && (
              <Tooltip content="Test and compare AI models" position="bottom">
                <button
                  onClick={() => setActiveTab("evaluation")}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 sm:flex-none justify-center ${
                    activeTab === "evaluation"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  <FlaskConical className="w-4 h-4" />
                  <span className="text-xs sm:text-sm">Evaluation</span>
                </button>
              </Tooltip>
              )}
            </nav>

            {/* Model Selector and Patient Selector - Row on mobile */}
            <div className="flex items-center justify-center gap-2 sm:gap-3 w-full sm:w-auto">
              {/* Model Selector - visible on dashboard and patient tabs */}
              {activeTab !== "evaluation" && <ModelSelector
                isOpenControlled={showModelDropdown}
                onOpenChange={(open) => {
                  setShowModelDropdown(open);
                  if (open) setShowPatientDropdown(false);
                }}
                onModelChange={(modelId) => {
                  setCurrentModel(modelId);
                  // Clear analysis when model changes so user re-runs with new model
                  if (analysis) {
                    setAnalysis(null);
                    setDischargePlan(null);
                    setClinicianEdits({ customItems: [], dismissedItemKeys: [] });
                    setPlanRateLimitReset(null);
                    setJudgeEvaluation(null);
                    setJudgeError(null);

                    // Clear plan streaming state to remove stale thinking steps UI
                    setPlanStreamingSteps([]);
                    setPlanStreamingError(null);

                    // Clear analysis streaming state for consistency
                    setAnalysisStreamingSteps([]);
                    setAnalysisStreamingError(null);
                  }
                }}
              />}

              {/* Patient Selector - show on dashboard tab only */}
              {activeTab === "dashboard" && (
                <div className="relative">
                  <Tooltip content="Select a demo patient to analyze" position="bottom">
                    <button
                      onClick={() => {
                        setShowPatientDropdown(!showPatientDropdown);
                        setShowModelDropdown(false);
                      }}
                      className="flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <Users className="w-4 h-4 text-gray-600" />
                      <span className="text-sm font-medium text-gray-700 max-w-[100px] sm:max-w-none truncate">
                        {patient ? patient.name : "Select Patient"}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${showPatientDropdown ? "rotate-180" : ""}`} />
                    </button>
                  </Tooltip>

                  <AnimatePresence>
                    {showPatientDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="fixed left-2 right-2 sm:absolute sm:left-auto sm:right-0 mt-2 sm:w-80 sm:max-w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50 max-h-[60vh] overflow-y-auto"
                      >
                        <div className="p-2">
                          <p className="text-xs font-medium text-gray-500 px-3 py-2">Demo Patients</p>
                          {DEMO_PATIENTS.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => {
                                setSelectedPatientId(p.id);
                                setShowPatientDropdown(false);
                              }}
                              className={`w-full text-left px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors ${
                                selectedPatientId === p.id ? "bg-blue-50" : ""
                              }`}
                            >
                              <p className="font-medium text-gray-900">{p.name}</p>
                              <p className="text-xs text-gray-500">{p.description}</p>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Backdrop overlay — closes dropdowns on tap, prevents scroll-through */}
      {(showPatientDropdown || showModelDropdown) && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => {
            setShowPatientDropdown(false);
            setShowModelDropdown(false);
          }}
        />
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Demo Context Note */}
        <AnimatePresence>
          {showDemoNote && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start gap-3"
            >
              <Info className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-gray-500 flex-1">
                <span className="font-medium text-gray-600">Demo mode:</span>{" "}
                {activeTab === "dashboard"
                  ? "In production, this Clinical View would be integrated into the hospital EHR (e.g., Epic, Cerner) as a discharge decision support module."
                  : activeTab === "patient"
                  ? "In production, this Patient View would be a standalone mobile app or integrated into a patient portal like MyChart."
                  : "In production, the Evaluation dashboard would be an internal tool for the TransitionIQ team to monitor model performance and manage prompt versions."}
              </p>
              <button
                onClick={() => setShowDemoNote(false)}
                className="text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Evaluation Tab */}
        {evaluationEnabled && activeTab === "evaluation" && <EvaluationDashboard />}

        {/* Patient View Tab */}
        {activeTab === "patient" && (
          <PatientRecoveryCoach
            patient={patient}
            analysis={analysis}
            isLoading={isLoadingPatient}
            cachedSummary={patientSummary}
            onSummaryGenerated={setPatientSummary}
            clinicianEdits={clinicianEdits}
          />
        )}

        {/* Dashboard Tab */}
        {activeTab === "dashboard" && (
          <>
            {/* Error Banner */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700"
                >
                  <p className="font-medium">Error</p>
                  <p className="text-sm">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Model Rate Limit Banner */}
            <AnimatePresence>
              {modelLimitError && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl"
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-amber-800">Model Rate Limited</p>
                      <p className="text-sm text-amber-700 mt-1">
                        The model <span className="font-mono bg-amber-100 px-1 rounded">{modelLimitError.modelId}</span> has
                        reached its rate or usage limit. Please switch to a different model to continue.
                      </p>
                      {modelLimitError.availableModels.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="text-sm text-amber-700">Available models:</span>
                          {modelLimitError.availableModels.slice(0, 3).map((modelId) => (
                            <button
                              key={modelId}
                              onClick={async () => {
                                try {
                                  const response = await fetch("/api/model/switch", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ modelId }),
                                  });
                                  if (response.ok) {
                                    setCurrentModel(modelId);
                                    setModelLimitError(null);
                                    // Re-run analysis with new model
                                    runAnalysis();
                                  }
                                } catch (e) {
                                  console.error("Failed to switch model:", e);
                                }
                              }}
                              className="px-3 py-1 text-sm bg-amber-200 hover:bg-amber-300 text-amber-800 rounded-lg font-medium transition-colors"
                            >
                              Switch to {modelId}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => setModelLimitError(null)}
                        className="mt-3 text-sm text-amber-600 hover:text-amber-800 underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* No Patient Selected */}
            {!selectedPatientId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Users className="w-10 h-10 text-gray-400" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Select a Patient</h2>
            <p className="text-gray-500 mb-6">Choose a patient to begin discharge readiness assessment</p>
            <Tooltip content="Choose from demo patients to begin" position="bottom">
              <button
                onClick={() => setShowPatientDropdown(true)}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
              >
                Select Patient
              </button>
            </Tooltip>
          </motion.div>
        )}

        {/* Patient Selected */}
        {selectedPatientId && (
          <div className="space-y-6">
            {/* Patient Header */}
            <PatientHeader patient={patient} isLoading={isLoadingPatient} />

            {/* Analysis Section */}
            {patient && !isLoadingPatient && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Left Column - Score */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Transition Readiness Score</h3>
                    {!isAnalyzing && (
                      <Tooltip content={analysis ? "Run analysis again with current model" : "Assess discharge readiness using AI"} position="bottom">
                        <button
                          onClick={runAnalysis}
                          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                        >
                          <Sparkles className="w-4 h-4" />
                          {analysis ? "Re-analyze" : "Analyze"}
                        </button>
                      </Tooltip>
                    )}
                  </div>

                  {!analysis && !isAnalyzing && (
                    <div className="text-center py-12">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Activity className="w-8 h-8 text-gray-400" />
                      </div>
                      <p className="text-gray-500">Click &quot;Analyze&quot; to assess discharge readiness</p>
                    </div>
                  )}

                  {(isAnalyzing || analysis) && (
                    <>
                      <DischargeScore
                        score={analysis?.score ?? 0}
                        status={analysis?.status ?? "caution"}
                        isLoading={isAnalyzing}
                      />
                      {/* Show model and agent info */}
                      {analysis?.modelUsed && (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                            <Cpu className="w-4 h-4" />
                            <span>Analyzed with: <span className="font-medium text-gray-700">{analysis.modelUsed}</span></span>
                          </div>
                          {analysis.agentFallbackUsed && (
                            <div className="flex items-center justify-center gap-2 text-xs text-amber-500">
                              <AlertTriangle className="w-3 h-3" />
                              <span>Agent mode failed, used direct LLM{analysis.agentFallbackReason ? `: ${analysis.agentFallbackReason}` : ""}</span>
                            </div>
                          )}
                          {analysis.agentUsed && !analysis.agentFallbackUsed && (
                            <div className="flex items-center justify-center gap-2 text-sm text-emerald-600">
                              <Sparkles className="w-4 h-4" />
                              <span className="font-medium">Multi-turn Agent Workflow</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Agent Workflow Details */}
                      {analysis?.agentUsed && analysis.toolsUsed && analysis.toolsUsed.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
                        >
                          <h4 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-2">
                            <Activity className="w-4 h-4" />
                            Agent Execution ({analysis.toolsUsed.length} tools)
                          </h4>
                          <div className="space-y-1">
                            {analysis.toolsUsed.map((tool, i) => (
                              <div
                                key={tool.id || i}
                                className="flex items-center justify-between text-xs"
                              >
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${
                                    tool.success ? "bg-emerald-500" : "bg-red-500"
                                  }`} />
                                  <span className="font-mono text-gray-600">{tool.tool}</span>
                                </div>
                                {tool.duration && (
                                  <span className="text-gray-400">{tool.duration}ms</span>
                                )}
                              </div>
                            ))}
                          </div>
                          {analysis.sessionId && (
                            <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-400">
                              Session: <span className="font-mono">{analysis.sessionId.slice(0, 8)}...</span>
                            </div>
                          )}
                          {/* Data Sources Summary */}
                          <div className="mt-3 pt-2 border-t border-gray-200 flex flex-wrap gap-1.5">
                            <span className="text-xs text-gray-500 mr-1">Data sources:</span>
                            {[...new Set(analysis.toolsUsed.map((t) => {
                              const sourceMap: Record<string, string> = {
                                fetch_patient: "FHIR",
                                check_drug_interactions: "FDA",
                                evaluate_care_gaps: "Guidelines",
                                estimate_costs: "CMS",
                                retrieve_knowledge: "RAG",
                                analyze_readiness: "LLM",
                                generate_plan: "LLM",
                              };
                              return sourceMap[t.tool] || t.tool;
                            }))].map((src) => {
                              const colors: Record<string, string> = {
                                FHIR: "bg-orange-100 text-orange-700",
                                FDA: "bg-purple-100 text-purple-700",
                                Guidelines: "bg-green-100 text-green-700",
                                CMS: "bg-blue-100 text-blue-700",
                                RAG: "bg-teal-100 text-teal-700",
                                LLM: "bg-indigo-100 text-indigo-700",
                              };
                              return (
                                <span key={src} className={`text-xs px-2 py-0.5 rounded-full ${colors[src] || "bg-gray-100 text-gray-700"}`}>
                                  {src}
                                </span>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}

                      {/* LLM-as-Judge Quality Score */}
                      <div className="mt-4">
                        <JudgeScoreBadge
                          evaluation={judgeEvaluation}
                          isLoading={isRunningJudge}
                          error={judgeError}
                        />
                      </div>
                    </>
                  )}

                  {/* Generate Plan Button — or rate limit banner */}
                  {analysis && !isGeneratingPlan && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 text-center"
                    >
                      {planRateLimitReset ? (
                        <div className="flex items-center justify-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-sm">
                          <ShieldAlert className="w-5 h-5 flex-shrink-0" />
                          <span>Rate limit reached. Try again in <strong>{planRateLimitCountdown}</strong>.</span>
                        </div>
                      ) : (
                        <Tooltip content="Create an actionable checklist based on risk factors" position="top">
                          <button
                            onClick={generatePlan}
                            disabled={isGeneratingPlan}
                            className="flex items-center gap-2 mx-auto px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg font-medium hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg"
                          >
                            <FileText className="w-5 h-5" />
                            Generate Transition Plan
                          </button>
                        </Tooltip>
                      )}
                    </motion.div>
                  )}

                  {/* Show ReAct thinking steps while generating plan */}
                  {(isGeneratingPlan || planStreamingSteps.length > 0) && !dischargePlan && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-6"
                    >
                      <ThinkingSteps
                        steps={planStreamingSteps}
                        isStreaming={isGeneratingPlan}
                        error={planStreamingError}
                        title="Generating Transition Plan"
                      />
                    </motion.div>
                  )}
                </div>

                {/* Right Column - Risk Factors */}
                <div className="bg-white rounded-xl shadow-sm p-6 self-start">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Risk Factors</h3>

                  {!analysis && !isAnalyzing && (
                    <div className="text-center py-12">
                      <p className="text-gray-500">Run analysis to identify risk factors</p>
                    </div>
                  )}

                  {isAnalyzing && (
                    <div className="space-y-3">
                      {analysisStreamingSteps.length > 0 ? (
                        <ThinkingSteps
                          steps={analysisStreamingSteps}
                          isStreaming={true}
                          error={analysisStreamingError}
                          title="Agent Reasoning"
                        />
                      ) : (
                        // Show skeleton loaders before first streaming event arrives
                        [1, 2, 3].map((i) => (
                          <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
                        ))
                      )}
                    </div>
                  )}

                  {analysis && (
                    <div className="space-y-3 max-h-[800px] overflow-y-auto">
                      {analysis.riskFactors.length === 0 ? (
                        <div className="text-center py-8">
                          <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-2" />
                          <p className="text-gray-600">No significant risk factors identified</p>
                        </div>
                      ) : (
                        analysis.riskFactors.map((rf) => (
                          <RiskFactorCard
                            key={rf.id}
                            riskFactor={rf}
                            isExpanded={expandedRiskFactors.has(rf.id)}
                            onToggle={() => toggleRiskFactor(rf.id)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Discharge Plan */}
            <AnimatePresence>
              {dischargePlan && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="bg-white rounded-xl shadow-sm p-6"
                >
                  <DischargePlan
                    plan={dischargePlan}
                    patientName={patient?.name}
                    clinicianEdits={clinicianEdits}
                    onAddCustomItem={addCustomItem}
                    onDismissItem={dismissItem}
                    onRestoreItem={restoreItem}
                    onRemoveCustomItem={removeCustomItem}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Medical Caveats - shown after analysis */}
            {analysis && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <MedicalCaveats />
              </motion.div>
            )}

            {/* Recommendations */}
            {analysis && analysis.recommendations.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl shadow-sm p-6"
              >
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Recommendations</h3>
                <ul className="space-y-2">
                  {analysis.recommendations.map((rec, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-start gap-3"
                    >
                      <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-medium">
                        {i + 1}
                      </span>
                      <span className="text-gray-700">{rec}</span>
                    </motion.li>
                  ))}
                </ul>
              </motion.div>
            )}
          </div>
        )}
          </>
        )}
      </main>

      {/* Safety Footer */}
      <SafetyDisclaimer variant="footer" />

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-center text-sm text-gray-500">
            TransitionIQ - AI-powered discharge readiness assessment
            <span className="mx-2">·</span>
            Built for Encode Club Hackathon
            <span className="mx-2">·</span>
            Multi-model AI with Opik observability
          </p>
        </div>
      </footer>
    </div>
  );
}
