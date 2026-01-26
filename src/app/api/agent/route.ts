/**
 * Agent API - Multi-turn conversation endpoint
 *
 * POST /api/agent
 * - patientId: string (optional) - Patient to assess
 * - message: string (optional) - User message for conversation
 * - sessionId: string (optional) - Continue existing session
 *
 * Returns agent response with analysis, graph, and suggested actions
 */

import { NextRequest, NextResponse } from "next/server";
import { runAgent, continueConversation, getSession } from "@/lib/agents/orchestrator";
import { logAgentGraph, logConversationMetrics, evaluateTaskCompletion } from "@/lib/agents/tracing";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, message, sessionId } = body as {
      patientId?: string;
      message?: string;
      sessionId?: string;
    };

    // Validate input
    if (!patientId && !message && !sessionId) {
      return NextResponse.json(
        { error: "Provide patientId, message, or sessionId" },
        { status: 400 }
      );
    }

    let response;

    // If continuing a conversation
    if (sessionId && message && !patientId) {
      response = await continueConversation(sessionId, message);
    } else {
      // Start new or continue with patient assessment
      response = await runAgent({ patientId, message, sessionId });
    }

    // Log agent graph to Opik
    if (response.agentGraph.nodes.length > 0) {
      await logAgentGraph(response.sessionId, response.agentGraph);
    }

    // Log conversation metrics
    const session = getSession(response.sessionId);
    if (session) {
      await logConversationMetrics(
        response.sessionId,
        session.context.conversationHistory.filter((m) => m.role === "user").length,
        response.toolsUsed.length,
        !response.requiresInput && !!response.analysis
      );

      // Evaluate task completion if we have an analysis
      if (response.analysis) {
        await evaluateTaskCompletion(
          response.sessionId,
          session.patientId || "unknown",
          {
            hasScore: true,
            hasStatus: true,
            hasRiskFactors: true,
            hasRecommendations: true,
          },
          {
            hasScore: typeof response.analysis.score === "number",
            hasStatus: !!response.analysis.status,
            hasRiskFactors: Array.isArray(response.analysis.riskFactors),
            hasRecommendations: Array.isArray(response.analysis.recommendations),
          }
        );
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Agent error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent execution failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const sessionId = searchParams.get("sessionId");

  if (sessionId) {
    const session = getSession(sessionId);
    if (session) {
      return NextResponse.json({
        sessionId: session.sessionId,
        status: session.status,
        patientId: session.patientId,
        currentGoal: session.currentGoal,
        stepCount: session.steps.length,
        conversationLength: session.context.conversationHistory.length,
        hasAnalysis: !!session.context.analysis,
      });
    }
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({
    message: "Agent API",
    endpoints: {
      POST: {
        description: "Run agent or continue conversation",
        body: {
          patientId: "string (optional) - Patient to assess",
          message: "string (optional) - User message",
          sessionId: "string (optional) - Continue existing session",
        },
      },
      GET: {
        description: "Get session status",
        params: {
          sessionId: "string - Session ID to retrieve",
        },
      },
    },
    features: [
      "Multi-turn conversation support",
      "Agent execution graph tracking",
      "Tool correctness evaluation",
      "Task completion metrics",
    ],
  });
}
