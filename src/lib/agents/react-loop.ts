/**
 * ReAct Agent Loop - Genuine Reasoning + Acting implementation
 *
 * This module implements a true ReAct (Reasoning and Acting) agent loop where:
 * 1. The LLM reasons about the current state and what to do next (Thought)
 * 2. The LLM selects a tool and provides arguments (Action)
 * 3. The tool executes and returns results (Observation)
 * 4. The loop continues until the LLM decides it has enough information to respond
 *
 * Unlike hardcoded pipelines, the LLM dynamically decides:
 * - Which tools to call (not predetermined)
 * - In what order (based on observations)
 * - When to stop (based on gathered information)
 */

import { createLLMProvider, getActiveModelId } from "@/lib/integrations/llm-provider";
import { getOpikClient } from "@/lib/integrations/opik";
import { extractJsonObject } from "@/lib/utils/llm-json";
import { verifyGrounding, quickGroundingCheck, type GroundingResult } from "@/lib/verification/grounding";

// Maximum iterations to prevent infinite loops
const MAX_ITERATIONS = 10;

/**
 * Tool definition for ReAct agents
 */
export interface ReActTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * A single step in the ReAct loop
 */
export interface ReActStep {
  iteration: number;
  thought: string;
  action: {
    tool: string;
    args: Record<string, unknown>;
  } | null;
  observation: string | null;
  isFinal: boolean;
  finalAnswer?: string;
  timestamp: string;
}

/**
 * Result of a ReAct agent run
 */
export interface ReActResult {
  answer: string;
  steps: ReActStep[];
  toolsUsed: string[];
  iterations: number;
  reasoningTrace: string;
  /** Grounding verification result - checks if answer is supported by observations */
  grounding?: GroundingResult;
  metadata: {
    model: string;
    startTime: string;
    endTime: string;
    totalLatencyMs: number;
    totalTokens?: number;
    promptTokens?: number;
    completionTokens?: number;
    estimatedCostUsd?: number;
  };
}

/**
 * Options for running a ReAct agent
 */
export interface ReActOptions {
  systemPrompt: string;
  tools: ReActTool[];
  maxIterations?: number;
  traceId?: string;
  threadId?: string;
  metadata?: Record<string, unknown>;
  /**
   * Enable grounding verification - checks if final answer is supported by tool observations
   * "full" = LLM-based claim extraction and verification (slower, more accurate)
   * "quick" = Pattern-based checks for dosages, times, percentages (faster)
   * false/undefined = disabled
   */
  verifyGrounding?: "full" | "quick" | false;
}

/**
 * Build the ReAct system prompt with tool definitions
 */
function buildReActSystemPrompt(basePrompt: string, tools: ReActTool[]): string {
  const toolDescriptions = tools
    .map((t) => {
      const params = Object.entries(t.parameters.properties)
        .map(([name, prop]) => {
          const required = t.parameters.required.includes(name) ? " (required)" : " (optional)";
          return `    - ${name}: ${prop.type}${required} - ${prop.description || ""}`;
        })
        .join("\n");
      return `- ${t.name}: ${t.description}\n  Parameters:\n${params}`;
    })
    .join("\n\n");

  return `${basePrompt}

## ReAct Loop Instructions

You are a ReAct agent. For each user request, you will reason step-by-step and use tools to gather information before providing a final answer.

### Available Tools
${toolDescriptions}

### Response Format

At each step, respond with ONLY a valid JSON object in one of these two formats:

**If you need to use a tool:**
\`\`\`json
{
  "thought": "Your reasoning about what you know and what you need to find out next",
  "action": {
    "tool": "tool_name",
    "args": { "param1": "value1" }
  }
}
\`\`\`

**If you have enough information to give a final answer:**
\`\`\`json
{
  "thought": "Your reasoning about why you now have enough information",
  "final_answer": "Your complete answer to the user's question"
}
\`\`\`

### Important Rules
1. ALWAYS start with a thought explaining your reasoning
2. Only call ONE tool at a time - you'll see the result before deciding the next step
3. Use the observation from each tool to inform your next thought
4. When you have gathered enough information, provide a final_answer
5. Be thorough - call multiple tools if needed to give a complete answer
6. Your final_answer should synthesize all the information you gathered
7. NEVER make up information - only use what the tools return
8. If a tool returns an error or no useful info, reason about what to try next

### Example Flow
User: "What are the side effects of aspirin and should I be concerned?"

Step 1: {"thought": "I need to look up aspirin to find its side effects", "action": {"tool": "lookupMedication", "args": {"medicationName": "aspirin"}}}
[Observation: {side effects: [...], warnings: [...]}]

Step 2: {"thought": "I found the side effects. Now I should check if any are concerning based on the patient's conditions", "action": {"tool": "checkPatientRisks", "args": {...}}}
[Observation: {...}]

Step 3: {"thought": "I now have both the side effects and patient-specific risks. I can give a complete answer.", "final_answer": "Aspirin can cause... For you specifically..."}`;
}

