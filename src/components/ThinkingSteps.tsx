"use client";

/**
 * ThinkingSteps - Displays ReAct reasoning steps in real-time
 *
 * Shows the LLM's thinking process as it reasons through a problem:
 * - Thoughts (brain icon): What the LLM is considering
 * - Actions (tool icon): Tools being called
 * - Observations (eye icon): Results from tools
 *
 * Auto-scrolls to show latest step, collapses when complete.
 */

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Wrench, Eye, Loader2, CheckCircle, XCircle } from "lucide-react";
import type { ReActStep } from "@/hooks/useReActStream";

interface ThinkingStepsProps {
  steps: ReActStep[];
  isStreaming: boolean;
  error?: string | null;
  title?: string;
}

export function ThinkingSteps({
  steps,
  isStreaming,
  error,
  title = "Reasoning",
}: ThinkingStepsProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new steps arrive
  useEffect(() => {
    if (containerRef.current && steps.length > 0) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [steps]);

  // Don't render if no steps and not streaming
  if (steps.length === 0 && !isStreaming) {
    return null;
  }

  const getStepIcon = (type: ReActStep["type"]) => {
    switch (type) {
      case "thought":
        return <Brain className="w-4 h-4 text-purple-500" />;
      case "action":
        return <Wrench className="w-4 h-4 text-blue-500" />;
      case "observation":
        return <Eye className="w-4 h-4 text-green-500" />;
    }
  };

  const getStepLabel = (type: ReActStep["type"]) => {
    switch (type) {
      case "thought":
        return "Thinking";
      case "action":
        return "Action";
      case "observation":
        return "Result";
    }
  };

  const getStepBgColor = (type: ReActStep["type"]) => {
    switch (type) {
      case "thought":
        return "bg-purple-50 border-purple-200";
      case "action":
        return "bg-blue-50 border-blue-200";
      case "observation":
        return "bg-green-50 border-green-200";
    }
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
          {isStreaming ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
          ) : error ? (
            <XCircle className="w-4 h-4 text-red-500" />
          ) : (
            <CheckCircle className="w-4 h-4 text-green-500" />
          )}
          <span className="text-sm font-medium text-gray-700">
            {title}
            {isStreaming && " in progress..."}
            {error && " failed"}
            {!isStreaming && !error && steps.length > 0 && " complete"}
          </span>
        </div>
        <span className="text-xs text-gray-500">
          {steps.length} step{steps.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Steps container */}
      <div
        ref={containerRef}
        className="max-h-64 overflow-y-auto p-3 space-y-2"
      >
        <AnimatePresence mode="popLayout">
          {steps.map((step, index) => (
            <motion.div
              key={`${step.iteration}-${step.type}-${index}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.2 }}
              className={`flex items-start gap-2 p-2 rounded border ${getStepBgColor(step.type)}`}
            >
              <div className="flex-shrink-0 mt-0.5">
                {getStepIcon(step.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-600">
                    {getStepLabel(step.type)}
                  </span>
                  <span className="text-xs text-gray-400">
                    #{step.iteration}
                  </span>
                  {step.tool && (
                    <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                      {step.tool}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-700 mt-1 break-words">
                  {truncateContent(step.content)}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Loading indicator for active stream */}
        {isStreaming && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 p-2 text-gray-500"
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Waiting for next step...</span>
          </motion.div>
        )}

        {/* Error display */}
        {error && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-start gap-2 p-2 rounded border border-red-200 bg-red-50"
          >
            <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700">{error}</p>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Truncate long content for display, keeping it readable
 */
function truncateContent(content: string | undefined | null, maxLength = 300): string {
  if (!content) {
    return "";
  }
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(0, maxLength) + "...";
}
