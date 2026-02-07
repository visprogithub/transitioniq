"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Heart,
  Pill,
  Calendar,
  MessageCircle,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Sparkles,
  ThumbsUp,
  Clock,
  Phone,
  FileText,
  HelpCircle,
} from "lucide-react";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis, ClinicianEdits } from "@/lib/types/analysis";
import { PatientChat } from "./PatientChat";

// ============================================================================
// SESSION STORAGE CACHING UTILITIES (auto-clears on tab close; 10-min TTL)
// ============================================================================
const CACHE_PREFIX = "tiq-summary-";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_ENTRIES = 10;

function getCacheKey(patientId: string, analysis: DischargeAnalysis): string {
  const analysisHash = `${analysis.score}-${analysis.riskFactors.length}-${analysis.status}`;
  return `${CACHE_PREFIX}${patientId}-${analysisHash}`;
}

function getCachedSummary(patientId: string, analysis: DischargeAnalysis): PatientSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const key = getCacheKey(patientId, analysis);
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
        return parsed.summary as PatientSummary;
      }
      sessionStorage.removeItem(key);
    }
  } catch {
    // sessionStorage unavailable — ignore
  }
  return null;
}

function cacheSummary(patientId: string, analysis: DischargeAnalysis, summary: PatientSummary): void {
  if (typeof window === "undefined") return;
  try {
    const key = getCacheKey(patientId, analysis);
    sessionStorage.setItem(key, JSON.stringify({ summary, timestamp: Date.now() }));
    cleanupOldCacheEntries();
  } catch {
    // quota exceeded or unavailable — silently skip
  }
}

function cleanupOldCacheEntries(): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(CACHE_PREFIX)) continue;
      try {
        const data = JSON.parse(sessionStorage.getItem(key)!) as { timestamp: number };
        if (now - data.timestamp > CACHE_TTL_MS) {
          keysToRemove.push(key);
        }
      } catch {
        keysToRemove.push(key!);
      }
    }
    // Also enforce max entries limit
    const allKeys: { key: string; timestamp: number }[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(CACHE_PREFIX) || keysToRemove.includes(key)) continue;
      try {
        const data = JSON.parse(sessionStorage.getItem(key)!) as { timestamp: number };
        allKeys.push({ key, timestamp: data.timestamp || 0 });
      } catch {
        keysToRemove.push(key!);
      }
    }
    if (allKeys.length > MAX_CACHE_ENTRIES) {
      allKeys.sort((a, b) => a.timestamp - b.timestamp);
      allKeys.slice(0, allKeys.length - MAX_CACHE_ENTRIES).forEach((e) => keysToRemove.push(e.key));
    }
    keysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // ignore
  }
}
// ============================================================================

interface PatientRecoveryCoachProps {
  patient: Patient | null;
  analysis: DischargeAnalysis | null;
  isLoading?: boolean;
  cachedSummary?: PatientSummary | null;
  onSummaryGenerated?: (summary: PatientSummary) => void;
  clinicianEdits?: ClinicianEdits;
}

export interface PatientSummary {
  readinessLevel: "good" | "caution" | "needs_attention";
  readinessMessage: string;
  whatYouNeedToKnow: Array<{
    title: string;
    description: string;
    icon: "pill" | "heart" | "calendar" | "alert";
  }>;
  medicationReminders: Array<{
    medication: string;
    instruction: string;
    important?: boolean;
  }>;
  questionsForDoctor: string[];
  nextSteps: Array<{
    task: string;
    completed: boolean;
    priority: "high" | "medium" | "low";
  }>;
}

const iconMap = {
  pill: Pill,
  heart: Heart,
  calendar: Calendar,
  alert: AlertCircle,
};

