# TransitionIQ - AI Discharge Readiness Assessment

**PROPRIETARY AND CONFIDENTIAL**

Copyright (c) 2026. All Rights Reserved.

This software and its source code are proprietary and confidential. Unauthorized copying, modification, distribution, or use of this software, in whole or in part, is strictly prohibited. This project is NOT open source and is NOT licensed for public use.

---

## Overview

TransitionIQ is an AI-powered discharge readiness assessment tool that helps healthcare providers evaluate whether patients are safe to leave the hospital. It uses a multi-agent orchestrator that fuses data from multiple clinical sources, reasons over them with LLMs, and presents both a clinician-facing assessment and a patient-friendly preparation guide.

### Data Sources

- **FHIR Patient Data** - Medications, conditions, allergies, and lab results
- **FDA Safety Signals** - Drug interaction checks via RxNorm/openFDA
- **Clinical Guidelines** - ACC/AHA, ADA, GOLD guideline compliance evaluation
- **CMS Cost Estimates** - Medicare Part D out-of-pocket cost barriers
- **Clinical Knowledge Base** - RAG-powered search across drug monographs, interactions, symptom triage protocols, and medical terminology

### Demo vs. Production

For this hackathon submission, all three views (Clinical, Patient, Evaluation) exist within the same web app for demonstration purposes. In a production deployment:

- **Clinical View** would be integrated into the hospital's **EHR system** (e.g., Epic, Cerner) as a clinical decision support module, accessible during the discharge workflow.
- **Patient View** would be a separate **mobile app** or integrated into a patient portal like **MyChart**, where patients receive their personalized going-home preparation guide and can chat with the Recovery Coach.
- **Evaluation tab** would be an **internal dashboard** for the TransitionIQ team to monitor model performance, run A/B experiments, track accuracy metrics, and manage prompt versions — not visible to clinicians or patients.

## Tech Stack

- **Frontend**: Next.js 16 with App Router, TypeScript, Tailwind CSS, Framer Motion
- **LLM**: Multi-provider support (OpenAI, HuggingFace, Gemini, Anthropic) via abstracted LLM provider
- **Agent Framework**: TypeScript ReAct-style orchestrator with tool chaining
- **Observability**: Opik (Comet) for tracing, prompt versioning, evaluation, error tracking, and cost tracking
- **Knowledge Base**: Zero-dependency TF-IDF vector search with medical NLP (synonym expansion, stemming)
- **Memory**: In-memory session management with conversation history compaction
- **Hosting**: Vercel

## Features

### Clinical View
- **Multi-Model Support** - Switch between OpenAI GPT-4o Mini, HuggingFace (Qwen, Llama), Gemini, and Anthropic Claude
- **Animated Discharge Score** - Visual gauge (0-100) with status indicators and collapsible methodology explanation
- **Risk Factor Cards** - Expandable cards with severity levels (high/moderate/low) and data source attribution (FDA, CMS, Guidelines, FHIR, RAG)
- **AI-Generated Discharge Plans** - Comprehensive checklists tailored to patient risk factors
- **Smart Rate Limit Handling** - Automatic prompts to switch models when rate limited

### Patient View
- **Preparation Tracker** - Patient-friendly framing focused on going-home preparation (not readiness judgment)
- **Recovery Coach** - Multi-turn conversational AI with tool use (medication lookup, symptom checking, term explanation, dietary/activity guidance)
- **Prioritized Checklist** - Separated into "Must Do Before Leaving" and "Helpful For Your Recovery" sections
- **Suggested Questions** - Pre-built question cards for common patient concerns

### Observability & Evaluation
- **Real-time Opik Tracing** - Token usage, cost estimates, and latency tracking for all LLM calls
- **Error Tracing** - All API route errors logged to Opik with source identification and stack traces
- **Thread Grouping** - Multi-turn conversations grouped by threadId for debugging
- **Prompt Library** - 8 prompts versioned and managed via Opik Prompt Library with local fallbacks
- **Model Comparison** - A/B testing and evaluation dashboard for comparing model outputs
- **Agent Trajectory Logging** - Step-by-step decision tracking for the agent orchestrator

## Agent Architecture

The agent orchestrator runs a 7-step ReAct-style pipeline. Each step uses deterministic data clients for grounding, then sends the data to the LLM via Opik-versioned prompts for reasoning:

```
User Request -> API Route -> Agent Orchestrator
                                    |
    Step 1: fetch_patient           (FHIR patient data)
    Step 2: check_drug_interactions (FDA/RxNorm + LLM reasoning)
    Step 3: evaluate_care_gaps      (Clinical guidelines + LLM reasoning)
    Step 4: estimate_costs          (CMS Part D pricing + LLM reasoning)
    Step 5: retrieve_knowledge      (TF-IDF RAG search + LLM synthesis)
    Step 6: analyze_readiness       (All context -> LLM discharge assessment)
    Step 7: generate_plan           (Risk factors -> LLM discharge checklist)
                                    |
                            Opik Tracing (every step)
                                    |
                        Dashboard Visualization
```

### Design Philosophy

