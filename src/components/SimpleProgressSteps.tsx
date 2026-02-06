"use client";

/**
 * SimpleProgressSteps - Fake animated progress for better UX
 *
 * Shows predetermined steps with realistic timing while real work happens in background.
 * Much simpler than SSE streaming - just for visual feedback!
 */

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Database, Brain, Loader2, CheckCircle } from "lucide-react";

interface Step {
  id: string;
  label: string;
  icon: "data" | "llm";
  estimatedMs: number; // Rough timing to show realistic progress
}

interface SimpleProgressStepsProps {
  steps: Step[];
  isActive: boolean;
}

export function SimpleProgressSteps({ steps, isActive }: SimpleProgressStepsProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());
  const [currentStep, setCurrentStep] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      setCompletedSteps(new Set());
      setCurrentStep(null);
      return;
    }

    // Animate through steps with realistic timing
    let timeouts: NodeJS.Timeout[] = [];
    let elapsed = 0;

    steps.forEach((step, index) => {
      // Start this step
      const startTimeout = setTimeout(() => {
        setCurrentStep(step.id);
      }, elapsed);
      timeouts.push(startTimeout);

      // Complete this step
      elapsed += step.estimatedMs;
      const completeTimeout = setTimeout(() => {
        setCompletedSteps(prev => new Set([...prev, step.id]));
        if (index === steps.length - 1) {
          setCurrentStep(null); // All done
        }
      }, elapsed);
      timeouts.push(completeTimeout);
    });

    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, [isActive, steps]);

  if (!isActive && completedSteps.size === 0) {
    return null;
  }

  const getStepIcon = (step: Step) => {
    const isCompleted = completedSteps.has(step.id);
    const isCurrent = currentStep === step.id;

    if (isCompleted) {
      return <CheckCircle className="w-4 h-4 text-green-500" />;
    }
    if (isCurrent) {
      return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    }
    return step.icon === "data" ? (
      <Database className="w-4 h-4 text-gray-400" />
    ) : (
      <Brain className="w-4 h-4 text-gray-400" />
    );
  };

  const getStepBgColor = (step: Step) => {
    const isCompleted = completedSteps.has(step.id);
    const isCurrent = currentStep === step.id;

    if (isCompleted) return "bg-green-50 border-green-200";
    if (isCurrent) return "bg-blue-50 border-blue-200";
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

      {/* Steps */}
      <div className="p-3 space-y-2">
        <AnimatePresence mode="popLayout">
          {steps.map((step) => {
            const isCompleted = completedSteps.has(step.id);
            const isCurrent = currentStep === step.id;
            const isVisible = isCompleted || isCurrent;

            if (!isVisible) return null;

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className={`flex items-center gap-2 p-2 rounded border ${getStepBgColor(step)}`}
              >
                <div className="flex-shrink-0">{getStepIcon(step)}</div>
                <span className="text-sm text-gray-700">{step.label}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/**
 * Predefined step sequences for different operations
 */
export const ANALYSIS_STEPS: Step[] = [
  { id: "fda", label: "Checking drug interactions (FDA)", icon: "data", estimatedMs: 1200 },
  { id: "guidelines", label: "Evaluating care gaps", icon: "data", estimatedMs: 800 },
  { id: "cms", label: "Estimating medication costs (CMS)", icon: "data", estimatedMs: 1500 },
  { id: "llm", label: "Analyzing discharge readiness", icon: "llm", estimatedMs: 3000 },
];

export const PLAN_GENERATION_STEPS: Step[] = [
  { id: "generate", label: "Generating discharge checklist", icon: "llm", estimatedMs: 2800 },
];
