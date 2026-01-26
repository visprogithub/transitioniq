"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface DischargeScoreProps {
  score: number;
  status: "ready" | "caution" | "not_ready";
  isLoading?: boolean;
}

export function DischargeScore({ score, status, isLoading = false }: DischargeScoreProps) {
  const [displayScore, setDisplayScore] = useState(0);

  // Animate score counting up
  useEffect(() => {
    if (isLoading) {
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
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span>0-39: Not Ready</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-500" />
            <span>40-69: Caution</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
            <span>70-100: Ready</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}
