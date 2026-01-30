"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Scale,
  ShieldCheck,
  Target,
  CheckSquare,
  FileCheck,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
} from "lucide-react";

export interface JudgeEvaluation {
  safety: { score: number; reasoning: string };
  accuracy: { score: number; reasoning: string };
  actionability: { score: number; reasoning: string };
  completeness: { score: number; reasoning: string };
  overall: number;
}

interface JudgeScoreBadgeProps {
  evaluation: JudgeEvaluation | null;
  isLoading?: boolean;
  error?: string | null;
  compact?: boolean;
}

export function JudgeScoreBadge({
  evaluation,
  isLoading = false,
  error = null,
  compact = false,
}: JudgeScoreBadgeProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  function getScoreColor(score: number) {
    if (score >= 0.7) return "text-emerald-600";
    if (score >= 0.5) return "text-amber-600";
    return "text-red-600";
  }

  function getScoreBgColor(score: number) {
    if (score >= 0.7) return "bg-emerald-50 border-emerald-200";
    if (score >= 0.5) return "bg-amber-50 border-amber-200";
    return "bg-red-50 border-red-200";
  }

  const passesSafety = evaluation && evaluation.safety.score >= 0.7;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        <span className="text-sm text-gray-600">Running quality check...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
        <span className="text-sm text-amber-700">Quality check unavailable</span>
      </div>
    );
  }

  if (!evaluation) {
    return null;
  }

  // Detect failed evaluation (all zeros with error in reasoning)
  if (evaluation.overall === 0 && evaluation.safety?.reasoning?.startsWith("Evaluation failed")) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <div className="min-w-0">
          <span className="text-sm text-amber-700 font-medium">Quality check failed</span>
          <p className="text-xs text-amber-600 mt-0.5 truncate">{evaluation.safety.reasoning}</p>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${getScoreBgColor(evaluation.overall)}`}
      >
        <Scale className="w-4 h-4 text-gray-600" />
        <span className="text-sm font-medium text-gray-700">Quality:</span>
        <span className={`font-bold ${getScoreColor(evaluation.overall)}`}>
          {(evaluation.overall * 100).toFixed(0)}%
        </span>
        {passesSafety ? (
          <CheckCircle className="w-4 h-4 text-emerald-500" />
        ) : (
          <XCircle className="w-4 h-4 text-red-500" />
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border overflow-hidden ${getScoreBgColor(evaluation.overall)}`}
    >
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Scale className="w-5 h-5 text-amber-600" />
          <div className="text-left">
            <p className="font-semibold text-gray-900">AI Quality Assessment</p>
            <p className="text-xs text-gray-500">LLM-as-Judge evaluation</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Overall Score */}
          <div className="text-right">
            <p className="text-xs text-gray-500">Overall</p>
            <p className={`text-xl font-bold ${getScoreColor(evaluation.overall)}`}>
              {(evaluation.overall * 100).toFixed(0)}%
            </p>
          </div>

          {/* Safety Badge */}
          {passesSafety ? (
            <div className="flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
              <ShieldCheck className="w-3 h-3" />
              Safe
            </div>
          ) : (
            <div className="flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full text-xs font-medium">
              <AlertTriangle className="w-3 h-3" />
              Review
            </div>
          )}

          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-gray-200"
          >
            <div className="p-4 space-y-4 bg-white/50">
              {/* Dimension Scores */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <ShieldCheck className="w-4 h-4" />
                    <span className="text-xs font-medium">Safety (40%)</span>
                  </div>
                  <p className={`text-lg font-bold ${getScoreColor(evaluation.safety.score)}`}>
                    {(evaluation.safety.score * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <Target className="w-4 h-4" />
                    <span className="text-xs font-medium">Accuracy (25%)</span>
                  </div>
                  <p className={`text-lg font-bold ${getScoreColor(evaluation.accuracy.score)}`}>
                    {(evaluation.accuracy.score * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <CheckSquare className="w-4 h-4" />
                    <span className="text-xs font-medium">Actionable (20%)</span>
                  </div>
                  <p className={`text-lg font-bold ${getScoreColor(evaluation.actionability.score)}`}>
                    {(evaluation.actionability.score * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 shadow-sm">
                  <div className="flex items-center gap-2 text-gray-600 mb-1">
                    <FileCheck className="w-4 h-4" />
                    <span className="text-xs font-medium">Complete (15%)</span>
                  </div>
                  <p className={`text-lg font-bold ${getScoreColor(evaluation.completeness.score)}`}>
                    {(evaluation.completeness.score * 100).toFixed(0)}%
                  </p>
                </div>
              </div>

              {/* Reasoning */}
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">Judge Reasoning</h4>
                <div className="space-y-2 text-sm">
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <p className="font-medium text-gray-700 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" /> Safety
                    </p>
                    <p className="text-gray-600 mt-1">{evaluation.safety.reasoning}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <p className="font-medium text-gray-700 flex items-center gap-1">
                      <Target className="w-3 h-3" /> Accuracy
                    </p>
                    <p className="text-gray-600 mt-1">{evaluation.accuracy.reasoning}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <p className="font-medium text-gray-700 flex items-center gap-1">
                      <CheckSquare className="w-3 h-3" /> Actionability
                    </p>
                    <p className="text-gray-600 mt-1">{evaluation.actionability.reasoning}</p>
                  </div>
                  <div className="bg-white rounded-lg p-3 shadow-sm">
                    <p className="font-medium text-gray-700 flex items-center gap-1">
                      <FileCheck className="w-3 h-3" /> Completeness
                    </p>
                    <p className="text-gray-600 mt-1">{evaluation.completeness.reasoning}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
