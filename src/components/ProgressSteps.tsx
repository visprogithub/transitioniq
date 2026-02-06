"use client";

/**
 * ProgressSteps - Shows deterministic API/LLM operations in real-time
 *
 * Similar to ReAct thinking steps but for deterministic workflows:
 * - Data sources being called (FDA, CMS, Guidelines)
 * - LLM operations (analysis, plan generation)
 * - Tool executions (patient coach)
 *
 * Auto-scrolls, shows checkmarks when complete, displays errors.
 */

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database,
  Brain,
  Wrench,
  Loader2,
  CheckCircle,
  XCircle,
  Clock
} from "lucide-react";

export interface ProgressStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "error";
  type: "data_source" | "llm" | "tool";
  detail?: string;
  timestamp?: number;
}

interface ProgressStepsProps {
  steps: ProgressStep[];
  isActive: boolean;
  error?: string | null;
  title?: string;
}

export function ProgressSteps({
  steps,
  isActive,
  error,
  title = "Processing",
}: ProgressStepsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new steps arrive
  useEffect(() => {
    if (containerRef.current && steps.length > 0) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [steps]);

  // Don't render if no steps and not active
  if (steps.length === 0 && !isActive) {
    return null;
  }

  const getStepIcon = (step: ProgressStep) => {
    if (step.status === "error") {
      return <XCircle className="w-4 h-4 text-red-500" />;
    }
    if (step.status === "completed") {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    if (step.status === "in_progress") {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    }

    // Pending - show type icon
    switch (step.type) {
      case "data_source":
        return <Database className="w-4 h-4 text-gray-400" />;
      case "llm":
        return <Brain className="w-4 h-4 text-gray-400" />;
      case "tool":
        return <Wrench className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStepBgColor = (step: ProgressStep) => {
    if (step.status === "error") return "bg-red-50 border-red-200";
    if (step.status === "completed") return "bg-green-50 border-green-200";
    if (step.status === "in_progress") return "bg-blue-50 border-blue-200";
    return "bg-gray-50 border-gray-200";
  };

  const completedCount = steps.filter((s) => s.status === "completed").length;
  const errorCount = steps.filter((s) => s.status === "error").length;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="mb-4 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 border-b border-gray-200">
        <div className="flex items-center gap-2">
          {isActive ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          ) : error || errorCount > 0 ? (
            <XCircle className="w-4 h-4 text-red-500" />
          ) : (
            <CheckCircle className="w-4 h-4 text-green-500" />
          )}
          <span className="text-sm font-medium text-gray-700">
            {title}
            {isActive && " in progress..."}
            {error && " failed"}
            {!isActive && !error && steps.length > 0 && " complete"}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {completedCount}/{steps.length} steps
          {errorCount > 0 && ` (${errorCount} error${errorCount > 1 ? "s" : ""})`}
        </span>
      </div>

      {/* Steps container */}
      <div
        ref={containerRef}
        className="max-h-64 overflow-y-auto p-3 space-y-2"
      >
        <AnimatePresence mode="popLayout">
          {steps.map((step) => (
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className={`flex items-start gap-2 p-2 rounded border ${getStepBgColor(step)}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {getStepIcon(step)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 font-medium">
                    {step.label}
                  </span>
                  {step.timestamp && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDuration(step.timestamp)}
                    </span>
                  )}
                </div>
                {step.detail && (
                  <p className="text-xs text-gray-600 mt-1">
                    {step.detail}
                  </p>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading indicator for active operations */}
        {isActive && steps.filter((s) => s.status === "in_progress").length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 p-2 text-sm text-gray-600"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Processing...</span>
          </motion.div>
        )}

        {/* Error message */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="p-2 rounded bg-red-50 border border-red-200 text-sm text-red-700"
          >
            {error}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Format milliseconds duration to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}
