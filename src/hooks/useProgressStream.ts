/**
 * useProgressStream - Hook for consuming SSE progress events from deterministic APIs
 *
 * Simpler than ReAct streaming - just shows step-by-step progress:
 * - Data source calls (FDA, CMS, Guidelines)
 * - LLM operations
 * - Tool executions
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { ProgressStep } from "@/components/ProgressSteps";

export interface ProgressEvent {
  type: "step" | "error" | "complete" | "result";
  step?: ProgressStep;
  error?: string;
  result?: unknown;
}

interface UseProgressStreamOptions {
  onComplete?: (result: unknown) => void;
  onError?: (error: string) => void;
}

export function useProgressStream(options?: UseProgressStreamOptions) {
  const [steps, setSteps] = useState<ProgressStep[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Start streaming from an API endpoint
   */
  const startStream = useCallback(async (url: string, body: Record<string, unknown>) => {
    // Reset state
    setSteps([]);
    setError(null);
    setIsActive(true);

    // Create abort controller for cleanup
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (!response.body) {
        throw new Error("Response body is null");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          setIsActive(false);
          break;
        }

        // Decode and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim() || !line.startsWith("data: ")) continue;

          const data = line.slice(6); // Remove "data: " prefix

          if (data === "[DONE]") {
            setIsActive(false);
            break;
          }

          try {
            const event: ProgressEvent = JSON.parse(data);

            if (event.type === "step" && event.step) {
              setSteps((prev) => {
                // Update existing step or add new one
                const existingIndex = prev.findIndex((s) => s.id === event.step!.id);
                if (existingIndex >= 0) {
                  const updated = [...prev];
                  updated[existingIndex] = event.step!;
                  return updated;
                }
                return [...prev, event.step!];
              });
            } else if (event.type === "error") {
              setError(event.error || "Unknown error");
              setIsActive(false);
              options?.onError?.(event.error || "Unknown error");
            } else if (event.type === "complete" || event.type === "result") {
              setIsActive(false);
              if (event.result) {
                options?.onComplete?.(event.result);
              }
            }
          } catch (parseError) {
            console.warn("[ProgressStream] Failed to parse event:", data);
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled - not an error
        console.log("[ProgressStream] Aborted");
      } else {
        const errorMsg = err instanceof Error ? err.message : String(err);
        setError(errorMsg);
        options?.onError?.(errorMsg);
      }
      setIsActive(false);
    }
  }, [options]);

  /**
   * Cancel active stream
   */
  const cancelStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsActive(false);
  }, []);

  /**
   * Reset progress state (clear steps and errors)
   */
  const reset = useCallback(() => {
    setSteps([]);
    setError(null);
    setIsActive(false);
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    steps,
    isActive,
    error,
    startStream,
    cancelStream,
    reset,
  };
}
