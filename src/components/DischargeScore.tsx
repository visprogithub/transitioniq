"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Info } from "lucide-react";
import { Tooltip } from "./Tooltip";

interface DischargeScoreProps {
  score: number;
  status: "ready" | "caution" | "not_ready";
  isLoading?: boolean;
}

export function DischargeScore({ score, status, isLoading = false }: DischargeScoreProps) {
  const [displayScore, setDisplayScore] = useState(0);
  const [showMethodology, setShowMethodology] = useState(false);

  // Animate score counting up
  useEffect(() => {
    if (isLoading) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional reset for animation
      setDisplayScore(0);
      return;
    }

    const duration = 1500; // 1.5 seconds
    const steps = 60;
    const increment = score / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= score) {
        setDisplayScore(score);
        clearInterval(timer);
      } else {
        setDisplayScore(Math.round(current));
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [score, isLoading]);

  // Calculate colors based on score
  const getScoreColor = (s: number) => {
    if (s >= 70) return "#10B981"; // Green
    if (s >= 40) return "#F59E0B"; // Yellow
    return "#EF4444"; // Red
  };

  const getStatusText = () => {
    switch (status) {
      case "ready":
        return "READY FOR DISCHARGE";
      case "caution":
        return "CAUTION - REVIEW NEEDED";
      case "not_ready":
        return "NOT READY";
      default:
        return "ANALYZING...";
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "ready":
        return "text-emerald-600";
      case "caution":
        return "text-amber-600";
      case "not_ready":
        return "text-red-600";
      default:
        return "text-gray-500";
    }
  };

  const scoreColor = getScoreColor(displayScore);
  const circumference = 2 * Math.PI * 90; // radius = 90
  const progress = isLoading ? 0 : (displayScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center justify-center p-8">
      {/* Circular Gauge */}
      <div className="relative w-64 h-64">
        {/* Background circle */}
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 200 200">
          <circle
            cx="100"
            cy="100"
            r="90"
            fill="none"
            stroke="#E5E7EB"
            strokeWidth="12"
          />
          {/* Progress circle */}
          <motion.circle
            cx="100"
            cy="100"
            r="90"
            fill="none"
            stroke={scoreColor}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - progress }}
            transition={{ duration: 1.5, ease: "easeOut" }}
          />
        </svg>

        {/* Score display in center */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {isLoading ? (
            <motion.div
              className="w-12 h-12 border-4 border-gray-300 border-t-blue-500 rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            />
          ) : (
            <>
              <motion.span
                className="text-6xl font-bold"
                style={{ color: scoreColor }}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                {displayScore}
              </motion.span>
              <span className="text-2xl text-gray-500">%</span>
            </>
          )}
        </div>
      </div>

      {/* Status text */}
      <motion.div
        className="mt-6 text-center"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.5 }}
      >
        <span className={`text-xl font-bold ${getStatusColor()}`}>
          {isLoading ? "ANALYZING..." : getStatusText()}
        </span>
      </motion.div>

      {/* Score interpretation */}
      {!isLoading && (
        <motion.div
          className="mt-4 flex gap-6 text-sm text-gray-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
        >
          <Tooltip content="High risk of complications or readmission. Address all red risk factors before discharge." position="bottom">
            <div className="flex items-center gap-2 cursor-help">
              <span className="w-3 h-3 rounded-full bg-red-500" />
              <span>0-39: Not Ready</span>
            </div>
          </Tooltip>
          <Tooltip content="Moderate concerns present. Review yellow risk factors and consider additional interventions." position="bottom">
            <div className="flex items-center gap-2 cursor-help">
              <span className="w-3 h-3 rounded-full bg-amber-500" />
              <span>40-69: Caution</span>
            </div>
          </Tooltip>
          <Tooltip content="Patient meets discharge criteria. Standard discharge process can proceed." position="bottom">
            <div className="flex items-center gap-2 cursor-help">
              <span className="w-3 h-3 rounded-full bg-emerald-500" />
              <span>70-100: Ready</span>
            </div>
          </Tooltip>
        </motion.div>
      )}

      {/* How is this calculated? — collapsible methodology */}
      {!isLoading && (
        <motion.div
          className="mt-4 w-full"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2 }}
        >
          <button
            onClick={() => setShowMethodology(!showMethodology)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors mx-auto"
          >
            <Info className="w-3.5 h-3.5" />
            <span>How is this calculated?</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showMethodology ? "rotate-180" : ""}`} />
          </button>

          <AnimatePresence>
            {showMethodology && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="mt-3 bg-gray-50 rounded-lg p-4 text-xs text-gray-600 space-y-2">
                  <p className="font-medium text-gray-700">Score is based on AI analysis of 5 data sources:</p>
                  <ul className="space-y-1.5 ml-1">
                    <li className="flex items-start gap-2">
                      <span className="text-red-400 mt-0.5">&#x2022;</span>
                      <span><strong>Drug Interactions</strong> — FDA adverse event data cross-referenced against patient medications</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-amber-400 mt-0.5">&#x2022;</span>
                      <span><strong>Care Gaps</strong> — Clinical guideline compliance checks (screenings, follow-ups)</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5">&#x2022;</span>
                      <span><strong>Follow-up Scheduling</strong> — PCP and specialist appointment verification</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-purple-400 mt-0.5">&#x2022;</span>
                      <span><strong>Cost Barriers</strong> — CMS Medicare Part D pricing for medication affordability</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-teal-400 mt-0.5">&#x2022;</span>
                      <span><strong>Clinical Knowledge</strong> — RAG-powered cross-reference of drug monographs and medical guidelines</span>
                    </li>
                  </ul>
                  <p className="text-gray-400 pt-1">Each high-risk factor reduces the score by 20 points, moderate by 10, low by 5.</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
