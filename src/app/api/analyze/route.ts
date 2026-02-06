import { NextRequest, NextResponse } from "next/server";
import { getPatient } from "@/lib/data/demo-patients";
import { checkDrugInteractionsEnhanced, type DrugInteraction } from "@/lib/integrations/fda-client";
import { evaluateCareGaps } from "@/lib/integrations/guidelines-client";
import { estimateMedicationCosts as estimateCMSMedicationCosts } from "@/lib/integrations/cms-client";
import { analyzeDischargeReadiness } from "@/lib/integrations/analysis";
import { getOpikClient, traceDataSourceCall, traceError, flushTraces } from "@/lib/integrations/opik";
import { getActiveModelId, isModelLimitError, getAvailableModels } from "@/lib/integrations/llm-provider";
import { runAgent, getSession } from "@/lib/agents/orchestrator";
import { applyRateLimit } from "@/lib/middleware/rate-limiter";
import { pinModelForRequest, logErrorTrace } from "@/lib/utils/api-helpers";
import { createProgressStream, withProgress } from "@/lib/utils/sse-helpers";
import type { Patient } from "@/lib/types/patient";

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

          console.error(`[Analyze] Agent completed without analysis. ${errorDetail}`);

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

    // Fallback: Direct LLM implementation (single-turn)
    console.log("[Analyze] Using direct LLM (single-turn)");

    // Run data gathering in parallel with Opik tracing
    const [drugInteractionsResult, careGapsResult] = await Promise.all([
      traceDataSourceCall("FDA", patientId, async () => {
        return await checkDrugInteractionsEnhanced(patient.medications);
      }),
      traceDataSourceCall("Guidelines", patientId, async () => {
        return evaluateCareGaps(patient);
      }),
    ]);

    const drugInteractions = drugInteractionsResult.result;
    const careGaps = careGapsResult.result;

    // Get unmet care gaps for analysis
    const unmetCareGaps = careGaps.filter((g) => g.status === "unmet");

    // Build cost estimates using CMS pricing API with Opik tracing
    const costEstimatesResult = await traceDataSourceCall("CMS", patientId, async () => {
      const estimates = await estimateCMSMedicationCosts(patient.medications);
      return estimates.map((e) => ({
        medication: e.drugName,
        monthlyOOP: e.estimatedMonthlyOOP,
        covered: e.coveredByMedicarePartD,
      }));
    });
    const costEstimates = costEstimatesResult.result;

    // REQUIRED: Use real LLM for analysis - no fallback
    // Check if any LLM API key is configured (supports multiple providers)
    const hasLLMKey = process.env.GEMINI_API_KEY ||
                      process.env.OPENAI_API_KEY ||
                      process.env.ANTHROPIC_API_KEY ||
                      process.env.HF_API_KEY;
    if (!hasLLMKey) {
      return NextResponse.json(
        { error: "No LLM API key configured. Set GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY, or HF_API_KEY." },
        { status: 500 }
      );
    }

    // Run LLM analysis (uses the active model via LLMProvider)
    const analysis = await analyzeDischargeReadiness(
      patient,
      drugInteractions,
      unmetCareGaps.map((g) => ({
        guideline: g.guideline,
        recommendation: g.recommendation,
        grade: g.grade,
        status: g.status,
      })),
      costEstimates
    );

    // End route-level trace on success (direct LLM path)
    trace?.update({
      output: {
        success: true,
        score: analysis.score,
        status: analysis.status,
        agent: false,
        agentFallback: agentFallbackOccurred,
      },
    });
    trace?.end();

    // Flush all Opik traces before returning (single flush covers all LLM spans)
    await flushTraces();

    // Include model info in response with fallback transparency
    return NextResponse.json({
      ...analysis,
      modelUsed: analysis.modelUsed || getActiveModelId(),
      modelRequested: getActiveModelId(),
      agentUsed: false,
      agentFallbackUsed: agentFallbackOccurred,
      agentFallbackReason: agentFallbackError,
    });
  } catch (error) {
    console.error("Analysis error:", error);

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

// Note: Drug interactions now use RxNorm API + FAERS enrichment (fda-client.ts)
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

      // Step 1: Check drug interactions (FDA with FAERS enrichment)
      const drugInteractions = await withProgress(
        emitStep,
        "fda",
        "Checking drug interactions (FDA + FAERS)",
        "data_source",
        async () => {
          return await checkDrugInteractionsEnhanced(patient.medications);
        }
      );

      // Step 2: Evaluate care gaps
      const careGaps = await withProgress(
        emitStep,
        "guidelines",
        "Evaluating care gaps",
        "data_source",
        async () => {
          return evaluateCareGaps(patient);
        }
      );

      const unmetCareGaps = careGaps.filter((g) => g.status === "unmet");

      // Step 3: Estimate medication costs (CMS)
      const costEstimates = await withProgress(
        emitStep,
        "cms",
        "Estimating medication costs (CMS)",
        "data_source",
        async () => {
          const estimates = await estimateCMSMedicationCosts(patient.medications);
          return estimates.map((e) => ({
            medication: e.drugName,
            monthlyOOP: e.estimatedMonthlyOOP,
            covered: e.coveredByMedicarePartD,
          }));
        }
      );

      // Step 4: Run LLM analysis
      const analysis = await withProgress(
        emitStep,
        "llm",
        "Analyzing discharge readiness",
        "llm",
        async () => {
          return analyzeDischargeReadiness(
            patient,
            drugInteractions,
            unmetCareGaps.map((g) => ({
              guideline: g.guideline,
              recommendation: g.recommendation,
              grade: g.grade,
              status: g.status,
            })),
            costEstimates
          );
        }
      );

      // Send final result
      emitResult({
        ...analysis,
        modelUsed: analysis.modelUsed || getActiveModelId(),
        modelRequested: getActiveModelId(),
        agentUsed: false,
      });

      // Close stream
      complete();
    } catch (error) {
      console.error("Streaming analysis error:", error);
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

