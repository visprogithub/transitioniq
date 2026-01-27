"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Users, RefreshCw, ChevronDown, Sparkles, FileText, CheckCircle, FlaskConical, LayoutDashboard, Cpu, AlertTriangle, Heart } from "lucide-react";
import { PatientHeader } from "@/components/PatientHeader";
import { DischargeScore } from "@/components/DischargeScore";
import { RiskFactorCard } from "@/components/RiskFactorCard";
import { EvaluationDashboard } from "@/components/EvaluationDashboard";
import { PatientRecoveryCoach } from "@/components/PatientRecoveryCoach";
import { SafetyDisclaimer, MedicalCaveats, ResponsibleAIBadge } from "@/components/SafetyDisclaimer";
import { ModelSelector } from "@/components/ModelSelector";
import { DischargePlan } from "@/components/DischargePlan";
import { Tooltip } from "@/components/Tooltip";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis, RiskFactor } from "@/lib/types/analysis";

// Extended analysis type with model and agent info
interface AnalysisWithModel extends DischargeAnalysis {
  modelUsed?: string;
  agentUsed?: boolean;
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
  const [expandedRiskFactors, setExpandedRiskFactors] = useState<Set<string>>(new Set());
  const [modelLimitError, setModelLimitError] = useState<{
    modelId: string;
    provider: string;
    availableModels: string[];
  } | null>(null);

  // Load patient data when selection changes
  useEffect(() => {
    if (!selectedPatientId) return;

    async function loadPatient() {
      setIsLoadingPatient(true);
      setError(null);
      setAnalysis(null);
      setDischargePlan(null);

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

  // Run discharge analysis
  async function runAnalysis() {
    if (!patient) return;

    setIsAnalyzing(true);
    setError(null);
    setModelLimitError(null);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id }),
      });

      const data = await response.json();

      // Check for rate limit / usage limit error
      if (response.status === 429 && data.suggestModelSwitch) {
        setModelLimitError({
          modelId: data.modelId,
          provider: data.provider,
          availableModels: data.availableModels || [],
        });
        setIsAnalyzing(false);
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed");
      }

      setAnalysis(data);

      // Auto-expand high-severity risk factors
      const highRiskIds = new Set<string>(
        data.riskFactors
          .filter((rf: RiskFactor) => rf.severity === "high")
          .map((rf: RiskFactor) => rf.id)
      );
      setExpandedRiskFactors(highRiskIds);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }

  // Generate discharge plan
  async function generatePlan() {
    if (!patient || !analysis) return;

    setIsGeneratingPlan(true);
    setError(null);

    try {
      const response = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId: patient.id, analysis }),
      });

      if (!response.ok) throw new Error("Plan generation failed");
      const data = await response.json();
      setDischargePlan(data.plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan generation failed");
    } finally {
      setIsGeneratingPlan(false);
    }
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-3">
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

              {/* Tab Navigation */}
              <nav className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                <Tooltip content="Clinical discharge readiness assessment" position="bottom">
                  <button
                    onClick={() => setActiveTab("dashboard")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === "dashboard"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <LayoutDashboard className="w-4 h-4" />
                    Clinical
                  </button>
                </Tooltip>
                <Tooltip content="Patient-friendly recovery guidance" position="bottom">
                  <button
                    onClick={() => setActiveTab("patient")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === "patient"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <Heart className="w-4 h-4" />
                    Patient View
                  </button>
                </Tooltip>
                <Tooltip content="Test and compare AI models" position="bottom">
                  <button
                    onClick={() => setActiveTab("evaluation")}
                    className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                      activeTab === "evaluation"
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-600 hover:text-gray-900"
                    }`}
                  >
                    <FlaskConical className="w-4 h-4" />
                    Evaluation
                  </button>
                </Tooltip>
              </nav>
            </div>

            {/* Model Selector and Patient Selector */}
            <div className="flex items-center gap-3">
              {/* Model Selector - always visible */}
              <ModelSelector
                onModelChange={(modelId) => {
                  setCurrentModel(modelId);
                  // Clear analysis when model changes so user re-runs with new model
                  if (analysis) {
                    setAnalysis(null);
                    setDischargePlan(null);
                  }
                }}
              />

              {/* Patient Selector - show on dashboard and patient tabs */}
              {(activeTab === "dashboard" || activeTab === "patient") && (
                <div className="relative">
                  <Tooltip content="Select a demo patient to analyze" position="bottom">
                    <button
                      onClick={() => setShowPatientDropdown(!showPatientDropdown)}
                      className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                    >
                      <Users className="w-4 h-4 text-gray-600" />
                      <span className="text-sm font-medium text-gray-700">
                        {patient ? patient.name : "Select Patient"}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showPatientDropdown ? "rotate-180" : ""}`} />
                    </button>
                  </Tooltip>

                  <AnimatePresence>
                    {showPatientDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50"
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

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Evaluation Tab */}
        {activeTab === "evaluation" && <EvaluationDashboard />}

        {/* Patient View Tab */}
        {activeTab === "patient" && (
          <PatientRecoveryCoach
            patient={patient}
            analysis={analysis}
            isLoading={isLoadingPatient}
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
                    <h3 className="text-lg font-semibold text-gray-900">Discharge Readiness Score</h3>
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
                        score={analysis?.score || 0}
                        status={analysis?.status || "caution"}
                        isLoading={isAnalyzing}
                      />
                      {/* Show model and agent info */}
                      {analysis?.modelUsed && (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                            <Cpu className="w-4 h-4" />
                            <span>Analyzed with: <span className="font-medium text-gray-700">{analysis.modelUsed}</span></span>
                          </div>
                          {analysis.agentUsed && (
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
                        </motion.div>
                      )}
                    </>
                  )}

                  {/* Generate Plan Button */}
                  {analysis && !isGeneratingPlan && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mt-6 text-center"
                    >
                      <Tooltip content="Create an actionable checklist based on risk factors" position="top">
                        <button
                          onClick={generatePlan}
                          disabled={isGeneratingPlan}
                          className="flex items-center gap-2 mx-auto px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white rounded-lg font-medium hover:from-emerald-600 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg"
                        >
                          <FileText className="w-5 h-5" />
                          Generate Discharge Plan
                        </button>
                      </Tooltip>
                    </motion.div>
                  )}

                  {isGeneratingPlan && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="mt-6 text-center"
                    >
                      <RefreshCw className="w-6 h-6 text-emerald-500 animate-spin mx-auto mb-2" />
                      <p className="text-sm text-gray-500">Generating discharge plan...</p>
                    </motion.div>
                  )}
                </div>

                {/* Right Column - Risk Factors */}
                <div className="bg-white rounded-xl shadow-sm p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Risk Factors</h3>

                  {!analysis && !isAnalyzing && (
                    <div className="text-center py-12">
                      <p className="text-gray-500">Run analysis to identify risk factors</p>
                    </div>
                  )}

                  {isAnalyzing && (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
                      ))}
                    </div>
                  )}

                  {analysis && (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
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
