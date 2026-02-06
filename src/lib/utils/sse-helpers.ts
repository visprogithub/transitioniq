/**
 * SSE (Server-Sent Events) Helpers for streaming progress
 * Used by API routes to emit real-time progress steps to the client
 */

import type { ProgressStep } from "@/components/ProgressSteps";

/**
 * Create an SSE stream for emitting progress events
 * Takes an async executor function that does the work
 */
export function createProgressStream(
  executor: (emitStep: (step: ProgressStep) => void, emitResult: (result: unknown) => void, emitError: (error: string) => void) => Promise<void>
) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emitStep = (step: ProgressStep) => {
        const data = `data: ${JSON.stringify({ type: "step", step })}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      const emitError = (error: string) => {
        const data = `data: ${JSON.stringify({ type: "error", error })}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      const emitResult = (result: unknown) => {
        const data = `data: ${JSON.stringify({ type: "result", result })}\n\n`;
        controller.enqueue(encoder.encode(data));
      };

      try {
        await executor(emitStep, emitResult, emitError);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        emitError(errorMsg);
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return stream;
}

/**
 * Wrap an async operation with progress tracking
 * Automatically updates step status from pending → in_progress → completed/error
 */
export async function withProgress<T>(
  emitStep: (step: ProgressStep) => void,
  stepId: string,
  label: string,
  type: ProgressStep["type"],
  operation: () => Promise<T>,
  detail?: string
): Promise<T> {
  const startTime = Date.now();

  // Emit pending step
  emitStep({
    id: stepId,
    label,
    type,
    status: "pending",
    detail,
  });

  // Emit in_progress
  emitStep({
    id: stepId,
    label,
    type,
    status: "in_progress",
    detail,
  });

  try {
    const result = await operation();
    const duration = Date.now() - startTime;

    // Emit completed
    emitStep({
      id: stepId,
      label,
      type,
      status: "completed",
      detail,
      timestamp: duration,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorDetail = error instanceof Error ? error.message : String(error);

    // Emit error
    emitStep({
      id: stepId,
      label,
      type,
      status: "error",
      detail: errorDetail,
      timestamp: duration,
    });

    throw error;
  }
}
