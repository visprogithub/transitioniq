"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, ChevronDown, CheckCircle, Loader2 } from "lucide-react";
import { Tooltip } from "@/components/Tooltip";

interface ModelInfo {
  id: string;
  provider: string;
  available: boolean;
  displayName: string;
}

interface ModelSelectorProps {
  onModelChange?: (modelId: string) => void;
  compact?: boolean;
}

// Provider styling
const PROVIDER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  gemini: { bg: "bg-blue-100", text: "text-blue-700", label: "Gemini" },
  groq: { bg: "bg-orange-100", text: "text-orange-700", label: "Groq" },
  huggingface: { bg: "bg-yellow-100", text: "text-yellow-700", label: "HF" },
  openai: { bg: "bg-green-100", text: "text-green-700", label: "OpenAI" },
  anthropic: { bg: "bg-purple-100", text: "text-purple-700", label: "Claude" },
};

export function ModelSelector({ onModelChange, compact = false }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [activeModel, setActiveModel] = useState<string>("");
  const [availableModels, setAvailableModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load available models on mount
  useEffect(() => {
    loadModels();
  }, []);

  async function loadModels() {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/evaluate/models");
      if (!response.ok) throw new Error("Failed to load models");
      const data = await response.json();
      setAvailableModels(data.allModels || []);
      setActiveModel(data.activeModel || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setIsLoading(false);
    }
  }

  async function switchModel(modelId: string) {
    if (modelId === activeModel) {
      setIsOpen(false);
      return;
    }

    setIsSwitching(true);
    setError(null);
    try {
      const response = await fetch("/api/model/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to switch model");
      }

      setActiveModel(modelId);
      onModelChange?.(modelId);
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to switch model");
    } finally {
      setIsSwitching(false);
    }
  }

  const activeModelInfo = availableModels.find((m) => m.id === activeModel);
  const providerStyle = activeModelInfo
    ? PROVIDER_STYLES[activeModelInfo.provider] || PROVIDER_STYLES.gemini
    : PROVIDER_STYLES.gemini;

  // Group models by provider
  const modelsByProvider = availableModels.reduce(
    (acc, model) => {
      if (!acc[model.provider]) {
        acc[model.provider] = [];
      }
      acc[model.provider].push(model);
      return acc;
    },
    {} as Record<string, ModelInfo[]>
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-100 rounded-lg">
        <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
        <span className="text-sm text-gray-500">Loading models...</span>
      </div>
    );
  }

  if (availableModels.filter((m) => m.available).length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
        <Cpu className="w-4 h-4 text-amber-600" />
        <span className="text-sm text-amber-700">No models configured</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <Tooltip content="Change AI model for analysis (tracked in Opik)" position="bottom">
        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isSwitching}
          className={`flex items-center gap-2 px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors ${
            isSwitching ? "opacity-50 cursor-wait" : ""
          }`}
        >
          {isSwitching ? (
            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
          ) : (
            <Cpu className="w-4 h-4 text-gray-600" />
          )}
          {!compact && (
            <>
              <span className={`text-xs px-1.5 py-0.5 rounded ${providerStyle.bg} ${providerStyle.text}`}>
                {providerStyle.label}
              </span>
              <span className="text-sm font-medium text-gray-700 max-w-[120px] truncate">
                {activeModelInfo?.displayName || activeModel || "Select Model"}
              </span>
            </>
          )}
          {compact && activeModelInfo && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${providerStyle.bg} ${providerStyle.text}`}>
              {providerStyle.label}
            </span>
          )}
          <ChevronDown
            className={`w-4 h-4 text-gray-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>
      </Tooltip>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed left-2 right-2 sm:absolute sm:left-auto sm:right-0 mt-2 sm:w-72 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden z-50"
          >
            <div className="p-2 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 px-2">Select AI Model</p>
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-50 text-red-700 text-sm">{error}</div>
            )}

            <div className="max-h-80 overflow-y-auto p-2">
              {Object.entries(modelsByProvider).map(([provider, models]) => {
                const style = PROVIDER_STYLES[provider] || PROVIDER_STYLES.gemini;
                const availableCount = models.filter((m) => m.available).length;

                if (availableCount === 0) return null;

                return (
                  <div key={provider} className="mb-2 last:mb-0">
                    <div className="flex items-center gap-2 px-2 py-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                        {style.label}
                      </span>
                      <span className="text-xs text-gray-400">
                        {availableCount} model{availableCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {models
                      .filter((m) => m.available)
                      .map((model) => (
                        <button
                          key={model.id}
                          onClick={() => switchModel(model.id)}
                          disabled={isSwitching}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
                            model.id === activeModel
                              ? "bg-blue-50 text-blue-700"
                              : "hover:bg-gray-100 text-gray-700"
                          } ${isSwitching ? "opacity-50" : ""}`}
                        >
                          <div>
                            <p className="text-sm font-medium">{model.displayName || model.id}</p>
                            <p className="text-xs text-gray-500">{model.id}</p>
                          </div>
                          {model.id === activeModel && (
                            <CheckCircle className="w-4 h-4 text-blue-600" />
                          )}
                        </button>
                      ))}
                  </div>
                );
              })}
            </div>

            <div className="p-2 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-500 px-2">
                Model selection affects all analyses. Results are tracked in Opik.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