/**
 * Parse the LLM response to extract thought, action, or final answer
 */
function parseReActResponse(content: string): {
  thought: string;
  action: { tool: string; args: Record<string, unknown> } | null;
  finalAnswer: string | null;
  parseError?: string;
} {
  // Strip any thinking tokens from models like Qwen3
  const cleanContent = content
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*/g, "")
    .trim();

  // Try to extract JSON from the response
  try {
    const parsed = extractJsonObject<{
      thought?: string;
      action?: { tool: string; args: Record<string, unknown> };
      final_answer?: string | object;
    }>(cleanContent);

    // Ensure final_answer is always a string (LLM may return object instead of string)
    let finalAnswer: string | null = null;
    if (parsed.final_answer) {
      finalAnswer = typeof parsed.final_answer === "string"
        ? parsed.final_answer
        : JSON.stringify(parsed.final_answer, null, 2);
    }

    return {
      thought: parsed.thought || "Analyzing...",
      action: parsed.action || null,
      finalAnswer,
    };
  } catch (error) {
    // Return parse error so caller can retry with LLM
    return {
      thought: "Parse error",
      action: null,
      finalAnswer: null,
      parseError: error instanceof Error ? error.message : "Failed to parse JSON",
    };
  }
}

/**
 * Run a ReAct agent loop
 *
 * @param userMessage - The user's input message/question
 * @param options - Configuration including system prompt and available tools
 * @returns The agent's final answer and full reasoning trace
 */
