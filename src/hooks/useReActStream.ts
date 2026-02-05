/**
 * useReActStream - Hook for consuming SSE streams from ReAct endpoints
 *
 * Connects to endpoints with ?stream=true and parses SSE events:
 * - thought: LLM reasoning step
 * - action: Tool being called
 * - observation: Tool result
 * - final: Complete result
 * - error: Something went wrong
 */

import { useState, useCallback, useRef } from "react";

export interface ReActThought {
  iteration: number;
  thought: string;
  timestamp: string;
}

export interface ReActAction {
  iteration: number;
  tool: string;
  args: Record<string, unknown>;
  timestamp: string;
}

export interface ReActObservation {
  iteration: number;
  observation: string;
  timestamp: string;
}

export interface ReActStep {
  type: "thought" | "action" | "observation";
  iteration: number;
  content: string;
  tool?: string;
  timestamp: string;
}

export interface UseReActStreamOptions {
  onThought?: (thought: ReActThought) => void;
  onAction?: (action: ReActAction) => void;
  onObservation?: (observation: ReActObservation) => void;
  onComplete?: (result: unknown) => void;
  onError?: (error: string) => void;
}

export interface UseReActStreamResult<T> {
  /** Current reasoning steps being displayed */
  steps: ReActStep[];
  /** Whether the stream is currently active */
  isStreaming: boolean;
  /** Final result after stream completes */
  result: T | null;
  /** Error message if something went wrong */
  error: string | null;
  /** Start streaming from an endpoint */
  startStream: (url: string, body: Record<string, unknown>) => Promise<void>;
  /** Abort the current stream */
  abort: () => void;
  /** Clear all state */
  reset: () => void;
}

export function useReActStream<T = unknown>(
  options: UseReActStreamOptions = {}
): UseReActStreamResult<T> {
  const [steps, setSteps] = useState<ReActStep[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [result, setResult] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setSteps([]);
    setResult(null);
    setError(null);
    setIsStreaming(false);
  }, []);

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const startStream = useCallback(async (url: string, body: Record<string, unknown>) => {
    // Reset state
    setSteps([]);
    setResult(null);
    setError(null);
    setIsStreaming(true);

    // Create abort controller
    abortControllerRef.current = new AbortController();

    try {
      // Add stream=true to URL
      const streamUrl = url.includes("?") ? `${url}&stream=true` : `${url}?stream=true`;

      const response = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Stream failed" }));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body for streaming");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();

            if (data === "[DONE]") {
              setIsStreaming(false);
              continue;
            }

            try {
              const event = JSON.parse(data);

              switch (event.type) {
                case "thought": {
                  const thought: ReActThought = {
                    iteration: event.iteration,
                    thought: event.thought,
                    timestamp: event.timestamp,
                  };
                  setSteps(prev => [...prev, {
                    type: "thought",
                    iteration: thought.iteration,
                    content: thought.thought,
                    timestamp: thought.timestamp,
                  }]);
                  options.onThought?.(thought);
                  break;
                }

                case "action": {
                  const action: ReActAction = {
                    iteration: event.iteration,
                    tool: event.tool,
                    args: event.args,
                    timestamp: event.timestamp,
                  };
                  setSteps(prev => [...prev, {
                    type: "action",
                    iteration: action.iteration,
                    content: `Calling ${action.tool}`,
                    tool: action.tool,
                    timestamp: action.timestamp,
                  }]);
                  options.onAction?.(action);
                  break;
                }

                case "observation": {
                  const observation: ReActObservation = {
                    iteration: event.iteration,
                    observation: event.observation,
                    timestamp: event.timestamp,
                  };
                  setSteps(prev => [...prev, {
                    type: "observation",
                    iteration: observation.iteration,
                    content: observation.observation,
                    timestamp: observation.timestamp,
                  }]);
                  options.onObservation?.(observation);
                  break;
                }

                case "final": {
                  setResult(event.result as T);
                  setIsStreaming(false);
                  options.onComplete?.(event.result);
                  break;
                }

                case "error": {
                  setError(event.error);
                  setIsStreaming(false);
                  options.onError?.(event.error);
                  break;
                }
              }
            } catch (parseError) {
              console.warn("[useReActStream] Failed to parse SSE event:", data, parseError);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User aborted - not an error
        setIsStreaming(false);
        return;
      }

      const errorMessage = err instanceof Error ? err.message : "Stream failed";
      setError(errorMessage);
      setIsStreaming(false);
      options.onError?.(errorMessage);
    }
  }, [options]);

  return {
    steps,
    isStreaming,
    result,
    error,
    startStream,
    abort,
    reset,
  };
}
