"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  BarChart3,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Cloud,
  FlaskConical,
} from "lucide-react";

interface ModelSummary {
  avgScore: number;
  avgLatency: number;
  passRate: number;
  errorCount: number;
}

interface EvalResult {
  model: string;
  patient: string;
  analysis: {
    score: number;
    status: string;
    riskFactors: Array<{ severity: string; title: string }>;
  } | null;
  error?: string;
  latencyMs: number;
  scores: {
    scoreAccuracy: number;
    statusMatch: boolean;
    overall: number;
  } | null;
}

interface EvalResponse {
  experimentName: string;
  models: string[];
  patients: string[];
  results: EvalResult[];
  modelSummaries: Record<string, ModelSummary>;
  opikDashboardUrl: string | null;
}

interface ModelInfo {
  id: string;
  provider: string;
  available: boolean;
  displayName: string;
}

interface ModelsInfo {
  availableModels: string[];
  allModels: ModelInfo[];
  configuredProviders: string[];
  activeModel: string;
  testPatients: string[];
  apiKeyStatus: {
    gemini: boolean;
    groq: boolean;
    huggingface: boolean;
    openai: boolean;
    anthropic: boolean;
  };
}

interface OpikExperimentResult {
  experimentId: string;
  experimentName: string;
  opikDashboardUrl: string;
  summary: {
    totalCases: number;
    passedCases: number;
    passRate: number;
    avgScore: number;
    avgLatencyMs: number;
  };
  results: Array<{
    patientId: string;
    score: number;
    status: string;
    riskFactorCount: number;
    highRiskCount: number;
    scores: {
      scoreAccuracy: number;
      statusCorrectness: number;
      riskFactorCoverage: number;
      overall: number;
    };
    passed: boolean;
    latencyMs: number;
  }>;
}