export function PatientRecoveryCoach({
  patient,
  analysis,
  isLoading = false,
  cachedSummary,
  onSummaryGenerated,
  clinicianEdits,
}: PatientRecoveryCoachProps) {
  const [patientSummary, setPatientSummary] = useState<PatientSummary | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(["whatYouNeedToKnow", "nextSteps"])
  );
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Generate patient-friendly summary when analysis changes
  // Uses 3-tier caching: parent state → localStorage → API call
  useEffect(() => {
    if (!analysis || !patient) return;

    // 1. Already have summary from parent state (persists across tab switches)
    if (cachedSummary) {
      console.log("[Cache] Using parent-cached summary (tab switch)");
      setPatientSummary(cachedSummary);
      return;
    }

    // 2. Already have local state (prevents re-render loops)
    if (patientSummary) return;

    // 3. Check localStorage cache (persists across page refreshes)
    const localCached = getCachedSummary(patient.id, analysis);
    if (localCached) {
      setPatientSummary(localCached);
      onSummaryGenerated?.(localCached);
      return;
    }

    // 4. Generate new summary via API
    generatePatientSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generatePatientSummary is recreated each render; deps would cause infinite loop
  }, [analysis, patient, cachedSummary]);

  async function generatePatientSummary() {
    if (!patient || !analysis) return;

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch("/api/patient-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: patient.id,
          analysis,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to generate patient summary");
      }

      const data = await response.json();
      const summary = data.summary as PatientSummary;

      // Update local state
      setPatientSummary(summary);

      // Cache to localStorage for page refresh persistence
      cacheSummary(patient.id, analysis, summary);

      // Notify parent for tab switch persistence
      onSummaryGenerated?.(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate summary");
      // Fallback to a generated summary based on analysis
      const fallbackSummary = generateFallbackSummary(patient, analysis);
      setPatientSummary(fallbackSummary);

      // Also cache the fallback so we don't regenerate on every error
      cacheSummary(patient.id, analysis, fallbackSummary);
      onSummaryGenerated?.(fallbackSummary);
    } finally {
      setIsGenerating(false);
    }
  }

  function generateFallbackSummary(
    patient: Patient,
    analysis: DischargeAnalysis
  ): PatientSummary {
    const highRisks = analysis.riskFactors.filter((rf) => rf.severity === "high");
    const moderateRisks = analysis.riskFactors.filter((rf) => rf.severity === "moderate");

    let readinessLevel: "good" | "caution" | "needs_attention";
    let readinessMessage: string;

    if (analysis.score >= 70) {
      readinessLevel = "good";
      readinessMessage = "You're making great progress! A few things to keep in mind before you go home.";
    } else if (analysis.score >= 40) {
      readinessLevel = "caution";
      readinessMessage = "You're getting better, but there are some important things we need to address before you can go home safely.";
    } else {
      readinessLevel = "needs_attention";
      readinessMessage = "We want to make sure you're safe and healthy before going home. Let's work through a few things together.";
    }

    // Convert risk factors to patient-friendly items
    const whatYouNeedToKnow = [
      ...highRisks.slice(0, 2).map((rf) => ({
        title: simplifyTitle(rf.title),
        description: simplifyDescription(rf.description),
        icon: getIconForCategory(rf.category) as "pill" | "heart" | "calendar" | "alert",
      })),
      ...moderateRisks.slice(0, 2).map((rf) => ({
        title: simplifyTitle(rf.title),
        description: simplifyDescription(rf.description),
        icon: getIconForCategory(rf.category) as "pill" | "heart" | "calendar" | "alert",
      })),
    ];

    // Generate medication reminders from patient data
    const medicationReminders = patient.medications.map((med) => ({
      medication: med.name,
      instruction: `Take ${med.dose} ${med.frequency}`,
      important: ["Warfarin", "Insulin", "Eliquis", "Metformin"].some((name) =>
        med.name.toLowerCase().includes(name.toLowerCase())
      ),
    }));

    // Generate questions based on risk factors
    const questionsForDoctor = [
      "When should I schedule my follow-up appointment?",
      ...(highRisks.length > 0
        ? ["What warning signs should I watch for at home?"]
        : []),
      ...(patient.medications.length > 5
        ? ["Can you review my medications with me one more time?"]
        : []),
      "Who should I call if I have questions after I leave?",
      "Are there any activities I should avoid?",
    ].slice(0, 4);

    // Generate next steps
    const nextSteps = [
      {
        task: "Review discharge instructions with nurse",
        completed: false,
        priority: "high" as const,
      },
      {
        task: "Confirm you have all your medications",
        completed: false,
        priority: "high" as const,
      },
      {
        task: "Schedule follow-up appointment",
        completed: false,
        priority: "high" as const,
      },
      {
        task: "Arrange transportation home",
        completed: false,
        priority: "medium" as const,
      },
      {
        task: "Identify a family member or friend to help at home",
        completed: false,
        priority: "medium" as const,
      },
    ];

    // Append clinician-added custom items
    if (clinicianEdits?.customItems.length) {
      for (const item of clinicianEdits.customItems) {
        nextSteps.push({
          task: item.text,
          completed: false,
          priority: item.priority === "high" ? "high" as const : "medium" as const,
        });
      }
    }

    return {
      readinessLevel,
      readinessMessage,
      whatYouNeedToKnow,
      medicationReminders,
      questionsForDoctor,
      nextSteps,
    };
  }

  function simplifyTitle(title: string): string {
    // Convert medical jargon to plain English
    const simplifications: Record<string, string> = {
      "Drug Interaction": "Medicine Safety Alert",
      "Anticoagulant": "Blood Thinner",
      "Polypharmacy": "Multiple Medications",
      "Renal Function": "Kidney Health",
      "Glycemic Control": "Blood Sugar",
      "Elevated INR": "Blood Thinning Level",
      "Hypertension": "Blood Pressure",
    };

    let simplified = title;
    for (const [medical, simple] of Object.entries(simplifications)) {
      simplified = simplified.replace(new RegExp(medical, "gi"), simple);
    }
    return simplified;
  }

  function simplifyDescription(description: string): string {
    // Simplify medical descriptions
    let simplified = description
      .replace(/contraindicated/gi, "should not be taken together")
      .replace(/adverse event/gi, "side effect")
      .replace(/therapeutic/gi, "treatment")
      .replace(/pharmacological/gi, "medication")
      .replace(/hemorrhagic/gi, "bleeding")
      .replace(/anticoagulant/gi, "blood thinner")
      .replace(/renal/gi, "kidney")
      .replace(/hepatic/gi, "liver")
      .replace(/cardiac/gi, "heart")
      .replace(/pulmonary/gi, "lung")
      .replace(/glycemic/gi, "blood sugar");

    // Truncate if too long
    if (simplified.length > 150) {
      simplified = simplified.slice(0, 147) + "...";
    }

    return simplified;
  }

  function getIconForCategory(category: string): string {
    switch (category) {
      case "drug_interaction":
      case "medication":
        return "pill";
      case "vital_sign":
      case "lab_abnormality":
        return "heart";
      case "follow_up":
      case "care_gap":
        return "calendar";
      default:
        return "alert";
    }
  }

  function toggleSection(section: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }

  function toggleStep(index: number) {
    setCompletedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  // Get readiness gauge color
  function getReadinessColor(level: string) {
    switch (level) {
      case "good":
        return { bg: "bg-emerald-500", text: "text-emerald-700", light: "bg-emerald-50" };
      case "caution":
        return { bg: "bg-amber-500", text: "text-amber-700", light: "bg-amber-50" };
      case "needs_attention":
        return { bg: "bg-red-500", text: "text-red-700", light: "bg-red-50" };
      default:
        return { bg: "bg-gray-500", text: "text-gray-700", light: "bg-gray-50" };
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
        <div className="h-48 bg-gray-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Heart className="w-10 h-10 text-blue-500" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Your Recovery Coach</h2>
        <p className="text-gray-500">Select a patient in the Clinical View then click &apos;Analyze&apos; to see personalized recovery guidance for that patient.</p>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-10 h-10 text-blue-500" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Analysis Needed</h2>
        <p className="text-gray-500 mb-4">
          Switch to the Clinical tab and run an analysis to generate your personalized going-home preparation guide
        </p>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="text-center py-16">
        <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Creating Your Recovery Guide
        </h2>
        <p className="text-gray-500">Making everything easy to understand...</p>
      </div>
    );
  }

  if (!patientSummary) {
    return (
      <div className="text-center py-16">
        <button
          onClick={generatePatientSummary}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Generate Recovery Guide
        </button>
      </div>
    );
  }

  const colors = getReadinessColor(patientSummary.readinessLevel);

  // Merge clinician custom items into the display steps (for both LLM and fallback paths)
  const displaySteps = [...patientSummary.nextSteps];
  if (clinicianEdits?.customItems.length) {
    // Only add custom items that aren't already in the summary (by text match)
    const existingTasks = new Set(displaySteps.map((s) => s.task.toLowerCase()));
    for (const item of clinicianEdits.customItems) {
      if (!existingTasks.has(item.text.toLowerCase())) {
        displaySteps.push({
          task: item.text,
          completed: false,
          priority: item.priority === "high" ? "high" as const : "medium" as const,
        });
      }
    }
  }

  const completedCount = completedSteps.size;
  const totalSteps = displaySteps.length;
  const progress = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  return (
    <div className="space-y-4 sm:space-y-6 overflow-x-hidden">
      {/* Header - Going-Home Preparation Tracker */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`${colors.light} rounded-2xl p-4 sm:p-6 border-2 ${
          patientSummary.readinessLevel === "good"
            ? "border-emerald-200"
            : patientSummary.readinessLevel === "caution"
            ? "border-amber-200"
            : "border-red-200"
        }`}
      >
        <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
          {/* Simple Traffic Light Gauge */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0">
            <div
              className={`w-16 h-16 sm:w-20 sm:h-20 rounded-full ${colors.bg} flex items-center justify-center shadow-lg`}
            >
              {patientSummary.readinessLevel === "good" ? (
                <ThumbsUp className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
              ) : patientSummary.readinessLevel === "caution" ? (
                <Clock className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
              ) : (
                <AlertCircle className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
              )}
            </div>
            <span className={`text-xs sm:text-sm font-semibold ${colors.text} uppercase tracking-wide`}>
              {patientSummary.readinessLevel === "good"
                ? "You're All Set"
                : patientSummary.readinessLevel === "caution"
                ? "Getting Ready"
                : "Let's Prepare"}
            </span>
          </div>

          {/* Message */}
          <div className="flex-1 text-center sm:text-left min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
              Hi {patient.name.split(" ")[0]}!
            </h2>
            <p className="text-base sm:text-lg text-gray-700">{patientSummary.readinessMessage}</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-gray-600">Your checklist progress</span>
            <span className={`font-semibold ${colors.text}`}>
              {completedCount} of {totalSteps} done
            </span>
          </div>
          <div className="h-3 bg-white rounded-full overflow-hidden shadow-inner">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5 }}
              className={`h-full ${colors.bg} rounded-full`}
            />
          </div>
        </div>
      </motion.div>

      {/* What You Need to Know */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
      >
        <button
          onClick={() => toggleSection("whatYouNeedToKnow")}
          className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">What You Need to Know</h3>
          </div>
          {expandedSections.has("whatYouNeedToKnow") ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>

        <AnimatePresence>
          {expandedSections.has("whatYouNeedToKnow") && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-gray-100"
            >
              <div className="p-3 sm:p-5 space-y-3 sm:space-y-4">
                {patientSummary.whatYouNeedToKnow.map((item, i) => {
                  const Icon = iconMap[item.icon];
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex items-start gap-3 sm:gap-4 p-3 sm:p-4 bg-gray-50 rounded-lg"
                    >
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
                        <Icon className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900">{item.title}</h4>
                        <p className="text-gray-600 mt-1">{item.description}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Medication Reminders */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
      >
        <button
          onClick={() => toggleSection("medications")}
          className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <Pill className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Your Medications</h3>
          </div>
          {expandedSections.has("medications") ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>

        <AnimatePresence>
          {expandedSections.has("medications") && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-gray-100"
            >
              <div className="p-3 sm:p-5 space-y-3">
                {patientSummary.medicationReminders.map((med, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className={`flex items-center justify-between p-3 sm:p-4 rounded-lg gap-2 ${
                      med.important ? "bg-amber-50 border border-amber-200" : "bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Pill
                        className={`w-5 h-5 ${med.important ? "text-amber-600" : "text-gray-400"}`}
                      />
                      <div>
                        <p className="font-medium text-gray-900">{med.medication}</p>
                        <p className="text-sm text-gray-600">{med.instruction}</p>
                      </div>
                    </div>
                    {med.important && (
                      <span className="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded-full font-medium">
                        Important
                      </span>
                    )}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Questions to Ask Your Doctor */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
      >
        <button
          onClick={() => toggleSection("questions")}
          className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <HelpCircle className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Questions to Ask Your Doctor</h3>
          </div>
          {expandedSections.has("questions") ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>

        <AnimatePresence>
          {expandedSections.has("questions") && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-gray-100"
            >
              <div className="p-3 sm:p-5 space-y-3">
                {patientSummary.questionsForDoctor.map((question, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-start gap-3 p-3 bg-green-50 rounded-lg"
                  >
                    <MessageCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <p className="text-gray-700">{question}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Next Steps Checklist */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
      >
        <button
          onClick={() => toggleSection("nextSteps")}
          className="w-full flex items-center justify-between p-4 sm:p-5 hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-orange-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Your Checklist</h3>
          </div>
          {expandedSections.has("nextSteps") ? (
            <ChevronUp className="w-5 h-5 text-gray-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-gray-400" />
          )}
        </button>

        <AnimatePresence>
          {expandedSections.has("nextSteps") && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-gray-100"
            >
              <div className="p-3 sm:p-5 space-y-4 sm:space-y-5">
                {/* Must Do Before Leaving — high priority items */}
                {displaySteps.some((s) => s.priority === "high") && (
                  <div>
                    <h4 className="text-sm font-semibold text-red-700 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500" />
                      Must Do Before Leaving
                    </h4>
                    <div className="space-y-3">
                      {displaySteps.map((step, i) => {
                        if (step.priority !== "high") return null;
                        const isCompleted = completedSteps.has(i);
                        return (
                          <motion.button
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                            onClick={() => toggleStep(i)}
                            className={`w-full flex items-center gap-4 p-4 rounded-lg transition-all ${
                              isCompleted
                                ? "bg-emerald-50 border border-emerald-200"
                                : "bg-red-50 border border-red-200 hover:bg-red-100"
                            }`}
                          >
                            <div
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                isCompleted
                                  ? "bg-emerald-500 border-emerald-500"
                                  : "border-gray-300"
                              }`}
                            >
                              {isCompleted && <CheckCircle className="w-4 h-4 text-white" />}
                            </div>
                            <span
                              className={`flex-1 text-left ${
                                isCompleted ? "line-through text-gray-500" : "text-gray-700"
                              }`}
                            >
                              {step.task}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Helpful For Your Recovery — non-high priority items */}
                {displaySteps.some((s) => s.priority !== "high") && (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-600 mb-3 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-gray-400" />
                      Helpful For Your Recovery
                    </h4>
                    <div className="space-y-3">
                      {displaySteps.map((step, i) => {
                        if (step.priority === "high") return null;
                        const isCompleted = completedSteps.has(i);
                        return (
                          <motion.button
                            key={i}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: i * 0.05 }}
                            onClick={() => toggleStep(i)}
                            className={`w-full flex items-center gap-4 p-4 rounded-lg transition-all ${
                              isCompleted
                                ? "bg-emerald-50 border border-emerald-200"
                                : "bg-gray-50 hover:bg-gray-100"
                            }`}
                          >
                            <div
                              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                                isCompleted
                                  ? "bg-emerald-500 border-emerald-500"
                                  : "border-gray-300"
                              }`}
                            >
                              {isCompleted && <CheckCircle className="w-4 h-4 text-white" />}
                            </div>
                            <span
                              className={`flex-1 text-left ${
                                isCompleted ? "line-through text-gray-500" : "text-gray-700"
                              }`}
                            >
                              {step.task}
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* AI Recovery Coach Chat */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <div className="mb-4 flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900">Ask Your Recovery Coach</h3>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
            AI-Powered
          </span>
        </div>
        <PatientChat patient={patient} analysis={analysis} />
      </motion.div>

      {/* Help Contact */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-4 sm:p-6 text-white"
      >
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
            <Phone className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-semibold text-lg">Questions? Need Help?</h3>
            <p className="text-blue-100 mt-1">
              Press your nurse call button or ask a staff member. We&apos;re here to help!
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
