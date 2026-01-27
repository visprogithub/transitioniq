"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  CheckCircle,
  Circle,
  AlertTriangle,
  Calendar,
  BookOpen,
  Clipboard,
  ChevronDown,
  ChevronRight,
  Printer,
} from "lucide-react";

interface DischargePlanProps {
  plan: string;
  patientName?: string;
}

interface ChecklistItem {
  text: string;
  checked: boolean;
}

interface PlanSection {
  title: string;
  priority: "high" | "moderate" | "standard" | "followup" | "education";
  items: ChecklistItem[];
}

// Parse the markdown plan into structured sections
function parsePlan(plan: string): PlanSection[] {
  const sections: PlanSection[] = [];
  const lines = plan.split("\n");

  let currentSection: PlanSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for section headers (** or ## format)
    const headerMatch = trimmed.match(/^\*\*(.+?)\*\*$/) || trimmed.match(/^##\s*(.+)$/);
    if (headerMatch) {
      const title = headerMatch[1].trim();

      // Determine priority from title
      let priority: PlanSection["priority"] = "standard";
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.includes("high priority") || lowerTitle.includes("must complete")) {
        priority = "high";
      } else if (lowerTitle.includes("moderate") || lowerTitle.includes("should complete")) {
        priority = "moderate";
      } else if (lowerTitle.includes("follow") || lowerTitle.includes("appointment")) {
        priority = "followup";
      } else if (lowerTitle.includes("education") || lowerTitle.includes("teaching")) {
        priority = "education";
      }

      currentSection = { title, priority, items: [] };
      sections.push(currentSection);
      continue;
    }

    // Check for checklist items (- [ ] format)
    const checklistMatch = trimmed.match(/^-\s*\[\s*([xX ]?)\s*\]\s*(.+)$/);
    if (checklistMatch && currentSection) {
      currentSection.items.push({
        text: checklistMatch[2].trim(),
        checked: checklistMatch[1].toLowerCase() === "x",
      });
      continue;
    }

    // Check for bullet items (- format without checkbox)
    const bulletMatch = trimmed.match(/^-\s+(.+)$/);
    if (bulletMatch && currentSection) {
      currentSection.items.push({
        text: bulletMatch[1].trim(),
        checked: false,
      });
    }
  }

  return sections;
}

// Get icon and color for section priority
function getSectionStyle(priority: PlanSection["priority"]) {
  switch (priority) {
    case "high":
      return {
        icon: AlertTriangle,
        borderColor: "border-l-red-500",
        bgColor: "bg-red-50",
        textColor: "text-red-700",
        badgeColor: "bg-red-100 text-red-800",
      };
    case "moderate":
      return {
        icon: Clipboard,
        borderColor: "border-l-amber-500",
        bgColor: "bg-amber-50",
        textColor: "text-amber-700",
        badgeColor: "bg-amber-100 text-amber-800",
      };
    case "followup":
      return {
        icon: Calendar,
        borderColor: "border-l-blue-500",
        bgColor: "bg-blue-50",
        textColor: "text-blue-700",
        badgeColor: "bg-blue-100 text-blue-800",
      };
    case "education":
      return {
        icon: BookOpen,
        borderColor: "border-l-purple-500",
        bgColor: "bg-purple-50",
        textColor: "text-purple-700",
        badgeColor: "bg-purple-100 text-purple-800",
      };
    default:
      return {
        icon: Clipboard,
        borderColor: "border-l-gray-400",
        bgColor: "bg-gray-50",
        textColor: "text-gray-700",
        badgeColor: "bg-gray-100 text-gray-800",
      };
  }
}