export function EvaluationDashboard() {
  const [modelsInfo, setModelsInfo] = useState<ModelsInfo | null>(null);
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [evalResults, setEvalResults] = useState<EvalResponse | null>(null);
  const [isRunningEval, setIsRunningEval] = useState(false);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [experimentName, setExperimentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [isRunningOpikExperiment, setIsRunningOpikExperiment] = useState(false);
  const [opikExperimentResult, setOpikExperimentResult] = useState<OpikExperimentResult | null>(null);
  const [opikError, setOpikError] = useState<string | null>(null);

  // Load available models
  async function loadModelsInfo() {
    setIsLoadingInfo(true);
    setError(null);
    try {
      const response = await fetch("/api/evaluate/models");
      if (!response.ok) throw new Error("Failed to load models info");
      const data = await response.json();
      setModelsInfo(data);
      setSelectedModels(data.availableModels);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setIsLoadingInfo(false);
    }
  }

  // Run evaluation experiment
  async function runEvaluation() {
    setIsRunningEval(true);
    setError(null);
    setEvalResults(null);

    try {
      const response = await fetch("/api/evaluate/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          models: selectedModels.length > 0 ? selectedModels : undefined,
          experimentName: experimentName || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Evaluation failed");
      }

      const data = await response.json();
      setEvalResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed");
    } finally {
      setIsRunningEval(false);
    }
  }

  // Run Opik cloud experiment
  async function runOpikExperiment() {
    setIsRunningOpikExperiment(true);
    setOpikError(null);
    setOpikExperimentResult(null);

    try {
      const response = await fetch("/api/experiments/opik", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experimentName: experimentName || `opik-experiment-${Date.now()}`,
          modelId: selectedModels.length > 0 ? selectedModels[0] : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Opik experiment failed");
      }

      const data = await response.json();
      setOpikExperimentResult(data);
    } catch (err) {
      setOpikError(err instanceof Error ? err.message : "Opik experiment failed");
    } finally {
      setIsRunningOpikExperiment(false);
    }
  }

  // Toggle model selection
  function toggleModel(modelId: string) {
    setSelectedModels((prev) =>
      prev.includes(modelId)
        ? prev.filter((m) => m !== modelId)
        : [...prev, modelId]
    );
  }

  // Toggle result expansion
  function toggleResult(key: string) {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Get status color
  function getStatusColor(status: string) {
    switch (status) {
      case "ready":
        return "text-emerald-600 bg-emerald-50";
      case "caution":
        return "text-amber-600 bg-amber-50";
      case "not_ready":
        return "text-red-600 bg-red-50";
      default:
        return "text-gray-600 bg-gray-50";
    }
  }

  // Get score color
  function getScoreColor(score: number) {
    if (score >= 0.7) return "text-emerald-600";
    if (score >= 0.5) return "text-amber-600";
    return "text-red-600";
  }

  // Get provider color and label
  function getProviderStyle(provider: string) {
    switch (provider) {
      case "gemini":
        return { bg: "bg-blue-100", text: "text-blue-700", label: "Gemini" };
      case "groq":
        return { bg: "bg-orange-100", text: "text-orange-700", label: "Groq" };
      case "huggingface":
        return { bg: "bg-yellow-100", text: "text-yellow-700", label: "HF" };
      case "openai":
        return { bg: "bg-green-100", text: "text-green-700", label: "OpenAI" };
      case "anthropic":
        return { bg: "bg-purple-100", text: "text-purple-700", label: "Claude" };
      default:
        return { bg: "bg-gray-100", text: "text-gray-700", label: provider };
    }
  }

  // Get provider from model ID
  function getProviderFromModel(modelId: string): string {
    const modelInfo = modelsInfo?.allModels.find((m) => m.id === modelId);
    return modelInfo?.provider || "unknown";
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Model Evaluation</h2>
          <p className="text-gray-500 mt-1">
            Compare LLM models and track results in Opik
          </p>
        </div>
        {/* Note: Opik dashboard URL links to generic experiments page, not specific experiment
            Hiding for now - users should navigate to Opik dashboard manually */}
      </div>

      {/* Error Banner */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700"
          >
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Setup Section */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Experiment Setup
        </h3>

        {/* Load Models Button */}
        {!modelsInfo && (
          <button
            onClick={loadModelsInfo}
            disabled={isLoadingInfo}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {isLoadingInfo ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Zap className="w-4 h-4" />
            )}
            {isLoadingInfo ? "Loading..." : "Load Available Models"}
          </button>
        )}

        {/* Model Selection */}
        {modelsInfo && (
          <div className="space-y-4">
            {/* Experiment Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Experiment Name (optional)
              </label>
              <input
                type="text"
                value={experimentName}
                onChange={(e) => setExperimentName(e.target.value)}
                placeholder="e.g., model-comparison-v1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* API Key Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Configured Providers
              </label>
              <div className="flex flex-wrap gap-2">
                {Object.entries(modelsInfo.apiKeyStatus).map(([provider, isConfigured]) => {
                  const style = getProviderStyle(provider);
                  return (
                    <span
                      key={provider}
                      className={`px-3 py-1 rounded-lg text-sm font-medium flex items-center gap-1.5 ${
                        isConfigured
                          ? `${style.bg} ${style.text}`
                          : "bg-gray-100 text-gray-400"
                      }`}
                    >
                      {isConfigured ? (
                        <CheckCircle className="w-3.5 h-3.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      {style.label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Model Checkboxes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Models to Evaluate ({modelsInfo.availableModels.length} available)
              </label>
              <div className="flex flex-wrap gap-2">
                {modelsInfo.availableModels.map((model) => {
                  const provider = getProviderFromModel(model);
                  const providerStyle = getProviderStyle(provider);
                  return (
                    <label
                      key={model}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                        selectedModels.includes(model)
                          ? "bg-blue-50 border-blue-300 text-blue-700"
                          : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedModels.includes(model)}
                        onChange={() => toggleModel(model)}
                        className="sr-only"
                      />
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${providerStyle.bg} ${providerStyle.text}`}
                      >
                        {providerStyle.label}
                      </span>
                      <span className="text-sm font-medium">{model}</span>
                      {model === modelsInfo.activeModel && (
                        <span className="text-xs bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded">
                          active
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
              {modelsInfo.availableModels.length === 0 && (
                <p className="text-sm text-amber-600 mt-2">
                  No API keys configured. Add at least one of: GEMINI_API_KEY, GROQ_API_KEY, HF_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY
                </p>
              )}
            </div>

            {/* Test Patients Info */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Test Patients
              </label>
              <div className="flex flex-wrap gap-2">
                {modelsInfo.testPatients.map((patient) => (
                  <span
                    key={patient}
                    className="px-3 py-1 bg-gray-100 text-gray-600 rounded-lg text-sm"
                  >
                    {patient}
                  </span>
                ))}
              </div>
            </div>

            {/* Run Buttons */}
            <div className="pt-4 space-y-4">
              <div className="flex flex-wrap gap-4">
                {/* Local Evaluation Button */}
                <button
                  onClick={runEvaluation}
                  disabled={isRunningEval || selectedModels.length === 0}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-purple-700 text-white rounded-lg font-medium hover:from-purple-700 hover:to-purple-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunningEval ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <Play className="w-5 h-5" />
                  )}
                  {isRunningEval ? "Running Evaluation..." : "Run Local Evaluation"}
                </button>

                {/* Opik Cloud Experiment Button */}
                <button
                  onClick={runOpikExperiment}
                  disabled={isRunningOpikExperiment || selectedModels.length === 0}
                  className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-lg font-medium hover:from-blue-700 hover:to-indigo-800 transition-all shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isRunningOpikExperiment ? (
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  ) : (
                    <FlaskConical className="w-5 h-5" />
                  )}
                  {isRunningOpikExperiment ? "Running Opik Experiment..." : "Run Opik Cloud Experiment"}
                </button>
              </div>

              {selectedModels.length === 0 && (
                <p className="text-sm text-amber-600">
                  Select at least one model to evaluate
                </p>
              )}

              {/* Opik Error */}
              {opikError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <p className="font-medium">Opik Experiment Error</p>
                  <p>{opikError}</p>
                </div>
              )}

              {/* Opik Experiment Result */}
              {opikExperimentResult && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Cloud className="w-5 h-5 text-blue-600" />
                      <span className="font-semibold text-blue-900">
                        Opik Cloud Experiment Complete
                      </span>
                    </div>
                    {/* Note: Opik dashboard URL links to generic experiments page, not specific experiment
                        Users should navigate to comet.com/opik manually to see detailed experiment results */}
                    <span className="text-xs text-blue-600 italic">
                      View detailed results at comet.com/opik
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-blue-600 font-medium">Experiment</p>
                      <p className="text-blue-900">{opikExperimentResult.experimentName}</p>
                    </div>
                    <div>
                      <p className="text-blue-600 font-medium">Pass Rate</p>
                      <p className="text-blue-900">{(opikExperimentResult.summary.passRate * 100).toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-blue-600 font-medium">Test Cases</p>
                      <p className="text-blue-900">
                        {opikExperimentResult.summary.passedCases}/{opikExperimentResult.summary.totalCases} passed
                      </p>
                    </div>
                    <div>
                      <p className="text-blue-600 font-medium">Avg Score</p>
                      <p className={`font-bold ${getScoreColor(opikExperimentResult.summary.avgScore)}`}>
                        {(opikExperimentResult.summary.avgScore * 100).toFixed(1)}%
                      </p>
                    </div>
                  </div>
                  {/* Individual Results */}
                  {opikExperimentResult.results && opikExperimentResult.results.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-blue-200">
                      <p className="text-blue-600 font-medium mb-2">Test Case Results:</p>
                      <div className="space-y-2">
                        {opikExperimentResult.results.map((result) => (
                          <div
                            key={result.patientId}
                            className={`flex items-center justify-between p-2 rounded-lg ${
                              result.passed ? "bg-green-50" : "bg-red-50"
                            }`}
                          >
                            <span className="text-sm font-medium">{result.patientId}</span>
                            <div className="flex items-center gap-4 text-sm">
                              <span>Score: {result.score}</span>
                              <span>Status: {result.status}</span>
                              <span className={result.passed ? "text-green-600" : "text-red-600"}>
                                {result.passed ? "✓ PASS" : "✗ FAIL"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Results Section */}
      {evalResults && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(evalResults.modelSummaries).map(
              ([modelId, summary]) => {
                const provider = getProviderFromModel(modelId);
                const providerStyle = getProviderStyle(provider);
                return (
                <div
                  key={modelId}
                  className="bg-white rounded-xl shadow-sm p-6"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <span
                      className={`text-xs px-2 py-1 rounded ${providerStyle.bg} ${providerStyle.text}`}
                    >
                      {providerStyle.label}
                    </span>
                    <h4 className="font-semibold text-gray-900">
                      {modelId}
                    </h4>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-sm">Avg Score</span>
                      <span
                        className={`font-bold ${getScoreColor(summary.avgScore)}`}
                      >
                        {(summary.avgScore * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-sm">Pass Rate</span>
                      <span
                        className={`font-bold ${getScoreColor(summary.passRate)}`}
                      >
                        {(summary.passRate * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-500 text-sm">Avg Latency</span>
                      <span className="font-medium text-gray-700">
                        {summary.avgLatency.toFixed(0)}ms
                      </span>
                    </div>
                    {summary.errorCount > 0 && (
                      <div className="flex items-center justify-between">
                        <span className="text-gray-500 text-sm">Errors</span>
                        <span className="font-medium text-red-600">
                          {summary.errorCount}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
              }
            )}
          </div>

          {/* Detailed Results */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Detailed Results
            </h3>
            <div className="space-y-2">
              {evalResults.results.map((result, idx) => {
                const key = `${result.model}-${result.patient}-${idx}`;
                const isExpanded = expandedResults.has(key);
                const provider = getProviderFromModel(result.model);
                const providerStyle = getProviderStyle(provider);

                return (
                  <div
                    key={key}
                    className="border border-gray-200 rounded-lg overflow-hidden"
                  >
                    {/* Result Header */}
                    <button
                      onClick={() => toggleResult(key)}
                      className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-gray-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${providerStyle.bg} ${providerStyle.text}`}
                          >
                            {providerStyle.label}
                          </span>
                          <span className="font-medium text-gray-900">
                            {result.model}
                          </span>
                          <span className="mx-1 text-gray-400">→</span>
                          <span className="text-gray-600">{result.patient}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {result.error ? (
                          <span className="flex items-center gap-1 text-red-600">
                            <XCircle className="w-4 h-4" />
                            Error
                          </span>
                        ) : result.scores ? (
                          <>
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(result.analysis?.status || "")}`}
                            >
                              {result.analysis?.status}
                            </span>
                            <span
                              className={`font-bold ${getScoreColor(result.scores.overall)}`}
                            >
                              {(result.scores.overall * 100).toFixed(0)}%
                            </span>
                            {result.scores.overall >= 0.7 ? (
                              <CheckCircle className="w-5 h-5 text-emerald-500" />
                            ) : (
                              <XCircle className="w-5 h-5 text-red-500" />
                            )}
                          </>
                        ) : null}
                        <span className="flex items-center gap-1 text-gray-500 text-sm">
                          <Clock className="w-4 h-4" />
                          {result.latencyMs}ms
                        </span>
                      </div>
                    </button>

                    {/* Expanded Details */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="border-t border-gray-200 bg-gray-50"
                        >
                          <div className="p-4 space-y-4">
                            {result.error ? (
                              <div className="text-red-600 bg-red-50 p-3 rounded-lg">
                                {result.error}
                              </div>
                            ) : result.analysis ? (
                              <>
                                {/* Analysis Score */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                  <div>
                                    <p className="text-xs text-gray-500">
                                      Discharge Score
                                    </p>
                                    <p className="text-lg font-bold text-gray-900">
                                      {result.analysis.score}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">
                                      Score Accuracy
                                    </p>
                                    <p
                                      className={`text-lg font-bold ${getScoreColor(result.scores?.scoreAccuracy || 0)}`}
                                    >
                                      {((result.scores?.scoreAccuracy || 0) * 100).toFixed(0)}%
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">
                                      Status Match
                                    </p>
                                    <p className="text-lg font-bold">
                                      {result.scores?.statusMatch ? (
                                        <span className="text-emerald-600">Yes</span>
                                      ) : (
                                        <span className="text-red-600">No</span>
                                      )}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-xs text-gray-500">
                                      Risk Factors
                                    </p>
                                    <p className="text-lg font-bold text-gray-900">
                                      {result.analysis.riskFactors.length}
                                    </p>
                                  </div>
                                </div>

                                {/* Risk Factors */}
                                {result.analysis.riskFactors.length > 0 && (
                                  <div>
                                    <p className="text-xs text-gray-500 mb-2">
                                      Risk Factors Found
                                    </p>
                                    <div className="flex flex-wrap gap-2">
                                      {result.analysis.riskFactors.map(
                                        (rf, i) => (
                                          <span
                                            key={i}
                                            className={`px-2 py-1 rounded text-xs ${
                                              rf.severity === "high"
                                                ? "bg-red-100 text-red-700"
                                                : rf.severity === "moderate"
                                                  ? "bg-amber-100 text-amber-700"
                                                  : "bg-gray-100 text-gray-700"
                                            }`}
                                          >
                                            {rf.title}
                                          </span>
                                        )
                                      )}
                                    </div>
                                  </div>
                                )}
                              </>
                            ) : null}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Experiment Info */}
          <div className="bg-gray-100 rounded-xl p-4 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              <span>
                Experiment: <strong>{evalResults.experimentName}</strong>
              </span>
              <span className="mx-2">·</span>
              <span>
                {evalResults.results.length} evaluations across{" "}
                {evalResults.models.length} models
              </span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
