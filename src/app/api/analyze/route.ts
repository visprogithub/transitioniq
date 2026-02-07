import { NextRequest, NextResponse } from "next/server";
import { getPatient } from "@/lib/data/demo-patients";
// FDA client functions now called via executeTool() from tools.ts
import { getOpikClient, traceError, traceDataSourceCall, flushTraces } from "@/lib/integrations/opik";
import { getActiveModelId, isModelLimitError, getAvailableModels } from "@/lib/integrations/llm-provider";
import { executeTool } from "@/lib/agents/tools";
import { runAgent, getSession } from "@/lib/agents/orchestrator";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { pinModelForRequest, logErrorTrace } from "@/lib/utils/api-helpers";
import { createProgressStream, withProgress } from "@/lib/utils/sse-helpers";
import type { Patient } from "@/lib/types/patient";
import type { DischargeAnalysis } from "@/lib/types/analysis";

export async function POST(request: NextRequest) {
  // Rate limit: agent pipeline (1-7 LLM calls)
  const blocked = applyRateLimit(request, "analyze");
  if (blocked) return blocked;

  const body = await request.json();
  const { patientId, useAgent = true, sessionId, modelId, stream = false } = body;

  // If streaming requested, use SSE
  if (stream) {
    return handleStreamingAnalysis(request, patientId, modelId);
  }

  // Otherwise, use regular JSON response
  const opik = getOpikClient();
  const trace = opik?.trace({
    name: "discharge-analysis",
    metadata: {
      model: getActiveModelId(),
      category: "analysis",
    },
  });

  try {

    // Pin the model for this request if explicitly provided
    pinModelForRequest(modelId, "Analyze");

    if (!patientId) {
      return NextResponse.json({ error: "patientId required" }, { status: 400 });
    }

    // Get patient data
    const patient = getPatient(patientId);
    if (!patient) {
      return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    }

    // Track whether agent fallback occurs
    let agentFallbackOccurred = false;
    let agentFallbackError: string | undefined;

    // Use the TypeScript agent orchestrator for multi-turn analysis
    if (useAgent) {
      console.log("[Analyze] Using multi-turn agent orchestrator");

      try {
        // Run the agent with ReAct-style loop
        const agentResponse = await runAgent({
          patientId,
          sessionId,
          message: `Assess discharge readiness for patient ${patientId}`,
        });

        // Get session for additional context
        const session = getSession(agentResponse.sessionId);

        // Check if agent produced a valid analysis
        if (!agentResponse.analysis || agentResponse.analysis.score === undefined) {
          // Agent ran but did not produce analysis — likely LLM error
          // Find which tools failed
          const failedTools = agentResponse.toolsUsed
            .filter(t => !t.success)
            .map(t => `${t.tool}: ${t.error || "unknown error"}`);
          const errorDetail = failedTools.length > 0
            ? `Tool failures: ${failedTools.join("; ")}`
            : agentResponse.message || "Agent did not produce analysis results";

          await traceError("api-analyze-agent-no-result", new Error(errorDetail), { patientId });

          return NextResponse.json(
            {
              error: `Analysis failed with ${getActiveModelId()}: ${errorDetail}`,
              modelUsed: getActiveModelId(),
              agentUsed: true,
              toolsUsed: agentResponse.toolsUsed,
              agentGraph: agentResponse.agentGraph,
              sessionId: agentResponse.sessionId,
            },
            { status: 502 }
          );
        }

        // End route-level trace on success
        trace?.update({
          output: {
            success: true,
            score: agentResponse.analysis.score,
            status: agentResponse.analysis.status,
            agent: true,
          },
        });
        trace?.end();
        await flushTraces();

        // Return agent response with full context
        return NextResponse.json({
          // Analysis results
          score: agentResponse.analysis.score,
          status: agentResponse.analysis.status,
          riskFactors: agentResponse.analysis.riskFactors || [],
          recommendations: agentResponse.analysis.recommendations || [],
          analyzedAt: new Date().toISOString(),

          // Agent execution metadata
          modelUsed: agentResponse.analysis.modelUsed || getActiveModelId(),
          modelRequested: getActiveModelId(),
          agentUsed: true,
          agentFallbackUsed: false,
          sessionId: agentResponse.sessionId,
          message: agentResponse.message,
          toolsUsed: agentResponse.toolsUsed,
          agentGraph: agentResponse.agentGraph,
          suggestedActions: agentResponse.suggestedActions,

          // Session context
          steps: session?.steps || [],
          conversationHistory: session?.context.conversationHistory || [],
        });
      } catch (agentError) {
        agentFallbackOccurred = true;
        agentFallbackError = agentError instanceof Error ? agentError.message : String(agentError);
        console.warn("[Analyze] Agent error, falling back to direct LLM:", agentFallbackError);
        await traceError("api-analyze-agent-fallback", agentError, { patientId });
        // Fall through to direct LLM implementation
      }
    }

    // Fallback: Direct tool execution (same tools as agent, without DAG orchestration)
    console.log("[Analyze] Agent failed, using direct tool execution fallback");

    // Run data gathering in parallel using the same tools as the agent
    const [interactionsResult, warningsResult, recallsResult, gapsResult, costsResult, knowledgeResult] = await Promise.all([
      executeTool("check_drug_interactions", { medications: patient.medications }),
      executeTool("check_boxed_warnings", { medications: patient.medications }),
      executeTool("check_drug_recalls", { medications: patient.medications }),
      executeTool("evaluate_care_gaps", { patient }),
      executeTool("estimate_costs", { medications: patient.medications }),
      executeTool("retrieve_knowledge", { patient }),
    ]);

    // Run LLM analysis with all gathered data
    const analysisResult = await executeTool("analyze_readiness", {
      patient,
      drugInteractions: interactionsResult.success ? interactionsResult.data : [],
      boxedWarnings: warningsResult.success ? warningsResult.data : [],
      recalls: recallsResult.success ? recallsResult.data : [],
      careGaps: gapsResult.success ? gapsResult.data : [],
      costs: costsResult.success ? costsResult.data : [],
      knowledgeContext: knowledgeResult.success ? knowledgeResult.data : undefined,
    });

    if (!analysisResult.success || !analysisResult.data) {
      return NextResponse.json(
        { error: `Analysis failed: ${analysisResult.error || "Unknown error"}` },
        { status: 502 }
      );
    }

    const fallbackAnalysis = analysisResult.data as DischargeAnalysis;

    // End route-level trace on success (direct tool fallback path)
    trace?.update({
      output: {
        success: true,
        score: fallbackAnalysis.score,
        status: fallbackAnalysis.status,
        agent: false,
        agentFallback: agentFallbackOccurred,
      },
    });
    trace?.end();

    // Flush all Opik traces before returning (single flush covers all LLM spans)
    await flushTraces();

    // Include model info in response with fallback transparency
    return NextResponse.json({
      ...fallbackAnalysis,
      modelUsed: fallbackAnalysis.modelUsed || getActiveModelId(),
      modelRequested: getActiveModelId(),
      agentUsed: false,
      agentFallbackUsed: agentFallbackOccurred,
      agentFallbackReason: agentFallbackError,
    });
  } catch (error) {
    // Log error to Opik trace
    logErrorTrace(trace, error);
    await traceError("api-analyze", error);

    // Check if this is a rate limit or usage limit error
    // Return a special response so frontend can prompt user to switch models
    if (isModelLimitError(error)) {
      const availableModels = getAvailableModels();
      const otherModels = availableModels.filter((m) => m !== error.modelId);

      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          modelId: error.modelId,
          provider: error.provider,
          suggestModelSwitch: true,
          availableModels: otherModels,
        },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analysis failed" },
      { status: 500 }
    );
  }
}