export function DischargePlan({ plan, patientName }: DischargePlanProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set([0, 1]) // Expand first two sections by default
  );

  const sections = parsePlan(plan);

  // If parsing failed, show raw plan with basic formatting
  if (sections.length === 0 || sections.every((s) => s.items.length === 0)) {
    return <RawPlanDisplay plan={plan} />;
  }

  const toggleItem = (sectionIdx: number, itemIdx: number) => {
    const key = `${sectionIdx}-${itemIdx}`;
    setCheckedItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSection = (idx: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);
  const completedItems = checkedItems.size;
  const progress = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            Discharge Plan
          </h3>
          {patientName && (
            <p className="text-sm text-gray-500 mt-1">For {patientName}</p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-700">
              {completedItems} / {totalItems} completed
            </p>
            <div className="w-32 h-2 bg-gray-200 rounded-full mt-1 overflow-hidden">
              <motion.div
                className="h-full bg-emerald-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Print plan"
          >
            <Printer className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-3">
        {sections.map((section, sectionIdx) => {
          const style = getSectionStyle(section.priority);
          const Icon = style.icon;
          const isExpanded = expandedSections.has(sectionIdx);
          const sectionCompleted = section.items.filter(
            (_, itemIdx) => checkedItems.has(`${sectionIdx}-${itemIdx}`)
          ).length;

          return (
            <motion.div
              key={sectionIdx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: sectionIdx * 0.1 }}
              className={`border-l-4 ${style.borderColor} rounded-lg overflow-hidden bg-white shadow-sm`}
            >
              {/* Section Header */}
              <button
                onClick={() => toggleSection(sectionIdx)}
                className={`w-full flex items-center justify-between p-4 ${style.bgColor} hover:opacity-90 transition-opacity`}
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className={`w-5 h-5 ${style.textColor}`} />
                  ) : (
                    <ChevronRight className={`w-5 h-5 ${style.textColor}`} />
                  )}
                  <Icon className={`w-5 h-5 ${style.textColor}`} />
                  <span className={`font-semibold ${style.textColor}`}>
                    {section.title}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-1 rounded-full ${style.badgeColor}`}>
                    {sectionCompleted}/{section.items.length}
                  </span>
                </div>
              </button>

              {/* Section Items */}
              {isExpanded && section.items.length > 0 && (
                <div className="p-4 space-y-2">
                  {section.items.map((item, itemIdx) => {
                    const isChecked = checkedItems.has(`${sectionIdx}-${itemIdx}`);
                    return (
                      <label
                        key={itemIdx}
                        className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                          isChecked
                            ? "bg-emerald-50 text-emerald-800"
                            : "hover:bg-gray-50 text-gray-700"
                        }`}
                      >
                        <button
                          onClick={() => toggleItem(sectionIdx, itemIdx)}
                          className="flex-shrink-0 mt-0.5"
                        >
                          {isChecked ? (
                            <CheckCircle className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Circle className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                        <span className={isChecked ? "line-through opacity-70" : ""}>
                          {formatItemText(item.text)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// Format item text - handle bold, italics, etc.
function formatItemText(text: string): React.ReactNode {
  // Handle **bold** text
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

// Fallback for unparseable plans
function RawPlanDisplay({ plan }: { plan: string }) {
  // Basic formatting for raw markdown
  const lines = plan.split("\n");

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <FileText className="w-5 h-5 text-emerald-600" />
        Discharge Plan
      </h3>
      <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-2">
        {lines.map((line, i) => {
          const trimmed = line.trim();
          if (!trimmed) return <div key={i} className="h-2" />;

          // Headers
          if (trimmed.startsWith("**") && trimmed.endsWith("**")) {
            return (
              <h4 key={i} className="font-bold text-gray-900 mt-4 first:mt-0">
                {trimmed.slice(2, -2)}
              </h4>
            );
          }

          // Checklist items
          if (trimmed.match(/^-\s*\[\s*[xX ]?\s*\]/)) {
            const text = trimmed.replace(/^-\s*\[\s*[xX ]?\s*\]\s*/, "");
            return (
              <div key={i} className="flex items-start gap-2 pl-2">
                <Circle className="w-4 h-4 text-gray-400 mt-1 flex-shrink-0" />
                <span className="text-gray-700">{text}</span>
              </div>
            );
          }

          // Bullet items
          if (trimmed.startsWith("-")) {
            return (
              <div key={i} className="flex items-start gap-2 pl-2">
                <span className="text-gray-400">•</span>
                <span className="text-gray-700">{trimmed.slice(1).trim()}</span>
              </div>
            );
          }

          // Regular text
          return (
            <p key={i} className="text-gray-700">
              {trimmed}
            </p>
          );
        })}
      </div>
    </div>
  );
}