export async function runReActLoop(
  userMessage: string,
  options: ReActOptions
): Promise<ReActResult> {
  const startTime = Date.now();
  const maxIterations = options.maxIterations || MAX_ITERATIONS;
  const steps: ReActStep[] = [];
  const toolsUsed: string[] = [];

  // Aggregate token usage across all LLM calls
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  // Set up tracing
  const opik = getOpikClient();
  const trace = opik?.trace({
    name: "react-agent-loop",
    threadId: options.threadId,
    metadata: {
      ...options.metadata,
      model: getActiveModelId(),
      max_iterations: maxIterations,
      tool_count: options.tools.length,
    },
  });

  try {
    const provider = createLLMProvider();

    // Build the full system prompt with tool definitions
    const systemPrompt = buildReActSystemPrompt(options.systemPrompt, options.tools);

    // Build conversation history for multi-turn reasoning
    let conversationHistory = `User: ${userMessage}\n\n`;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const iterationSpan = trace?.span({
        name: `iteration-${iteration}`,
        type: "llm",
        metadata: { iteration },
      });

      // Call LLM to get next thought/action
      const prompt = `${conversationHistory}

Now provide your next step as JSON:`;

      const response = await provider.generate(prompt, {
        spanName: `react-step-${iteration}`,
        systemPrompt,
        metadata: {
          iteration,
          history_length: conversationHistory.length,
        },
      });

      // Aggregate token usage from this LLM call
      if (response.tokenUsage) {
        totalPromptTokens += response.tokenUsage.promptTokens;
        totalCompletionTokens += response.tokenUsage.completionTokens;
        totalTokens += response.tokenUsage.totalTokens;
      }

      // Log iteration token usage
      console.log(`[ReAct] Iteration ${iteration} - Tokens: prompt=${response.tokenUsage?.promptTokens || 0}, completion=${response.tokenUsage?.completionTokens || 0}, latency=${response.latencyMs}ms`);

      // Parse the response
      let parsed = parseReActResponse(response.content);

      // If parsing failed, ask LLM to retry with correct format (one retry only)
      if (parsed.parseError) {
        console.warn(`[ReAct] Parse error: ${parsed.parseError}, asking LLM to retry`);

        const retryPrompt = `Your previous response could not be parsed. Please respond with ONLY valid JSON in this exact format:

{"thought": "your reasoning here", "action": {"tool": "tool_name", "args": {}}}

OR for a final answer:

{"thought": "your reasoning here", "final_answer": "your complete answer"}

Your previous response was:
${response.content.slice(0, 500)}

Please fix and respond with valid JSON only:`;

        const retryResponse = await provider.generate(retryPrompt, {
          spanName: `react-step-${iteration}-retry`,
          systemPrompt,
          metadata: { iteration, retry: true },
        });

        if (retryResponse.tokenUsage) {
          totalPromptTokens += retryResponse.tokenUsage.promptTokens;
          totalCompletionTokens += retryResponse.tokenUsage.completionTokens;
          totalTokens += retryResponse.tokenUsage.totalTokens;
        }

        parsed = parseReActResponse(retryResponse.content);
        if (parsed.parseError) {
          console.error(`[ReAct] Retry also failed: ${parsed.parseError}`);
        }
      }

      const { thought, action, finalAnswer } = parsed;

      // Create step record
      const step: ReActStep = {
        iteration,
        thought,
        action,
        observation: null,
        isFinal: !!finalAnswer,
        finalAnswer: finalAnswer || undefined,
        timestamp: new Date().toISOString(),
      };

      // If we have a final answer, we're done
      if (finalAnswer) {
        steps.push(step);
        iterationSpan?.update({
          output: { thought, final_answer: finalAnswer },
          metadata: { is_final: true },
        });
        iterationSpan?.end();

        const endTime = Date.now();

        // Calculate estimated cost (approximate pricing per 1K tokens)
        const estimatedCost = totalTokens > 0 ? (totalPromptTokens * 0.00015 + totalCompletionTokens * 0.0006) / 1000 : undefined;

        // Log final aggregated token usage
        console.log(`[ReAct] Complete - Total tokens: ${totalTokens} (prompt: ${totalPromptTokens}, completion: ${totalCompletionTokens}), Est. cost: $${estimatedCost?.toFixed(6) || "N/A"}`);

        // Run grounding verification if enabled
        let grounding: GroundingResult | undefined;
        if (options.verifyGrounding) {
          const observations = steps
            .filter((s) => s.observation)
            .map((s) => s.observation as string);

          if (observations.length > 0) {
            if (options.verifyGrounding === "full") {
              console.log(`[ReAct] Running full grounding verification...`);
              grounding = await verifyGrounding(finalAnswer, observations);
              console.log(`[ReAct] Grounding: ${grounding.isGrounded ? "GROUNDED" : "UNGROUNDED"} (${grounding.groundedClaims}/${grounding.totalClaims} claims verified)`);
            } else if (options.verifyGrounding === "quick") {
              console.log(`[ReAct] Running quick grounding check...`);
              const quick = quickGroundingCheck(finalAnswer, observations);
              grounding = {
                isGrounded: !quick.suspicious,
                score: quick.suspicious ? 0.5 : 1,
                totalClaims: quick.flags.length,
                groundedClaims: 0,
                ungroundedClaims: quick.flags.map((f) => ({
                  claim: f,
                  isGrounded: false,
                  supportingEvidence: null,
                  confidence: "medium" as const,
                })),
                allClaims: [],
              };
              if (quick.suspicious) {
                console.log(`[ReAct] Quick check flags: ${quick.flags.join(", ")}`);
              }
            }
          }
        }

        trace?.update({
          output: {
            answer: finalAnswer,
            iterations: iteration,
            tools_used: toolsUsed,
            grounding_verified: grounding?.isGrounded,
            grounding_score: grounding?.score,
          },
          metadata: {
            total_tokens: totalTokens,
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            estimated_cost_usd: estimatedCost,
            total_latency_ms: endTime - startTime,
          },
        });
        trace?.end();

        return {
          answer: finalAnswer,
          steps,
          toolsUsed: [...new Set(toolsUsed)],
          iterations: iteration,
          reasoningTrace: steps.map((s) => `[${s.iteration}] ${s.thought}`).join("\n"),
          grounding,
          metadata: {
            model: getActiveModelId(),
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            totalLatencyMs: endTime - startTime,
            totalTokens: totalTokens || undefined,
            promptTokens: totalPromptTokens || undefined,
            completionTokens: totalCompletionTokens || undefined,
            estimatedCostUsd: estimatedCost,
          },
        };
      }

      // If we have an action, execute the tool
      if (action) {
        const tool = options.tools.find((t) => t.name === action.tool);

        if (!tool) {
          step.observation = `Error: Unknown tool "${action.tool}". Available tools: ${options.tools.map((t) => t.name).join(", ")}`;
        } else {
          const toolSpan = trace?.span({
            name: `tool-${action.tool}`,
            type: "tool",
            metadata: {
              tool: action.tool,
              args: action.args,
            },
          });

          try {
            const result = await tool.execute(action.args);
            step.observation = JSON.stringify(result, null, 2);
            toolsUsed.push(action.tool);

            toolSpan?.update({
              output: { result },
              metadata: { success: true },
            });
          } catch (error) {
            step.observation = `Error executing ${action.tool}: ${error instanceof Error ? error.message : String(error)}`;
            toolSpan?.update({
              output: { error: step.observation },
              metadata: { success: false },
            });
          }

          toolSpan?.end();
        }
      } else {
        // No action and no final answer - shouldn't happen, but handle it
        step.observation = "No action specified. Please provide either an action or a final_answer.";
      }

      steps.push(step);

      // Update conversation history with this step
      conversationHistory += `Assistant: ${JSON.stringify({ thought, action }, null, 2)}\n`;
      conversationHistory += `Observation: ${step.observation}\n\n`;

      iterationSpan?.update({
        output: { thought, action, observation: step.observation },
        metadata: { is_final: false },
      });
      iterationSpan?.end();
    }

    // If we hit max iterations without a final answer, synthesize one
    const fallbackAnswer = `I've gathered information through ${steps.length} steps but reached the iteration limit. Based on what I found: ${steps
      .filter((s) => s.observation)
      .map((s) => s.observation)
      .slice(-3)
      .join(" ")}`;

    const endTime = Date.now();
    const estimatedCost = totalTokens > 0 ? (totalPromptTokens * 0.00015 + totalCompletionTokens * 0.0006) / 1000 : undefined;

    console.log(`[ReAct] Max iterations reached - Total tokens: ${totalTokens} (prompt: ${totalPromptTokens}, completion: ${totalCompletionTokens}), Est. cost: $${estimatedCost?.toFixed(6) || "N/A"}`);

    trace?.update({
      output: {
        answer: fallbackAnswer,
        iterations: maxIterations,
        tools_used: toolsUsed,
        hit_max_iterations: true,
      },
      metadata: {
        total_tokens: totalTokens,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        estimated_cost_usd: estimatedCost,
        total_latency_ms: endTime - startTime,
      },
    });
    trace?.end();

    return {
      answer: fallbackAnswer,
      steps,
      toolsUsed: [...new Set(toolsUsed)],
      iterations: maxIterations,
      reasoningTrace: steps.map((s) => `[${s.iteration}] ${s.thought}`).join("\n"),
      metadata: {
        model: getActiveModelId(),
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        totalLatencyMs: endTime - startTime,
        totalTokens: totalTokens || undefined,
        promptTokens: totalPromptTokens || undefined,
        completionTokens: totalCompletionTokens || undefined,
        estimatedCostUsd: estimatedCost,
      },
    };
  } catch (error) {
    const endTime = Date.now();
    const estimatedCost = totalTokens > 0 ? (totalPromptTokens * 0.00015 + totalCompletionTokens * 0.0006) / 1000 : undefined;

    console.error(`[ReAct] Error - Total tokens before failure: ${totalTokens}, Est. cost: $${estimatedCost?.toFixed(6) || "N/A"}`);

    trace?.update({
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        total_tokens: totalTokens,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        estimated_cost_usd: estimatedCost,
        total_latency_ms: endTime - startTime,
      },
    });
    trace?.end();
    throw error;
  }
}