// Note: Drug interactions now use OpenFDA Drug Label API (fda-client.ts)
// Note: Medication cost estimation now uses the CMS client (cms-client.ts)
// which provides real Medicare Part D pricing data via CMS Open Data APIs

/**
 * Handle streaming analysis with SSE progress updates
 */
async function handleStreamingAnalysis(
  request: NextRequest,
  patientId: string,
  modelId?: string
) {
  const { stream, emitStep, emitResult, emitError, complete } = createProgressStream();

  // Create route-level Opik trace for the streaming analysis
  const opik = getOpikClient();
  const threadId = `analyze-${patientId}`;
  const trace = opik?.trace({
    name: "discharge-analysis-stream",
    threadId,
    metadata: {
      model: getActiveModelId(),
      category: "analysis",
      streaming: true,
      patientId,
    },
  });

  // Start async work that emits progress events
  (async () => {
    try {
      // Pin model if provided
      if (modelId) {
        pinModelForRequest(modelId, "Analyze-Stream");
      }

      // Get patient
      const patient = getPatient(patientId);
      if (!patient) {
        emitError("Patient not found");
        complete();
        return;
      }

      // Step 1: Check drug interactions (FDA Drug Labels)
      const interactionsResult = await withProgress(
        emitStep,
        "fda-interactions",
        "Checking drug interactions (FDA)",
        "data_source",
        async () => {
          const { result } = await traceDataSourceCall("FDA-Interactions", patientId,
            () => executeTool("check_drug_interactions", { medications: patient.medications }),
            { threadId }
          );
          return result;
        }
      );
      const drugInteractions = (interactionsResult.success ? interactionsResult.data : []) as unknown[];

      // Step 2: Check for FDA Black Box Warnings
      const warningsResult = await withProgress(
        emitStep,
        "fda-boxed-warnings",
        "Checking FDA Black Box Warnings",
        "data_source",
        async () => {
          const { result } = await traceDataSourceCall("FDA-BoxedWarnings", patientId,
            () => executeTool("check_boxed_warnings", { medications: patient.medications }),
            { threadId }
          );
          return result;
        }
      );
      const boxedWarnings = (warningsResult.success ? warningsResult.data : []) as unknown[];

      // Step 3: Check for drug recalls (check all medications)
      const recallsResult = await withProgress(
        emitStep,
        "fda-recalls",
        `Checking FDA recalls for ${patient.medications.length} medications`,
        "data_source",
        async () => {
          const { result } = await traceDataSourceCall("FDA-Recalls", patientId,
            () => executeTool("check_drug_recalls", { medications: patient.medications }),
            { threadId }
          );
          return result;
        }
      );
      const recalls = (recallsResult.success ? recallsResult.data : []) as unknown[];

      // Step 4: Evaluate care gaps (Rules + MyHealthfinder + LLM augmentation)
      const careGapsResult = await withProgress(
        emitStep,
        "guidelines",
        "Evaluating care gaps (Guidelines + MyHealthfinder + LLM)",
        "data_source",
        async () => {
          const { result } = await traceDataSourceCall("Guidelines", patientId,
            () => executeTool("evaluate_care_gaps", { patient }),
            { threadId }
          );
          return result;
        }
      );
      const careGaps = (careGapsResult.success ? careGapsResult.data : []) as Array<{
        guideline: string;
        status: string;
        grade: string;
      }>;

      // Step 5: Estimate medication costs (CMS + LLM reasoning)
      const costsResult = await withProgress(
        emitStep,
        "cms",
        "Estimating medication costs (CMS + LLM)",
        "data_source",
        async () => {
          const { result } = await traceDataSourceCall("CMS", patientId,
            () => executeTool("estimate_costs", { medications: patient.medications }),
            { threadId }
          );
          return result;
        }
      );
      const costEstimates = (costsResult.success ? costsResult.data : []) as Array<{
        medication: string;
        monthlyOOP: number;
        covered: boolean;
      }>;

      // Step 6: Retrieve clinical knowledge (TF-IDF RAG + LLM synthesis)
      const knowledgeResult = await withProgress(
        emitStep,
        "knowledge-retrieval",
        "Retrieving clinical knowledge (TF-IDF RAG)",
        "tool",
        async () => {
          const { result } = await traceDataSourceCall("Guidelines", patientId,
            () => executeTool("retrieve_knowledge", { patient }),
            { threadId }
          );
          return result;
        }
      );
      const knowledgeContext = knowledgeResult.success ? knowledgeResult.data : undefined;

      // Step 7: Run LLM analysis with all data sources via agent tool
      // All data is already in the correct format from executeTool() calls above
      const analysisResult = await withProgress(
        emitStep,
        "llm",
        "Analyzing discharge readiness",
        "llm",
        async () => {
          return await executeTool("analyze_readiness", {
            patient,
            drugInteractions,
            boxedWarnings,
            recalls,
            careGaps,
            costs: costEstimates,
            knowledgeContext,
          });
        }
      );

      if (!analysisResult.success || !analysisResult.data) {
        emitError(`Analysis failed: ${analysisResult.error || "Unknown error"}`);
        complete();
        return;
      }

      const analysis = analysisResult.data as DischargeAnalysis;

      // End route-level Opik trace on success
      trace?.update({
        output: {
          success: true,
          score: analysis.score,
          status: analysis.status,
          riskFactorCount: analysis.riskFactors?.length || 0,
          streaming: true,
        },
      });
      trace?.end();

      // Send final result
      emitResult({
        ...analysis,
        modelUsed: analysis.modelUsed || getActiveModelId(),
        modelRequested: getActiveModelId(),
        agentUsed: true,
      });

      // Flush Opik traces before closing stream
      await flushTraces();

      // Close stream
      complete();
    } catch (error) {
      // End route-level trace on error
      if (trace) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        trace.update({
          errorInfo: {
            exceptionType: error instanceof Error ? error.name : "Error",
            message: errorMessage,
            traceback: error instanceof Error ? (error.stack ?? errorMessage) : errorMessage,
          },
        });
        trace.end();
      }
      traceError("api-analyze-stream", error);
      emitError(error instanceof Error ? error.message : "Analysis failed");
      complete();
    }
  })();

  // Return SSE stream immediately
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