- **Data -> LLM Reasoning**: Deterministic clients provide grounding data. LLMs reason over the data. Fallback to raw data if LLM fails.
- **No Hardcoded Outputs**: All analysis, scoring, and recommendations are AI-generated (except demo patient data).
- **Prompt Versioning**: All prompts stored in Opik Prompt Library with local fallbacks for offline/testing.
- **Error Resilience**: Agent failures trigger fallback to direct LLM. All errors traced to Opik.

## Environment Variables

Create a `.env.local` file with at least one LLM provider:

```env
# LLM Providers (at least one required)
OPENAI_API_KEY=your_openai_key          # OpenAI GPT-4o Mini
HF_API_KEY=your_huggingface_key         # HuggingFace (free tier available)
GEMINI_API_KEY=your_gemini_key          # Google Gemini
ANTHROPIC_API_KEY=your_anthropic_key    # Anthropic Claude

# Observability (required for tracing)
OPIK_API_KEY=your_opik_api_key
OPIK_PROJECT_NAME=transitioniq

# Optional: Override default model selection
LLM_MODEL=openai-gpt-4o-mini

# Optional: Admin bypass for rate limiting (see Rate Limiting section)
ADMIN_SECRET=your_admin_secret
```

### Model Priority

When multiple API keys are configured, the default model is selected in this order:
1. OpenAI GPT-4o Mini (if `OPENAI_API_KEY` set)
2. HuggingFace Qwen 7B (if `HF_API_KEY` set)
3. Anthropic Claude 3 Haiku (if `ANTHROPIC_API_KEY` set)
4. Gemini 2.0 Flash Lite (if `GEMINI_API_KEY` set)

You can override this by setting `LLM_MODEL` or using the model selector in the UI.

## Rate Limiting (Demo Protection)

When sharing the demo link publicly, cookie-based rate limiting protects expensive API endpoints from abuse. A `tiq_session` cookie is set automatically via Next.js proxy on the first request.

### Limits

| Endpoint Category | Limit | Window | What Triggers It |
|-------------------|-------|--------|------------------|
| **Evaluation** (`/api/evaluate/models`, `/api/experiments/opik`) | 3 requests | 15 min | Running model comparison or Opik experiments |
| **Judge** (`/api/evaluate/judge`) | 5 requests | 10 min | Running LLM-as-Judge quality evaluations |
| **Analyze** (`/api/analyze`, `/api/agent`) | 10 requests | 5 min | Running discharge readiness analysis |
| **Generate Plan** (`/api/generate-plan`) | 10 requests | 5 min | Generating discharge checklists |
| **Patient Chat** (`/api/patient-chat`) | 1s cooldown | per message | Sending Recovery Coach messages |

When rate-limited, the UI shows a disabled state with a countdown timer and a banner message.

### Admin Bypass

To bypass rate limits (e.g., during a live demo), set the `ADMIN_SECRET` environment variable and run this in your browser console:

```js
document.cookie = "tiq_admin=YOUR_SECRET; path=/; max-age=86400";
```

Replace `YOUR_SECRET` with the value of `ADMIN_SECRET` from your `.env.local`. The bypass lasts 24 hours.

```env
# Add to .env.local for admin bypass
ADMIN_SECRET=your_secret_here
```

### Vercel Behavior

Rate limits use in-memory storage which resets on serverless cold starts. This is acceptable for demo protection. The session cookie (7-day TTL) survives cold starts so returning visitors are tracked when the function re-warms.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

```bash
npm run build        # Production build
npm run lint         # ESLint check
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/patient/[id]` | GET | Fetch patient data by ID |
| `/api/analyze` | POST | Run discharge readiness analysis (agent or direct LLM) |
| `/api/generate-plan` | POST | Generate discharge checklist |
| `/api/patient-chat` | POST | Multi-turn patient recovery coach conversation |
| `/api/agent` | POST | Run agent or continue conversation session |
| `/api/agent` | GET | Get session status by sessionId |
| `/api/model/switch` | POST | Switch active LLM model |
| `/api/model/switch` | GET | Get current model and available models |
| `/api/evaluate/models` | GET | List all models with availability |
| `/api/experiments` | POST | Run Opik experiments for model evaluation |

## Demo Patients

| ID | Name | Scenario | Expected Score |
|----|------|----------|----------------|
| `demo-polypharmacy` | John Smith | 12 medications, warfarin + aspirin, no PCP follow-up | ~40-60 (Not Ready) |
| `demo-heart-failure` | Mary Johnson | CHF + COPD, elevated BNP, multiple care gaps | ~30-50 (Not Ready) |
| `demo-ready` | Robert Chen | Post-appendectomy, stable vitals, routine discharge | ~80-95 (Ready) |

## Available Models

| Model ID | Provider | Notes |
|----------|----------|-------|
| `openai-gpt-4o-mini` | OpenAI | Fast, reliable, low cost |
| `hf-qwen-7b` | HuggingFace | Free tier, Qwen 2.5 7B Instruct |
| `hf-llama-3.2-3b` | HuggingFace | Free tier, Llama 3.2 3B Instruct |
| `gemini-2.0-flash` | Google | 5 RPM free tier limit |
| `gemini-2.0-flash-lite` | Google | 15 RPM free tier limit |
| `claude-3-haiku` | Anthropic | Fast, cost-effective |
| `claude-3-sonnet` | Anthropic | Higher quality, higher cost |

