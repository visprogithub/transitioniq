# TransitionIQ - AI Discharge Readiness Assessment

**Proprietary and Confidential** — Copyright (c) 2026. All Rights Reserved.

This project is not open source. Clinical decision-support tools require rigorous validation, regulatory oversight, and controlled deployment to ensure patient safety — open-sourcing clinical AI without proper governance could lead to unvalidated use in care settings. Unauthorized copying, modification, or distribution is prohibited. Source code is available for hackathon review via the built-in source endpoint.

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

### Proof-of-Concept Shortcuts

This is a hackathon prototype built under time, cost, and infrastructure constraints (free Vercel tier, limited API budgets). Several components are intentional placeholders that would need proper solutions before production:

- **Knowledge base / RAG** — Uses a zero-dependency TF-IDF vector search with basic medical NLP (synonym expansion, stemming). A production system would use proper embedding models (e.g. OpenAI `text-embedding-3-small`) backed by a vector database (Pinecone, Weaviate, pgvector) with chunking, re-ranking, and a much larger clinical corpus.
- **Conversation memory** — All session state, conversation history, and patient assessments live in in-memory `Map`s with TTL-based cleanup. There's no persistence — a Vercel cold start wipes everything. Production would use Redis or a database for session state and conversation history.
- **Rate limiting** — Cookie-based, in-memory per serverless instance. Not distributed, not tamper-proof — anyone can clear cookies and get a fresh quota. Exists purely to cap demo API costs. A real system would use distributed rate limiting (e.g. Upstash Redis) with proper authentication.
- **Patient data** — Hardcoded demo patients with synthetic FHIR-like records. Production would integrate with real FHIR servers (Epic, Cerner). The FDA and CMS data source clients make real API calls (openFDA, RxNorm, data.cms.gov), but CMS uses a static tier lookup for common drugs before hitting the API. Clinical guidelines are coded implementations of real published standards (ACC/AHA, ADA, GOLD, USPSTF) — accurate rules, but not fetched from a live guideline API.
- **Authentication** — There is none. No login, no RBAC, no HIPAA-compliant access controls. The cookie-based session is purely for rate limit tracking.
- **Model selection** — Constrained to models available on free or cheap tiers (GPT-4o Mini, HuggingFace Qwen3, Gemini Flash). Model routing is manual (user picks from a dropdown). Production would likely use a single validated model with proper eval benchmarks, or an intelligent router.
- **Voice** — STT uses the browser's built-in Web Speech API (free, no server cost, but inconsistent across browsers). TTS uses OpenAI `tts-1` which is cheap but adds latency. A production mobile app would likely use a dedicated speech pipeline (Whisper for STT, streaming TTS) with proper audio handling.
- **Hosting** — Vercel free tier has a 60-second function timeout, 100K monthly invocations, and no persistent storage. The multi-model evaluation endpoint (`/api/evaluate/models`) can push against that timeout when testing many models. Production would need proper infrastructure sizing.
- **Opik flush strategy** — Traces are flushed once per request at the route level. If the serverless function is killed mid-request (timeout, crash), in-flight traces may be lost. Acceptable for a demo; production would use async trace shipping or a collector sidecar.

None of this diminishes what the prototype demonstrates — the clinical reasoning pipeline, multi-agent orchestration, observability integration, and evaluation framework are all real. The shortcuts above are just the plumbing that would get specced out properly with time and budget.

## Tech Stack

- **Frontend**: Next.js 16 with App Router, TypeScript, Tailwind CSS, Framer Motion
- **LLM**: Multi-provider support (OpenAI, HuggingFace, Gemini) via abstracted LLM provider
- **Agent Framework**: TypeScript ReAct-style orchestrator with tool chaining
- **Observability**: Opik (Comet) for tracing, prompt versioning, evaluation, error tracking, and cost tracking
- **Knowledge Base**: Zero-dependency TF-IDF vector search with medical NLP (synonym expansion, stemming)
- **Memory**: In-memory session management with conversation history compaction
- **Hosting**: Vercel

## Features

### Clinical View
- **Multi-Model Support** - Switch between OpenAI GPT-4o Mini, HuggingFace (Qwen3 8B, Qwen3 30B), and Gemini (2.5 Flash, 2.5 Flash Lite)
- **Animated Discharge Score** - Visual gauge (0-100) with status indicators and collapsible methodology explanation
- **Risk Factor Cards** - Expandable cards with severity levels (high/moderate/low) and data source attribution (FDA, CMS, Guidelines, FHIR, RAG)
- **AI-Generated Discharge Plans** - Comprehensive checklists tailored to patient risk factors
- **Smart Rate Limit Handling** - Automatic prompts to switch models when rate limited

### Patient View
- **Preparation Tracker** - Patient-friendly framing focused on going-home preparation (not readiness judgment)
- **Recovery Coach** - Multi-turn conversational AI with tool use (medication lookup, symptom checking, term explanation, dietary/activity guidance)
- **Prioritized Checklist** - Separated into "Must Do Before Leaving" and "Helpful For Your Recovery" sections
- **Suggested Questions** - Pre-built question cards for common patient concerns

