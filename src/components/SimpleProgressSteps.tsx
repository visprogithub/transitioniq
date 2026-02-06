"use client";

/**
 * SimpleProgressSteps - Fake animated progress for better UX
 *
 * Shows predetermined steps with realistic timing while real work happens in background.
 * Much simpler than SSE streaming - just for visual feedback!
 */

import { motion } from "framer-motion";
import { Database, Brain, Loader2, CheckCircle } from "lucide-react";

interface Step {
  id: string;
  label: string;
  icon: "data" | "llm";
}

interface SimpleProgressStepsProps {
  steps: Step[];
  isActive: boolean;
}

export function SimpleProgressSteps({ steps, isActive }: SimpleProgressStepsProps) {
  // Show all steps as in-progress while active, completed when done
  // No timers - just reflects the overall analysis state
  const completedSteps = isActive ? new Set<string>() : new Set(steps.map(s => s.id));

  if (!isActive && completedSteps.size === 0) {
    return null;
  }

  const getStepIcon = (step: Step) => {
    const isCompleted = completedSteps.has(step.id);

    if (isCompleted) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    // Show as in-progress while active
    if (isActive) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    }
    // Show type icon otherwise
    return step.icon === "data" ? (
      <Database className="w-4 h-4 text-gray-400" />
    ) : (
      <Brain className="w-4 h-4 text-gray-400" />
    );
  };

  const getStepBgColor = (step: Step) => {
    const isCompleted = completedSteps.has(step.id);

    if (isCompleted) return "bg-green-50 border-green-200";
    if (isActive) return "bg-blue-50 border-blue-200"; // In progress
    return "bg-gray-50 border-gray-200";
  };

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
          ) : (
            <CheckCircle className="w-4 h-4 text-green-500" />
          )}
          <span className="text-sm font-medium text-gray-700">
            {isActive ? "Processing..." : "Complete"}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {completedSteps.size}/{steps.length} steps
        </span>
      </div>

      {/* Steps - show all at once, no animation */}
      <div className="p-3 space-y-2">
        {steps.map((step) => (
          <div
            key={step.id}
            className={`flex items-center gap-2 p-2 rounded border ${getStepBgColor(step)}`}
          >
            <div className="flex-shrink-0">{getStepIcon(step)}</div>
            <span className="text-sm text-gray-700">{step.label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

/**
 * Predefined step sequences for different operations
 * These mirror the actual server-side operations in the console logs
 */
export const ANALYSIS_STEPS: Step[] = [
  { id: "fda", label: "Checking drug interactions (FDA)", icon: "data" },
  { id: "guidelines", label: "Evaluating care gaps", icon: "data" },
  { id: "cms", label: "Estimating medication costs (CMS)", icon: "data" },
  { id: "llm", label: "Analyzing discharge readiness", icon: "llm" },
];

export const PLAN_GENERATION_STEPS: Step[] = [
  { id: "generate", label: "Generating discharge checklist", icon: "llm" },
];

export const PATIENT_CHAT_STEPS: Step[] = [
  { id: "detect", label: "Understanding your question", icon: "llm" },
  { id: "execute", label: "Looking up information", icon: "data" },
  { id: "respond", label: "Preparing response", icon: "llm" },
];
