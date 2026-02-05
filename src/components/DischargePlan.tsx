"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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
  Plus,
  X,
  Undo2,
} from "lucide-react";
import { Tooltip } from "@/components/Tooltip";
import type { ClinicianEdits } from "@/lib/types/analysis";

interface DischargePlanProps {
  plan: string;
  patientName?: string;
  clinicianEdits?: ClinicianEdits;
  onAddCustomItem?: (text: string, priority: "high" | "moderate" | "standard") => void;
  onDismissItem?: (key: string) => void;
  onRestoreItem?: (key: string) => void;
  onRemoveCustomItem?: (id: string) => void;
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

  // Guard against non-string input (e.g., if API returned object instead of string)
  if (typeof plan !== "string") {
    console.error("[DischargePlan] Expected string but got:", typeof plan, plan);
    return sections;
  }

  const lines = plan.split("\n");

  let currentSection: PlanSection | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for section headers (** or ## or # format)
    const headerMatch = trimmed.match(/^\*\*(.+?)\*\*$/) || trimmed.match(/^#{1,2}\s*(.+)$/);
    if (headerMatch) {
      const title = headerMatch[1].trim();

      // Skip title headers (e.g., "# Discharge Plan for X") - they have no actionable items
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.startsWith("discharge plan for") || lowerTitle.startsWith("transition plan for")) {
        continue;
      }

      // Determine priority from title
      let priority: PlanSection["priority"] = "standard";
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

  // Filter out any sections that ended up with no items (empty headers)
  return sections.filter(section => section.items.length > 0);
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

// Map custom item priority to section priority for matching
function mapCustomPriority(priority: "high" | "moderate" | "standard"): PlanSection["priority"] {
  return priority;
}

// Get styling for custom item priority badges
function getCustomPriorityStyle(priority: "high" | "moderate" | "standard") {
  switch (priority) {
    case "high":
      return {
        badgeColor: "bg-red-100 text-red-800",
        label: "High Priority",
      };
    case "moderate":
      return {
        badgeColor: "bg-amber-100 text-amber-800",
        label: "Moderate",
      };
    default:
      return {
        badgeColor: "bg-gray-100 text-gray-700",
        label: "Standard",
      };
  }
}

export function DischargePlan({
  plan,
  patientName,
  clinicianEdits,
  onAddCustomItem,
  onDismissItem,
  onRestoreItem,
  onRemoveCustomItem,
}: DischargePlanProps) {
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set([0, 1]) // Expand first two sections by default
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const [newItemPriority, setNewItemPriority] = useState<"high" | "moderate" | "standard">("high");

  const sections = parsePlan(plan);
  const dismissed = clinicianEdits?.dismissedItemKeys ?? [];
  const customItems = clinicianEdits?.customItems ?? [];

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

  const toggleCustomItem = (id: string) => {
    const key = `custom-${id}`;
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

  const handleAddItem = () => {
    if (!newItemText.trim() || !onAddCustomItem) return;
    onAddCustomItem(newItemText.trim(), newItemPriority);
    setNewItemText("");
    setShowAddForm(false);
  };

  // Calculate progress excluding dismissed items
  const activeAIItems = sections.reduce((sum, s, sIdx) => {
    return sum + s.items.filter((_, iIdx) => !dismissed.includes(`${sIdx}-${iIdx}`)).length;
  }, 0);
  const totalItems = activeAIItems + customItems.length;

  const checkedAIItems = sections.reduce((sum, s, sIdx) => {
    return sum + s.items.filter((_, iIdx) => {
      const key = `${sIdx}-${iIdx}`;
      return !dismissed.includes(key) && checkedItems.has(key);
    }).length;
  }, 0);
  const checkedCustomItems = customItems.filter((ci) => checkedItems.has(`custom-${ci.id}`)).length;
  const completedItems = checkedAIItems + checkedCustomItems;
  const progress = totalItems > 0 ? (completedItems / totalItems) * 100 : 0;

  // Group custom items by matching section priority
  const customByPriority: Record<string, typeof customItems> = {};
  for (const ci of customItems) {
    const mapped = mapCustomPriority(ci.priority);
    if (!customByPriority[mapped]) customByPriority[mapped] = [];
    customByPriority[mapped].push(ci);
  }

  // Check if any custom items don't match existing sections — they'll go in a "Custom" section
  const existingPriorities = new Set(sections.map((s) => s.priority));
  const unmatchedCustom = customItems.filter((ci) => !existingPriorities.has(mapCustomPriority(ci.priority)));

  return (
    <div className="space-y-4">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            Transition Plan
          </h3>
          {patientName && (
            <p className="text-sm text-gray-500 mt-1">For {patientName}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          {onAddCustomItem && (
            <Tooltip content="Add custom checklist item" position="bottom">
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className={`p-2 rounded-lg transition-colors ${
                  showAddForm
                    ? "bg-blue-100 text-blue-700"
                    : "text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                }`}
              >
                <Plus className="w-5 h-5" />
              </button>
            </Tooltip>
          )}
          <Tooltip content="Print discharge checklist" position="bottom">
            <button
              onClick={() => window.print()}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <Printer className="w-5 h-5" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Add Custom Item Form */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
              <input
                type="text"
                value={newItemText}
                onChange={(e) => setNewItemText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddItem(); }}
                placeholder="Enter custom checklist item..."
                className="w-full px-3 py-2 border border-blue-300 rounded-lg text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                autoFocus
              />
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-700">Priority:</label>
                  <select
                    value={newItemPriority}
                    onChange={(e) => setNewItemPriority(e.target.value as "high" | "moderate" | "standard")}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="high">High Priority</option>
                    <option value="moderate">Moderate</option>
                    <option value="standard">Standard</option>
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowAddForm(false); setNewItemText(""); }}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddItem}
                    disabled={!newItemText.trim()}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Add Item
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sections */}
      <div className="space-y-3">
        {sections.map((section, sectionIdx) => {
          const style = getSectionStyle(section.priority);
          const Icon = style.icon;
          const isExpanded = expandedSections.has(sectionIdx);

          // Get custom items for this section's priority
          const sectionCustomItems = customByPriority[section.priority] || [];

          // Count active (non-dismissed) AI items + custom items
          const activeItems = section.items.filter(
            (_, iIdx) => !dismissed.includes(`${sectionIdx}-${iIdx}`)
          );
          const sectionTotalActive = activeItems.length + sectionCustomItems.length;
          const sectionCompleted =
            activeItems.filter((_, iIdx) => {
              // Find actual index in original array
              const origIdx = section.items.indexOf(activeItems[iIdx]);
              return checkedItems.has(`${sectionIdx}-${origIdx}`);
            }).length +
            sectionCustomItems.filter((ci) => checkedItems.has(`custom-${ci.id}`)).length;

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
                    {sectionCompleted}/{sectionTotalActive}
                  </span>
                </div>
              </button>

              {/* Section Items */}
              {isExpanded && (section.items.length > 0 || sectionCustomItems.length > 0) && (
                <div className="p-4 space-y-2">
                  {/* AI-generated items */}
                  {section.items.map((item, itemIdx) => {
                    const key = `${sectionIdx}-${itemIdx}`;
                    const isDismissed = dismissed.includes(key);
                    const isChecked = checkedItems.has(key);

                    return (
                      <div
                        key={itemIdx}
                        className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                          isDismissed
                            ? "opacity-40"
                            : isChecked
                              ? "bg-emerald-50 text-emerald-800"
                              : "hover:bg-gray-50 text-gray-700"
                        }`}
                      >
                        <button
                          onClick={() => !isDismissed && toggleItem(sectionIdx, itemIdx)}
                          className="flex-shrink-0 mt-0.5"
                          disabled={isDismissed}
                        >
                          {isChecked && !isDismissed ? (
                            <CheckCircle className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Circle className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                        <span className={`flex-1 ${isDismissed || isChecked ? "line-through" : ""} ${isDismissed ? "text-gray-400" : ""}`}>
                          {formatItemText(item.text)}
                        </span>
                        {/* Dismiss / Restore button */}
                        {isDismissed ? (
                          onRestoreItem && (
                            <Tooltip content="Restore item" position="left">
                              <button
                                onClick={() => onRestoreItem(key)}
                                className="flex-shrink-0 p-1 text-gray-400 hover:text-blue-600 rounded transition-colors"
                              >
                                <Undo2 className="w-4 h-4" />
                              </button>
                            </Tooltip>
                          )
                        ) : (
                          onDismissItem && (
                            <Tooltip content="Dismiss item" position="left">
                              <button
                                onClick={() => onDismissItem(key)}
                                className="flex-shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </Tooltip>
                          )
                        )}
                      </div>
                    );
                  })}

                  {/* Custom items appended to this section */}
                  {sectionCustomItems.map((ci) => {
                    const isChecked = checkedItems.has(`custom-${ci.id}`);
                    return (
                      <motion.div
                        key={`custom-${ci.id}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                          isChecked
                            ? "bg-emerald-50 text-emerald-800"
                            : "hover:bg-gray-50 text-gray-700"
                        }`}
                      >
                        <button
                          onClick={() => toggleCustomItem(ci.id)}
                          className="flex-shrink-0 mt-0.5"
                        >
                          {isChecked ? (
                            <CheckCircle className="w-5 h-5 text-emerald-600" />
                          ) : (
                            <Circle className="w-5 h-5 text-gray-400" />
                          )}
                        </button>
                        <span className={`flex-1 ${isChecked ? "line-through opacity-70" : ""}`}>
                          {ci.text}
                        </span>
                        <span className="flex-shrink-0 text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">
                          Custom
                        </span>
                        {onRemoveCustomItem && (
                          <Tooltip content="Remove custom item" position="left">
                            <button
                              onClick={() => onRemoveCustomItem(ci.id)}
                              className="flex-shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </Tooltip>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}

        {/* Extra section for custom items that don't match any existing section */}
        {unmatchedCustom.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="border-l-4 border-l-blue-500 rounded-lg overflow-hidden bg-white shadow-sm"
          >
            <button
              onClick={() => toggleSection(sections.length)}
              className="w-full flex items-center justify-between p-4 bg-blue-50 hover:opacity-90 transition-opacity"
            >
              <div className="flex items-center gap-3">
                {expandedSections.has(sections.length) ? (
                  <ChevronDown className="w-5 h-5 text-blue-700" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-blue-700" />
                )}
                <Plus className="w-5 h-5 text-blue-700" />
                <span className="font-semibold text-blue-700">
                  Custom Instructions
                </span>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                {unmatchedCustom.filter((ci) => checkedItems.has(`custom-${ci.id}`)).length}/{unmatchedCustom.length}
              </span>
            </button>
            {expandedSections.has(sections.length) && (
              <div className="p-4 space-y-2">
                {unmatchedCustom.map((ci) => {
                  const isChecked = checkedItems.has(`custom-${ci.id}`);
                  const priorityStyle = getCustomPriorityStyle(ci.priority);
                  return (
                    <motion.div
                      key={`custom-${ci.id}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                        isChecked
                          ? "bg-emerald-50 text-emerald-800"
                          : "hover:bg-gray-50 text-gray-700"
                      }`}
                    >
                      <button
                        onClick={() => toggleCustomItem(ci.id)}
                        className="flex-shrink-0 mt-0.5"
                      >
                        {isChecked ? (
                          <CheckCircle className="w-5 h-5 text-emerald-600" />
                        ) : (
                          <Circle className="w-5 h-5 text-gray-400" />
                        )}
                      </button>
                      <span className={`flex-1 ${isChecked ? "line-through opacity-70" : ""}`}>
                        {ci.text}
                      </span>
                      <span className={`flex-shrink-0 text-xs px-1.5 py-0.5 rounded font-medium ${priorityStyle.badgeColor}`}>
                        {priorityStyle.label}
                      </span>
                      {onRemoveCustomItem && (
                        <Tooltip content="Remove custom item" position="left">
                          <button
                            onClick={() => onRemoveCustomItem(ci.id)}
                            className="flex-shrink-0 p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </Tooltip>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
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
                <span className="text-gray-400">&bull;</span>
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