### Voice Features
- **Text-to-Speech** - Any coach response can be read aloud via OpenAI `tts-1` (nova voice). Audio is streamed from the API for fast playback with buffered start to prevent clipping.
- **Auto-Play Toggle** - Speaker icon in the chat header. When enabled, every new coach response is automatically read aloud.
- **Speech-to-Text (Chrome/Safari/Edge)** - Tap the 🎤 mic button to speak your question using the browser's built-in Web Speech API (free, real-time transcription).
- **Speech-to-Text (Firefox/Other)** - Tap 🎤 to record, tap again to stop. Audio is sent to the server and transcribed via OpenAI Whisper — works in any browser that supports `MediaRecorder`.
- **Rate Limiting** - TTS and STT are independently rate-limited to control API costs during the demo. Countdown banners appear when limits are reached.

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
HF_API_KEY=your_huggingface_key         # HuggingFace Qwen3 (free tier available)
GEMINI_API_KEY=your_gemini_key          # Google Gemini 2.5 Flash

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
2. HuggingFace Qwen3 8B (if `HF_API_KEY` set)
3. Gemini 2.5 Flash Lite (if `GEMINI_API_KEY` set)

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
| **Voice TTS** (`/api/tts`) | 5 requests | 24 hours | Playing coach responses aloud (env: `VOICE_RATE_LIMIT_MAX`, `VOICE_RATE_LIMIT_WINDOW_MIN`) |
| **Voice STT** (`/api/stt`) | 10 requests | 1 hour | Using mic-to-text on Firefox/other (env: `STT_RATE_LIMIT_MAX`, `STT_RATE_LIMIT_WINDOW_MIN`) |

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
| `/api/tts` | POST | Text-to-speech via OpenAI `tts-1` (streams MP3 audio) |
| `/api/stt` | POST | Speech-to-text via OpenAI Whisper (accepts audio blob) |
| `/api/evaluate/models` | GET | List all models with availability |
| `/api/experiments` | POST | Run Opik experiments for model evaluation |

## Demo Patients

| ID | Name | Age/Sex | Scenario | Expected Score |
|----|------|---------|----------|----------------|
| `demo-polypharmacy` | John Smith | 68M | 12 medications, warfarin + aspirin, atrial fibrillation | ~40-60 (Not Ready) |
| `demo-heart-failure` | Mary Johnson | 72F | Heart failure, COPD exacerbation, hypertension | ~50-70 (Caution) |
| `demo-ready` | Robert Chen | 45M | Post-appendectomy, simple surgery recovery | ~85-100 (Ready) |
| `demo-pediatric` | Emily Wilson | 8F | Post-tonsillectomy (pediatric) | ~85-100 (Ready) |
| `demo-geriatric-fall` | Dorothy Martinez | 88F | Hip fracture, dementia, cognitive decline | ~20-40 (Not Ready) |
| `demo-pregnancy-gdm` | Sarah Thompson | 32F | Gestational diabetes, hypertension | ~50-70 (Caution) |
| `demo-renal-dialysis` | William Jackson | 65M | CKD Stage 4 on dialysis, diabetes, anemia | ~30-50 (Not Ready) |
| `demo-psychiatric-bipolar` | Jennifer Adams | 45F | Bipolar disorder on lithium, anxiety | ~40-60 (Caution) |
| `demo-oncology-neutropenic` | Michael Brown | 58M | Post-chemo colon cancer, severe neutropenia | ~30-50 (Not Ready) |
| `demo-simple-surgery` | Lisa Garcia | 35F | Post-laparoscopic cholecystectomy | ~85-100 (Ready) |
| `demo-extreme-polypharmacy` | Harold Wilson | 75M | 18 medications, critical lab values | ~10-30 (Not Ready) |
| `demo-social-risk` | David Thompson | 52M | Homeless, COPD exacerbation, alcohol use disorder | ~20-50 (Not Ready) |

## Available Models

| Model ID | Provider | Notes |
|----------|----------|-------|
| `openai-gpt-4o-mini` | OpenAI | Fast, reliable, low cost |
| `hf-qwen3-8b` | HuggingFace | Free tier, Qwen3 8B |
| `hf-qwen3-30b-a3b` | HuggingFace | Free tier, Qwen3 30B (3B active) |
| `gemini-2.5-flash` | Google | Latest Gemini Flash |
| `gemini-2.5-flash-lite` | Google | Lightweight Gemini variant |

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
| `src/components/PatientChat.tsx` | Multi-turn recovery coach chat with voice I/O |
| `src/app/api/tts/route.ts` | Text-to-speech endpoint (OpenAI `tts-1`, streamed MP3) |
| `src/app/api/stt/route.ts` | Speech-to-text endpoint (OpenAI Whisper, Firefox fallback) |
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

## Source Code Viewer

Navigate to [`/source`](/source) to access the built-in source code viewer for hackathon review.

### Browsing Files
- The **sidebar** shows a folder tree — click folders to expand/collapse, click files to view
- **Syntax highlighting** for TypeScript, TSX, JavaScript, JSON, CSS, and Markdown
- **Markdown files** (like this README) render with full formatting

### Git History
- Click **Git History** at the top of the sidebar to view the full commit timeline
- Each commit shows the message, hash, author, date, and file change stats (+/- lines)
- Click any commit to **expand and view the full diff** with color-coded additions (green) and deletions (red)

### Access Controls
- **Kill switch**: Set `CODE_VIEWER_ENABLED=false` in Vercel to instantly disable access
- **Auto-expiry**: Access automatically expires February 19, 2026
- **No indexing**: `/source` is blocked from search engines via `robots.txt` and `noindex` meta tags

## Hackathon

Built for the Encode Club "Commit To Change" (Comet Resolution V2) Hackathon, targeting:
- **Health, Fitness & Wellness Prize** ($5K)
- **Best Use of Opik Prize** ($5K)

---

**Notice**: This software is proprietary and copyrighted. Clinical AI tools require validated, controlled deployment to protect patient safety. No license is granted for use, modification, or distribution. Source code is shared with hackathon judges for evaluation purposes only.