## Architecture

```
+-----------------------------------------------------------------+
|                       Next.js Frontend                          |
|  +-------------+  +--------------+  +------------------------+ |
|  | Clinical    |  | Patient View |  |  Evaluation Dashboard  | |
|  | Dashboard   |  | + Recovery   |  |  (Model Comparison)    | |
|  | + Score     |  |   Coach Chat |  |                        | |
|  +-------------+  +--------------+  +------------------------+ |
+-----------------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------------+
|                    API Routes (Next.js)                          |
|  /api/analyze | /api/patient-chat | /api/generate-plan          |
|  /api/agent   | /api/experiments  | /api/model/switch            |
+-----------------------------------------------------------------+
                              |
               +--------------+--------------+
               v              v              v
+---------------+    +---------------+    +---------------+
|  Agent        |    |  Data Sources |    |     Opik      |
|  Orchestrator |    |               |    |  Observability|
|               |    |  * FDA/RxNorm |    |               |
|  7-step ReAct |    |  * Guidelines |    |  * Traces     |
|  pipeline     |    |  * CMS Costs  |    |  * Prompts    |
|  + memory     |    |  * FHIR Data  |    |  * Token/Cost |
|  + tools      |    |  * RAG Search |    |  * Errors     |
+---------------+    +---------------+    +---------------+
        |
        v
+---------------+
| LLM Provider  |
|  Abstraction  |
|               |
|  * OpenAI     |
|  * HuggingFace|
|  * Gemini     |
|  * Anthropic  |
+---------------+
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/agents/orchestrator.ts` | ReAct-style agent orchestrator with 7-step pipeline |
| `src/lib/agents/tools.ts` | Tool implementations (drug interactions, care gaps, costs, RAG, analysis) |
| `src/lib/agents/tracing.ts` | Agent-level Opik tracing with thread grouping |
| `src/lib/agents/memory.ts` | Session memory management for multi-turn conversations |
| `src/lib/integrations/llm-provider.ts` | Multi-provider LLM abstraction with Opik tracing |
| `src/lib/integrations/opik.ts` | Core Opik client, trace/span management, error tracing |
| `src/lib/integrations/opik-prompts.ts` | Prompt Library (8 prompts versioned in Opik) |
| `src/lib/integrations/analysis.ts` | Discharge analysis using LLM provider |
| `src/lib/integrations/fda-client.ts` | FDA/RxNorm drug interaction client |
| `src/lib/integrations/cms-client.ts` | CMS Medicare Part D cost estimation |
| `src/lib/integrations/guidelines-client.ts` | Clinical guideline compliance checks |
| `src/lib/knowledge-base/vector-search.ts` | Zero-dependency TF-IDF search engine with medical NLP |
| `src/lib/knowledge-base/knowledge-index.ts` | Knowledge base indexer (~400 clinical documents) |
| `src/components/DischargeScore.tsx` | Animated circular score gauge with methodology explanation |
| `src/components/PatientRecoveryCoach.tsx` | Patient-facing preparation guide and checklist |
| `src/components/PatientChat.tsx` | Multi-turn recovery coach chat with tool use |
| `src/components/ModelSelector.tsx` | UI for switching between LLM models |
| `src/components/RiskFactorCard.tsx` | Expandable risk factor cards with data source badges |

## Opik Integration

### Prompt Library (8 prompts)
All prompts are stored and versioned in Opik's Prompt Library with local fallback templates:
- `discharge-analysis` - Main discharge readiness assessment
- `drug-interaction-evaluation` - FDA data reasoning
- `care-gap-evaluation` - Clinical guideline compliance reasoning
- `cost-estimation` - CMS cost barrier analysis
- `knowledge-retrieval` - RAG synthesis prompt
- `discharge-plan-generation` - Checklist generation
- `patient-summary-generation` - Patient-friendly summary
- `patient-chat-system` - Recovery coach system prompt

### Tracing
- **LLM Spans**: Every LLM call tracked with model, provider, token usage, and cost
- **Data Source Spans**: FDA, Guidelines, CMS, and RAG calls traced separately
- **Agent Trajectories**: Step-by-step decision logging for the orchestrator pipeline
- **Error Traces**: All API route errors logged as `error-{source}` traces with stack traces
- **Thread Grouping**: Multi-turn conversations grouped by `threadId` metadata

### Evaluation
- **Model Comparison**: A/B testing via Opik experiments
- **Tool Correctness**: Per-tool accuracy evaluation
- **Task Completion**: Automated checks for score, status, risk factors, and recommendations
- **Conversation Metrics**: Turn count, tool usage, and task completion tracking

## Hackathon

Built for the Encode Club "Commit To Change" (Comet Resolution V2) Hackathon, targeting:
- **Health, Fitness & Wellness Prize** ($5K)
- **Best Use of Opik Prize** ($5K)

---

**NOTICE**: This software is proprietary. No license is granted for use, modification, or distribution.