/**
 * Create a ReAct tool from a simple function
 */
export function createReActTool(
  name: string,
  description: string,
  parameters: ReActTool["parameters"],
  execute: (args: Record<string, unknown>) => Promise<unknown>
): ReActTool {
  return { name, description, parameters, execute };
}

/**
 * Streaming event types for ReAct loop
 */
export type ReActStreamEvent =
  | { type: "thought"; iteration: number; thought: string; timestamp: string }
  | { type: "action"; iteration: number; tool: string; args: Record<string, unknown>; timestamp: string }
  | { type: "observation"; iteration: number; observation: string; timestamp: string }
  | { type: "final"; answer: string; result: ReActResult }
  | { type: "error"; error: string; partialResult?: Partial<ReActResult> };

/**
 * Run a streaming ReAct agent loop that yields events as they happen
 *
 * @param userMessage - The user's input message/question
 * @param options - Configuration including system prompt and available tools
 * @yields ReActStreamEvent - Events for each step of the reasoning process
 */
export async function* runReActLoopStreaming(
  userMessage: string,
  options: ReActOptions
): AsyncGenerator<ReActStreamEvent, void, unknown> {
  const startTime = Date.now();
  const maxIterations = options.maxIterations || MAX_ITERATIONS;
  const steps: ReActStep[] = [];
  const toolsUsed: string[] = [];

  // Aggregate token usage across all LLM calls
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;

  // Set up tracing
  const opik = getOpikClient();
  const trace = opik?.trace({
    name: "react-agent-loop-streaming",
    threadId: options.threadId,
    metadata: {
      ...options.metadata,
      model: getActiveModelId(),
      max_iterations: maxIterations,
      tool_count: options.tools.length,
      streaming: true,
    },
  });

  try {
    // Build the full system prompt with tool definitions
    const systemPrompt = buildReActSystemPrompt(options.systemPrompt, options.tools);
    const provider = createLLMProvider();

    // Build conversation history for multi-turn reasoning
    let conversationHistory = `User: ${userMessage}\n\n`;

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      const iterationSpan = trace?.span({
        name: `iteration-${iteration}`,
        type: "llm",
        metadata: { iteration },
      });

      // Call LLM to get next thought/action
      const prompt = `${conversationHistory}

Now provide your next step as JSON:`;

      const response = await provider.generate(prompt, {
        spanName: `react-step-${iteration}`,
        systemPrompt,
        metadata: {
          iteration,
          history_length: conversationHistory.length,
        },
      });

      // Aggregate token usage from this LLM call
      if (response.tokenUsage) {
        totalPromptTokens += response.tokenUsage.promptTokens;
        totalCompletionTokens += response.tokenUsage.completionTokens;
        totalTokens += response.tokenUsage.totalTokens;
      }

      // Parse the response
      const { thought, action, finalAnswer } = parseReActResponse(response.content);
      const timestamp = new Date().toISOString();

      // Yield thought event
      yield { type: "thought", iteration, thought, timestamp };

      // Create step record
      const step: ReActStep = {
        iteration,
        thought,
        action,
        observation: null,
        isFinal: !!finalAnswer,
        finalAnswer: finalAnswer || undefined,
        timestamp,
      };

      // If we have a final answer, we're done
      if (finalAnswer) {
        steps.push(step);
        iterationSpan?.update({
          output: { thought, final_answer: finalAnswer },
          metadata: { is_final: true },
        });
        iterationSpan?.end();

        const endTime = Date.now();
        const estimatedCost = totalTokens > 0 ? (totalPromptTokens * 0.00015 + totalCompletionTokens * 0.0006) / 1000 : undefined;

        trace?.update({
          output: {
            answer: finalAnswer,
            iterations: iteration,
            tools_used: toolsUsed,
          },
          metadata: {
            total_tokens: totalTokens,
            prompt_tokens: totalPromptTokens,
            completion_tokens: totalCompletionTokens,
            estimated_cost_usd: estimatedCost,
            total_latency_ms: endTime - startTime,
          },
        });
        trace?.end();

        const result: ReActResult = {
          answer: finalAnswer,
          steps,
          toolsUsed: [...new Set(toolsUsed)],
          iterations: iteration,
          reasoningTrace: steps.map((s) => `[${s.iteration}] ${s.thought}`).join("\n"),
          metadata: {
            model: getActiveModelId(),
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            totalLatencyMs: endTime - startTime,
            totalTokens: totalTokens || undefined,
            promptTokens: totalPromptTokens || undefined,
            completionTokens: totalCompletionTokens || undefined,
            estimatedCostUsd: estimatedCost,
          },
        };

        yield { type: "final", answer: finalAnswer, result };
        return;
      }

      // If we have an action, yield action event then execute the tool
      if (action) {
        yield { type: "action", iteration, tool: action.tool, args: action.args, timestamp };

        const tool = options.tools.find((t) => t.name === action.tool);

        if (!tool) {
          step.observation = `Error: Unknown tool "${action.tool}". Available tools: ${options.tools.map((t) => t.name).join(", ")}`;
        } else {
          const toolSpan = trace?.span({
            name: `tool-${action.tool}`,
            type: "tool",
            metadata: {
              tool: action.tool,
              args: action.args,
            },
          });

          try {
            const result = await tool.execute(action.args);
            step.observation = JSON.stringify(result, null, 2);
            toolsUsed.push(action.tool);

            toolSpan?.update({
              output: { result },
              metadata: { success: true },
            });
          } catch (error) {
            step.observation = `Error executing ${action.tool}: ${error instanceof Error ? error.message : String(error)}`;
            toolSpan?.update({
              output: { error: step.observation },
              metadata: { success: false },
            });
          }

          toolSpan?.end();
        }

        // Yield observation event
        yield { type: "observation", iteration, observation: step.observation, timestamp: new Date().toISOString() };
      } else {
        // No action and no final answer - shouldn't happen, but handle it
        step.observation = "No action specified. Please provide either an action or a final_answer.";
        yield { type: "observation", iteration, observation: step.observation, timestamp: new Date().toISOString() };
      }

      steps.push(step);

      // Update conversation history with this step
      conversationHistory += `Assistant: ${JSON.stringify({ thought, action }, null, 2)}\n`;
      conversationHistory += `Observation: ${step.observation}\n\n`;

      iterationSpan?.update({
        output: { thought, action, observation: step.observation },
        metadata: { is_final: false },
      });
      iterationSpan?.end();
    }

    // If we hit max iterations without a final answer, synthesize one
    const fallbackAnswer = `I've gathered information through ${steps.length} steps but reached the iteration limit. Based on what I found: ${steps
      .filter((s) => s.observation)
      .map((s) => s.observation)
      .slice(-3)
      .join(" ")}`;

    const endTime = Date.now();
    const estimatedCost = totalTokens > 0 ? (totalPromptTokens * 0.00015 + totalCompletionTokens * 0.0006) / 1000 : undefined;

    trace?.update({
      output: {
        answer: fallbackAnswer,
        iterations: maxIterations,
        tools_used: toolsUsed,
        hit_max_iterations: true,
      },
      metadata: {
        total_tokens: totalTokens,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        estimated_cost_usd: estimatedCost,
        total_latency_ms: endTime - startTime,
      },
    });
    trace?.end();

    const result: ReActResult = {
      answer: fallbackAnswer,
      steps,
      toolsUsed: [...new Set(toolsUsed)],
      iterations: maxIterations,
      reasoningTrace: steps.map((s) => `[${s.iteration}] ${s.thought}`).join("\n"),
      metadata: {
        model: getActiveModelId(),
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        totalLatencyMs: endTime - startTime,
        totalTokens: totalTokens || undefined,
        promptTokens: totalPromptTokens || undefined,
        completionTokens: totalCompletionTokens || undefined,
        estimatedCostUsd: estimatedCost,
      },
    };

    yield { type: "final", answer: fallbackAnswer, result };
  } catch (error) {
    const endTime = Date.now();
    const estimatedCost = totalTokens > 0 ? (totalPromptTokens * 0.00015 + totalCompletionTokens * 0.0006) / 1000 : undefined;

    console.error(`[ReAct Streaming] Error - Total tokens before failure: ${totalTokens}`);

    trace?.update({
      metadata: {
        error: error instanceof Error ? error.message : String(error),
        error_stack: error instanceof Error ? error.stack : undefined,
        total_tokens: totalTokens,
        prompt_tokens: totalPromptTokens,
        completion_tokens: totalCompletionTokens,
        estimated_cost_usd: estimatedCost,
        total_latency_ms: endTime - startTime,
      },
    });
    trace?.end();

    yield {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
      partialResult: {
        steps,
        toolsUsed: [...new Set(toolsUsed)],
        iterations: steps.length,
        reasoningTrace: steps.map((s) => `[${s.iteration}] ${s.thought}`).join("\n"),
      },
    };
  }
}

/**
 * Create a ReadableStream from ReAct streaming events for SSE responses
 */
export function createReActSSEStream(
  generator: AsyncGenerator<ReActStreamEvent, void, unknown>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of generator) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const errorEvent: ReActStreamEvent = {
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
        controller.close();
      }
    },
  });
}
