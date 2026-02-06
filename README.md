# TransitionIQ - AI Discharge Readiness Assessment

**Proprietary and Confidential** — Copyright (c) 2026. All Rights Reserved.

This project is not open source. Clinical decision-support tools require rigorous validation, regulatory oversight, and controlled deployment to ensure patient safety — open-sourcing clinical AI without proper governance could lead to unvalidated use in care settings. Unauthorized copying, modification, or distribution is prohibited. Source code is available for hackathon review via the built-in source endpoint.

---

## Overview

TransitionIQ is an AI-powered discharge readiness assessment tool that helps healthcare providers evaluate whether patients are safe to leave the hospital. It uses a **deterministic clinical pipeline** that gathers structured data from multiple clinical sources (FDA, CMS, clinical guidelines), then feeds that complete context into an LLM for synthesis and scoring. The system also provides a patient-facing Recovery Coach — a tool-augmented conversational AI that helps patients understand their medications, symptoms, and discharge instructions.

### Data Sources

- **FHIR Patient Data** - Medications, conditions, allergies, and lab results
- **FDA Safety Signals** - Drug interaction checks via RxNorm/openFDA, boxed warnings, FAERS adverse events
- **Clinical Guidelines** - ACC/AHA, ADA, GOLD guideline compliance evaluation
- **CMS Cost Estimates** - Medicare Part D out-of-pocket cost barriers
- **MyHealthfinder (ODPHP)** - USPSTF-based preventive care recommendations and care gap identification
- **Food-Drug Interactions** - Comprehensive database of dietary interactions (grapefruit, leafy greens, tyramine, calcium, etc.)
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
- **Agent architecture** — The system intentionally avoids agentic loops where the LLM controls tool selection. In a clinical decision-support tool, every data source must be consulted on every assessment — there's no valid reason for the AI to "decide" to skip checking drug interactions. The current deterministic pipeline is the correct architecture for this domain. What would change in production:
  - The hardcoded tool plan could become configurable per clinical workflow (e.g., surgical discharge vs. medical discharge vs. behavioral health)
  - Tool data sources would be replaced with production APIs (DrugBank, Surescripts, real FHIR servers) or exposed as MCP (Model Context Protocol) servers
  - The LLM synthesis step would use a single validated, benchmarked model with structured output guarantees
  - The Patient Coach's keyword-based tool detection would be augmented with a proper intent classifier, native function calling from a production-grade model, or MCP (Model Context Protocol) servers exposing clinical tools as standardized endpoints
- **Voice** — STT uses the browser's built-in Web Speech API (free, no server cost, but inconsistent across browsers). TTS uses OpenAI `tts-1` which is cheap but adds latency. A production mobile app would likely use a dedicated speech pipeline (Whisper for STT, streaming TTS) with proper audio handling.
- **Hosting** — Vercel free tier has a 60-second function timeout, 100K monthly invocations, and no persistent storage. The multi-model evaluation endpoint (`/api/evaluate/models`) can push against that timeout when testing many models. Production would need proper infrastructure sizing.
- **Opik flush strategy** — Traces are flushed asynchronously with a 5-second timeout and auto-disable after 3 consecutive failures. This ensures the app never crashes due to Opik service outages — tracing is "execute first, trace later" (the critical LLM/tool call runs before any Opik operations). Production would use async trace shipping or a collector sidecar with proper retry queues.

None of this diminishes what the prototype demonstrates — the clinical data pipeline, deterministic orchestration, LLM-powered synthesis, observability integration, and evaluation framework are all real. The AI architecture (deterministic pipeline + LLM synthesis, not agentic loops) is the same architecture that would ship in production. The shortcuts above are the data sources and infrastructure plumbing that would get replaced with production-grade equivalents.

### External API Rate Limits

The following external APIs are used with their respective rate limits:

| API | Rate Limit (No Key) | Rate Limit (Free Key) | Caching | Production Alternative |
|-----|---------------------|----------------------|---------|----------------------|
| **OpenFDA** (drug interactions, FAERS, labels, recalls) | 240 req/min, 1,000/day | 240 req/min, 120,000/day | 12-24h | DrugBank API, FDB (First Databank), Lexicomp |
| **RxNorm** (drug normalization, NDC mapping) | No key required | N/A | 7 days | NLM UMLS subscription, commercial drug databases |
| **MyHealthfinder** (preventive care recommendations) | No key required | N/A | 24h | Custom USPSTF implementation, Epic/Cerner care gaps |
| **DailyMed** (drug labels, package inserts) | No key required | N/A | 24h | FDB, Lexicomp, Micromedex |
| **MedlinePlus** (health topics, patient education) | No key required | N/A | Session | Licensed patient education content (Healthwise, Krames) |
| **CMS** (Medicare Part D pricing) | No key required | N/A | Static tier lookup | GoodRx API, Surescripts, real-time pharmacy benefit check |

> **Note**: OpenFDA keys are free to obtain at [open.fda.gov/apis/authentication](https://open.fda.gov/apis/authentication). Without a key, you're limited to 1,000 requests/day which is sufficient for development and demos. For production, a free key increases this to 120,000 requests/day.

### Production Data Source Alternatives

For a production clinical deployment, these free APIs would be replaced with validated commercial data sources:

| Current Implementation | Production Alternative | Why |
|----------------------|----------------------|-----|
| **OpenFDA drug interactions** | DrugBank, FDB, or Lexicomp | FDA data is raw adverse events, not curated clinical decision support. Commercial databases provide severity ratings, clinical recommendations, and evidence grading. |
| **Rule-based guidelines** | UpToDate, DynaMed, or AHRQ | Hand-coded guideline rules may become outdated. Subscription services provide continuously updated, peer-reviewed recommendations. |
| **Keyword-based knowledge base** | Knowledge graph (Neo4j) + vector DB with medical embeddings | Current TF-IDF/keyword search works for exact matches but misses both semantic similarity and *relational reasoning*. A **knowledge graph** (Neo4j, Amazon Neptune) would model drugs, conditions, symptoms, and guidelines as interconnected nodes — enabling queries like "what are all the downstream risks for a patient on warfarin with a new AFib diagnosis and a recent fall?" that flat document retrieval fundamentally cannot answer. Drug-drug interactions, contraindications, guideline applicability, and care pathway dependencies are inherently graph problems. Vector databases (Pinecone, Weaviate, pgvector) with medical-trained embeddings (PubMedBERT, MedCPT, BioGPT-Large) would handle semantic similarity for unstructured clinical text. The ideal production architecture is **hybrid: knowledge graph for structured relational queries + vector search for unstructured retrieval**, with the deterministic pipeline querying both. |
| **CMS static tier lookup** | Real-time pharmacy benefit check | Static pricing estimates miss actual insurance coverage. Production would integrate with PBMs via Surescripts or NCPDP for real-time copay information. |
| **In-memory food-drug database** | FDB or Lexicomp food interactions | Our ~50 food-drug pairs cover common cases but commercial databases have thousands of validated interactions with clinical significance ratings. |
| **Local symptom triage KB** | ApiMedic, Infermedica, or Isabel | Our Schmitt-Thompson style triage covers ~10 critical symptoms. Commercial symptom checkers provide AI-powered differential diagnosis, structured intake, and evidence-based triage across thousands of conditions. Free tiers: ApiMedic (100 tx/mo), EndlessMedical (developer access). |
| **Demo patient data** | FHIR R4 from Epic/Cerner | Synthetic patients for demos; production would use SMART on FHIR with real EHR integration. |

### Observability Resilience

Opik integration is designed to **never crash the application**, even if the Opik service is unavailable:

- **Execute First, Trace Later**: All LLM calls and tool executions complete before any Opik tracing operations
- **Non-Blocking Flush**: Trace data is flushed asynchronously with a 5-second timeout
- **Auto-Disable**: After 3 consecutive flush failures, Opik tracing is automatically disabled for the session to prevent log spam
- **Graceful Degradation**: If `OPIK_API_KEY` is not set or Opik is unreachable, the app functions normally without observability

This ensures production reliability — tracing is valuable but never critical path.

## Tech Stack

- **Frontend**: Next.js 16 with App Router, TypeScript, Tailwind CSS, Framer Motion
- **LLM**: Multi-provider support (OpenAI, HuggingFace, Gemini) via abstracted LLM provider
- **Orchestration**: Deterministic clinical pipeline with dependency-aware parallel execution and LLM synthesis — no agentic loops
- **Streaming**: SSE (Server-Sent Events) for real-time pipeline progress visualization
- **Observability**: Opik (Comet) for tracing, prompt versioning, evaluation, error tracking, and cost tracking
- **Guardrails**: PII/PHI detection on all LLM-calling endpoints (input sanitization + output sanitization), off-topic filtering (patient chat), post-LLM score calibration
- **Knowledge Base**: Zero-dependency TF-IDF vector search with medical NLP (synonym expansion, stemming) — production would use a knowledge graph (Neo4j) for relational clinical queries + vector embeddings for semantic search
- **External APIs**: FDA RxNorm, OpenFDA (FAERS, Labels, Enforcement), CMS, DailyMed, MedlinePlus - with caching
- **Memory**: In-memory session management with conversation history compaction
- **Hosting**: Vercel

## Quick Start

**Prerequisites**: Node.js 18+ and npm

```bash
# 1. Clone the repository
git clone https://github.com/visprogithub/transitioniq.git
cd transitioniq

# 2. Copy the example environment file
cp .env.example .env.local

# 3. Fill in your API keys (see Environment Variables below)
#    At minimum you need ONE LLM provider key + Opik key

# 4. Install dependencies
npm install

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — select a patient from the dropdown and click "Analyze Readiness" to see the full pipeline in action.

> **Voice and LLM As Judge features** (TTS/STT) and Judge require `OPENAI_API_KEY` in your `.env.local`. Without it, the app runs fine but the mic button, auto-play toggle, and judge evaluation won't work.

## Features

### Clinical View
- **Multi-Model Support** - Switch between OpenAI GPT-4o Mini, HuggingFace (Qwen3 8B, Qwen3 30B), and Gemini (2.5 Flash, 2.5 Flash Lite)
- **Deterministic Clinical Pipeline** - All FDA, CMS, guideline, and knowledge sources consulted on every run with dependency-aware parallel execution. LLM synthesizes the complete clinical picture into a scored assessment.
- **Real FDA Data** - Drug interactions from RxNorm, boxed warnings from OpenFDA labels, FAERS adverse event counts, recall data
- **Animated Discharge Score** - Visual gauge (0-100) with status indicators and collapsible methodology explanation
- **Risk Factor Cards** - Expandable cards with severity levels (high/moderate/low) and data source attribution (FDA, CMS, Guidelines, FHIR, RAG)
- **AI-Generated Discharge Plans** - Comprehensive checklists tailored to patient risk factors
- - Clinician ability to add or remove items from the checklist based on their clinical judgement.
- **Smart Rate Limit Handling** - Automatic prompts to switch models when rate limited

### Patient View
- **Preparation Tracker** - Patient-friendly framing focused on going-home preparation (not readiness judgment)
- **Recovery Coach** - Tool-augmented conversational AI with proactive tool detection, multi-turn memory, and adaptive communication style based on patient age (medication lookup, symptom checking, term explanation, dietary/activity guidance)
- **SSE Streaming** - Real-time progress streaming as tools execute and the LLM synthesizes responses
- **Prioritized Checklist** - Separated into "Must Do Before Leaving" and "Helpful For Your Recovery" sections
- **Suggested Questions** - Pre-built question cards for common patient concerns
- **Data Source Fallbacks** - Local KB → External API → LLM fallback chain for reliability

### Voice Features
- **Text-to-Speech** - Any coach response can be read aloud via OpenAI `tts-1` (nova voice). Audio is streamed from the API for fast playback with buffered start to prevent clipping.
- **Auto-Play Toggle** - Speaker icon in the chat header. When enabled, every new coach response is automatically read aloud.
- **Speech-to-Text (Chrome/Safari/Edge)** - Tap the 🎤 mic button to speak your question using the browser's built-in Web Speech API (free, real-time transcription).
- **Speech-to-Text (Firefox/Other)** - Tap 🎤 to record, tap again to stop. Audio is sent to the server and transcribed via OpenAI Whisper — works in any browser that supports `MediaRecorder`.
- **Rate Limiting** - TTS and STT are independently rate-limited to control API costs during the demo. Countdown banners appear when limits are reached.

### Observability & Evaluation
- **Real-time Opik Tracing** - Token usage aggregation, cost estimates, and latency tracking across pipeline steps and LLM calls
- **LLM-as-Judge with FDA Cross-Verification** - Automatic quality evaluation after every discharge assessment, scoring on Safety (40%), Accuracy (25%), Actionability (20%), and Completeness (15%). The judge independently calls FDA APIs (drug interactions, Black Box Warnings) to cross-check whether the assessment caught all real risks — not just reviewing what the assessment claims. Requires `OPENAI_API_KEY`.
- **Model Comparison** - Run all demo patients through multiple LLM providers, measuring latency, score accuracy, status match, and risk factor coverage to determine which model performs best
- **Opik Experiments** - Predefined test cases tracked via Opik SDK for experiment tracking and regression detection
- **Error Tracing** - All API route errors logged to Opik with source identification and stack traces
- **Thread Grouping** - Multi-turn conversations grouped by threadId for debugging
- **Prompt Library** - 8 prompts versioned and managed via Opik Prompt Library with 30-minute cache and local fallbacks
- **Pipeline Trace Logging** - Full tool execution trace (inputs, outputs, durations, success/failure) captured for every assessment run

## AI Architecture: Safety-Constrained Clinical AI

TransitionIQ is a hybrid system: a **deterministic clinical orchestration pipeline** with **LLM-powered synthesis and reasoning**, plus a **partially-agentic patient-facing conversational AI**. This is a deliberate design choice for healthcare — not a compromise.

### Why Constrained Orchestration Over Autonomous Agents?

In most AI agent demos, the LLM decides what tools to call and in what order. That works for coding assistants and research bots where skipping a step means a slightly worse answer. In clinical decision support, skipping a step means missing a drug interaction or a Black Box Warning on a patient's medication. The failure modes are different:

1. **Non-determinism is a clinical liability** — The same patient data could produce different tool-calling sequences on different runs. A ReAct agent might check drug interactions on one run and skip them on another because the LLM "reasoned" it wasn't needed. In a clinical tool, every safety-relevant data source must be consulted every time.

2. **Brittle loops break silently** — Agentic loops depend on the LLM correctly formatting JSON tool calls, deciding when to stop, and not hallucinating tool names. When parsing fails (and it does — see the regex fallback chain in the Patient Coach), the loop breaks. In a clinical tool, a broken loop means a patient doesn't get assessed.

3. **Auditable execution matters** — When an LLM decides its own tool-calling sequence, explaining *why* a particular risk factor was or wasn't caught becomes "the model chose not to look." A fixed pipeline is fully auditable — and this is where **Opik observability becomes critical**: every tool call, every LLM response, every evaluation score is traced and verifiable.

### Where the AI Adds Value

The system uses AI in three distinct roles:

**1. LLM as Synthesizer** (Discharge Assessment) — The deterministic pipeline gathers all clinical data (FDA interactions, warnings, recalls, guideline compliance, costs, knowledge base), then the LLM synthesizes the complete picture into a scored assessment with risk factors and recommendations. The LLM reasons over complex multi-source data — it just doesn't decide *which* data to look at. Post-LLM calibration rules then constrain the score based on objective criteria (e.g., 2+ high-severity risk factors → score capped at 35).

**2. LLM as Conversational Agent** (Patient Coach) — The Recovery Coach has genuine agentic properties: multi-turn memory, adaptive communication based on patient age, and an LLM fallback path where the model decides which tool to call when deterministic keyword matching doesn't apply. The primary tool-routing path is keyword-based (reliable, fast), with the LLM as a fallback decision-maker for edge cases.

**3. LLM as Evaluator** (LLM-as-Judge with FDA Cross-Verification) — A separate evaluation system that independently fetches FDA safety data (drug interactions, Black Box Warnings) and compares it against what the discharge assessment found. The judge scores on Safety (40%), Accuracy (25%), Actionability (20%), and Completeness (15%). If the pipeline reported 3 drug interactions but FDA actually has 5, the judge catches the gap and penalizes the Safety and Accuracy scores. This is grounded evaluation — the judge doesn't just review the assessment's claims, it verifies them against the same real data sources.

### Discharge Assessment Pipeline

```
Step 1: Fetch Patient Data (FHIR)              [always runs, required]
   ├── Step 2: Check Drug Interactions (FDA)    [parallel, required]
   ├── Step 3: Check Black Box Warnings (FDA)   [parallel, graceful fail]
   ├── Step 4: Check Drug Recalls (FDA)         [parallel, graceful fail]
   ├── Step 5: Evaluate Care Gaps (Guidelines)  [parallel, required]
   ├── Step 6: Estimate Costs (CMS)             [parallel, graceful fail]
   └── Step 7: Retrieve Knowledge (TF-IDF RAG)  [parallel, graceful fail]
       ↑ Production: replace with knowledge graph (Neo4j) + vector DB
Step 8: LLM Synthesis → Score + Risk Factors    [after all above complete, required]
   └── Post-LLM Calibration (deterministic)     [safety constraint layer]
```

### Patient Recovery Coach

The Recovery Coach is a **tool-augmented conversational AI** with a hybrid routing architecture:

**Layer 1 — Deterministic Tool Detection** (primary path): Keyword matching on the patient's message decides which tool to call before the LLM is ever invoked. "What are the side effects of warfarin?" triggers `lookupMedication("warfarin")` via regex, not via LLM reasoning. This is intentional — regex-based tool detection is 100% reliable, whereas asking a cheap LLM to output structured JSON tool calls is not (especially open models on free-tier inference).

**Layer 2 — LLM Tool Selection** (fallback path): When keywords don't match, the LLM decides whether to respond directly or request a tool via JSON. This is genuine agentic behavior — the model is making a routing decision based on its understanding of the patient's question. It handles edge cases where the patient phrases something unexpectedly.

**Data source fallback chains**: Each tool tries local knowledge base first (instant, offline), then external APIs (FDA DailyMed, MedlinePlus), then LLM generation as a last resort — prioritizing verified data over generated text.

**Adaptive communication**: The coach automatically adjusts its language and tone based on patient age — simple words and encouragement for children, clear professional language for adults, patient-focused explanations with caregiver involvement prompts for elderly patients. This is driven by the system prompt, not separate models.

**Why not native function calling for all routing?** The models used in this prototype (GPT-4o Mini, Qwen3, Gemini Flash) have varying levels of function-calling reliability, especially at the free/cheap tier. Proactive keyword detection eliminates the most common failure mode (malformed JSON from the LLM) for the most common queries. In production, native function calling with a validated model (GPT-4o, Claude Sonnet) and structured output guarantees would replace the keyword layer. The clinical tools could be exposed as MCP (Model Context Protocol) servers — standardized endpoints that any MCP-compatible model can discover and invoke, decoupling tool implementation from the routing layer and making it trivial to add new data sources without changing coach code. The local knowledge base (TF-IDF over ~400 documents) would be replaced with a knowledge graph (Neo4j) for relational clinical queries (drug-condition-symptom relationships) and vector embeddings for semantic retrieval.

### Clinical Assessment Tools

| Tool | Purpose | Data Source | LLM Call? |
|------|---------|-------------|-----------|
| `fetch_patient` | Get patient demographics, meds, conditions | Demo FHIR data | No |
| `check_drug_interactions` | Find drug-drug interactions | FDA RxNorm API (cached 24h) | No |
| `check_boxed_warnings` | Get FDA Black Box Warnings | FDA OpenFDA Label API (cached 24h) | No |
| `check_drug_recalls` | Get recall info | FDA Enforcement API (cached 12h) | No |
| `get_comprehensive_drug_safety` | Combined FAERS/warnings/recalls | FDA APIs (cached) | No |
| `evaluate_care_gaps` | Check guideline compliance | Rule-based (ACC/AHA, ADA, GOLD) | No |
| `estimate_costs` | Medication pricing | CMS data | No |
| `retrieve_knowledge` | Clinical guidance search | Keyword-based knowledge base | No |
| `check_preventive_care_gaps` | USPSTF preventive care gaps | MyHealthfinder API (cached 24h) | No |
| `analyze_readiness` | Final synthesis | LLM | Yes |
| `generate_plan` | Discharge plan creation | LLM | Yes |

### Patient Coach Tools

| Tool | Purpose | Data Sources (fallback order) |
|------|---------|-------------------------------|
| `lookupMedication` | Drug info in patient-friendly language | 1. Local KB → 2. FDA DailyMed API → 3. LLM |
| `checkSymptom` | Symptom triage and urgency | 1. Local KB → 2. MedlinePlus API → 3. LLM |
| `explainMedicalTerm` | Simple explanations of jargon | 1. Local KB → 2. LLM |
| `getFollowUpGuidance` | Appointment scheduling guidance | Rule-based with patient context |
| `getDietaryGuidance` | Diet recommendations | Rule-based with condition/medication awareness |
| `getActivityGuidance` | Activity restrictions | Rule-based with risk awareness |
| `getPreventiveCare` | USPSTF preventive care recommendations | 1. MyHealthfinder API → 2. Default USPSTF recommendations |

### Design Philosophy

- **Deterministic Data Gathering, AI-Powered Synthesis**: All clinical data sources are always consulted. The LLM's job is synthesis and reasoning over complete data — not deciding what data to look at.
- **Dependency-Aware Parallel Execution**: Steps 2-7 fan out in parallel after Step 1 completes, with Step 8 waiting for all to finish. `Promise.allSettled()` provides ~2-3x speedup over sequential execution.
- **Post-LLM Calibration**: Deterministic rules constrain the LLM's output (score capping based on high-risk factor count) to prevent the model from underweighting critical safety signals.
- **Graceful Degradation**: Non-required tools (warnings, recalls, costs, knowledge) can fail without blocking the assessment. Required tools (patient data, drug interactions, care gaps, final analysis) must succeed.
- **Proactive Tool Detection**: The Patient Coach uses keyword-based tool detection rather than LLM-decided tool calling, eliminating JSON parsing failures as a failure mode.
- **Data Source Fallback Chains**: Patient Coach tools try local knowledge base first (fast, offline), then external APIs (FDA DailyMed, MedlinePlus), then LLM generation as a last resort — prioritizing verified data over generated text.
- **FDA Caching**: API results cached (RxCUI: 7d, interactions: 24h, labels: 24h, recalls: 12h) to reduce latency and API calls.
- **PII/PHI Guardrails**: Input sanitization before LLM calls and output sanitization after, with critical PII (SSN, credit cards) blocking the request entirely. Applied to all LLM-calling endpoints: discharge analysis, plan generation, patient chat, patient summary, patient coach tool fallbacks, and LLM-as-Judge evaluation.
- **Prompt Versioning**: All prompts stored in Opik Prompt Library with local fallbacks for offline/testing.
- **Error Resilience**: Tool failures are traced to Opik with full context. Non-required tool failures degrade gracefully; required tool failures return clear error messages.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```
 
### Required

| Variable | Where to get it | What it does |
|----------|----------------|-------------|
| `OPIK_API_KEY` | [comet.com/opik](https://www.comet.com/opik) | Opik observability — tracing, prompt versioning, evaluation |
| `OPIK_PROJECT_NAME` | — | Opik project name (default: `transitioniq`) |
| At least **one** LLM key below | | |

### LLM Providers (at least one required)

| Variable | Where to get it | Model(s) |
|----------|----------------|----------|
| `OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com) | GPT-4o Mini — **also powers voice TTS & STT** |
| `HF_API_KEY` | [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) | Qwen3 8B, Qwen3 30B (free tier available) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) | Gemini 2.5 Flash, 2.5 Flash Lite |

> **Note**: `OPENAI_API_KEY` serves double duty — it's both an LLM provider *and* the key for voice features (text-to-speech via `tts-1`, speech-to-text via Whisper). Without it, the app works fine for text but voice features will be disabled.

### Model Priority

When multiple API keys are configured, the default model is selected in this order:
1. OpenAI GPT-4o Mini (if `OPENAI_API_KEY` set)
2. HuggingFace Qwen3 8B (if `HF_API_KEY` set)
3. Gemini 2.5 Flash Lite (if `GEMINI_API_KEY` set)

You can override this by setting `LLM_MODEL` or using the model selector in the UI.

### Optional Configuration

```env
# Override default LLM model (see Available Models section)
LLM_MODEL=openai-gpt-4o-mini

# Admin bypass for rate limits during live demos (see Rate Limiting section)
ADMIN_SECRET=your_secret_here

# Enable the source code viewer at /source (default: disabled)
CODE_VIEWER_ENABLED=true

# Hide the evaluation tab from the UI (default: shown)
NEXT_PUBLIC_DISABLE_EVALUATION=true

# FHIR server URL (default: SMART Health IT Sandbox)
FHIR_BASE_URL=https://launch.smarthealthit.org/v/r4/fhir

# Voice rate limit overrides (defaults shown)
VOICE_RATE_LIMIT_MAX=5              # Max TTS requests per window
VOICE_RATE_LIMIT_WINDOW_MIN=1440    # TTS window in minutes (default: 24 hours)
STT_RATE_LIMIT_MAX=10               # Max Whisper STT requests per window
STT_RATE_LIMIT_WINDOW_MIN=60        # STT window in minutes (default: 1 hour)
```

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

See [Quick Start](#quick-start) above for initial setup. Additional commands:

```bash
npm run build        # Production build (generates code manifest + Next.js build)
npm run lint         # ESLint check
npm run start        # Start production server (after build)
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
|  | Dashboard   |  | + Recovery   |  |  (Model Comparison +   | |
|  | + Score     |  |   Coach Chat |  |   LLM Judge)           | |
|  +-------------+  +--------------+  +------------------------+ |
+-----------------------------------------------------------------+
                              |
                              v
+-----------------------------------------------------------------+
|                    API Routes (Next.js)                          |
|  /api/analyze | /api/patient-chat | /api/generate-plan          |
|  /api/agent   | /api/evaluate/judge | /api/model/switch         |
+-----------------------------------------------------------------+
                              |
               +--------------+--------------+
               v              v              v
+------------------+   +---------------+   +---------------+
|  Orchestrator    |   |  Data Sources |   |     Opik      |
|  (Deterministic  |   |   (Cached)    |   |  Observability|
|   Pipeline)      |   |               |   |               |
|                  |   | * FDA/RxNorm  |   | * Traces      |
|  Plan (fixed)    |   | * FDA Labels  |   | * Prompts     |
|  → Parallel      |   | * FDA FAERS   |   | * Token/Cost  |
|    Tool Exec     |   | * CMS Costs   |   | * Errors      |
|  → LLM Synthesis |   | * Guidelines  |   | * Eval        |
|  → Calibration   |   | * TF-IDF RAG  |   |               |
|                  |   |               |   |               |
|  + Memory        |   +---------------+   +---------------+
|  + Guardrails    |
+------------------+
        |
        v
+------------------+
|  LLM Provider    |
|  Abstraction     |
|                  |
|  * OpenAI        |
|  * HuggingFace   |
|  * Gemini        |
|                  |
|  + Token Agg.    |
|  + Cost Tracking |
+------------------+
```

### Clinical View Flow

```
POST /api/agent { patientId }
         ↓
  orchestrator.runAgent()
         ↓
  Phase 1 — Plan (deterministic, fixed DAG):
    createPlan() → 8 steps with dependency ordering
         ↓
  Phase 2 — Parallel Tool Execution:
    Batch 1: fetch_patient (Step 1)
    Batch 2 (parallel after Step 1):
      ├─ check_drug_interactions → FDA RxNorm
      ├─ check_boxed_warnings → FDA Labels
      ├─ check_drug_recalls → FDA Enforcement
      ├─ evaluate_care_gaps → Rule-based guidelines
      ├─ estimate_costs → CMS data
      └─ retrieve_knowledge → TF-IDF RAG
    Batch 3: analyze_readiness → LLM synthesis (after all above)
         ↓
  Phase 3 — Post-LLM Calibration:
    Score capping based on high-risk factor count
    Inject missed cost barriers
         ↓
  Response: { score, status, riskFactors, agentGraph, toolsUsed }
```

### Patient Chat Flow

```
POST /api/patient-chat { patientId, message }
         ↓
  Guardrails: off-topic check (70+ health keywords + regex patterns)
         ↓
  Memory: retrieve/create session, compact conversation history
         ↓
  Tool Detection (Layer 1 — Deterministic):
    detectRequiredTool(message) → keyword regex matching
    Example: "side effects of lisinopril" → lookupMedication("lisinopril")
         ↓
  If tool detected:
    Execute tool directly (KB → API → LLM fallback chain)
    → LLM call: generate response using tool results
         ↓
  If no tool detected (Layer 2 — LLM Fallback):
    LLM call: respond directly OR output JSON tool request
    → If tool requested: execute tool, second LLM call with results
         ↓
  Cleanup: strip thinking tokens, JSON artifacts, stray syntax
         ↓
  Response with patient-friendly, age-adapted language
```

## Key Files

### Pipeline Core

| File | Purpose |
|------|---------|
| `src/lib/agents/orchestrator.ts` | Deterministic pipeline orchestrator — fixed DAG plan, dependency-aware parallel execution, session management |
| `src/lib/agents/tools.ts` | Clinical tool implementations (FDA, CMS, guidelines, RAG) — return structured data only |
| `src/lib/agents/patient-coach-tools.ts` | Patient-facing tools with fallback chains (KB → API → LLM) — medication lookup, symptom triage, term explanation, dietary/activity guidance |
| `src/lib/agents/memory.ts` | Session memory management, conversation history compaction, assessment history |
| `src/lib/agents/tracing.ts` | Opik trace integration for tool calls and agent execution |
| `src/lib/agents/evaluation.ts` | Tool correctness evaluation (fire-and-forget after each tool call) |
| `src/lib/agents/types.ts` | Type definitions for tools, contexts, and agent state |
| `src/lib/guardrails/pii-detector.ts` | PII/PHI detection and sanitization for LLM inputs and outputs |
| `src/lib/utils/llm-json.ts` | LLM JSON parsing utilities (handles thinking tokens, truncation, trailing commas) |

### External Data Sources

| File | Purpose |
|------|---------|
| `src/lib/integrations/fda-client.ts` | FDA/RxNorm APIs with caching (interactions, boxed warnings, FAERS, recalls) |
| `src/lib/integrations/cms-client.ts` | CMS Medicare Part D cost estimation |
| `src/lib/integrations/guidelines-client.ts` | Rule-based clinical guideline compliance checks |
| `src/lib/integrations/dailymed-client.ts` | FDA DailyMed drug label API |
| `src/lib/integrations/medlineplus-client.ts` | MedlinePlus health topic API |
| `src/lib/integrations/myhealthfinder-client.ts` | ODPHP MyHealthfinder API for USPSTF preventive care |
| `src/lib/integrations/food-drug-interactions.ts` | Food-drug interaction database (grapefruit, tyramine, etc.) |

### LLM & Observability

| File | Purpose |
|------|---------|
| `src/lib/integrations/llm-provider.ts` | Multi-provider LLM abstraction with Opik tracing and token aggregation |
| `src/lib/integrations/opik.ts` | Core Opik client, trace/span management, error tracing |
| `src/lib/integrations/opik-prompts.ts` | Prompt Library (8 prompts versioned in Opik) |
| `src/lib/integrations/analysis.ts` | Discharge analysis using LLM provider |
| `src/lib/evaluation/llm-judge.ts` | LLM-as-Judge quality evaluation with FDA verification tools |

### Knowledge Base

| File | Purpose |
|------|---------|
| `src/lib/knowledge-base/vector-search.ts` | Zero-dependency TF-IDF search engine with medical NLP |
| `src/lib/knowledge-base/knowledge-index.ts` | Knowledge base indexer (~400 clinical documents) |
| `src/lib/knowledge-base/drug-monographs.ts` | FDB-style drug monograph data |
| `src/lib/knowledge-base/symptom-triage.ts` | Schmitt-Thompson style symptom triage protocols |
| `src/lib/knowledge-base/medical-terminology.ts` | MeSH-style medical term definitions |

### UI Components

| File | Purpose |
|------|---------|
| `src/components/DischargeScore.tsx` | Animated circular score gauge with methodology explanation |
| `src/components/PatientRecoveryCoach.tsx` | Patient-facing preparation guide and checklist |
| `src/components/PatientChat.tsx` | Multi-turn recovery coach chat with streaming SSE support and voice I/O |
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
- **Tool Spans**: Each tool execution traced with inputs, outputs, duration, and success/failure status
- **Pipeline Traces**: Full execution graph of the deterministic pipeline (plan → parallel tools → synthesis → calibration)
- **Error Traces**: All API route errors logged as `error-{source}` traces with stack traces
- **Thread Grouping**: Multi-turn conversations grouped by `threadId` metadata

### Evaluation Tab

The Evaluation tab provides three evaluation capabilities:

**1. LLM-as-Judge with FDA Cross-Verification** (automatic after every assessment):
- Independently fetches FDA drug interaction and Black Box Warning data for the patient's medications
- Compares what the assessment found vs what FDA actually reports — catches missed risks
- Scores on 4 weighted criteria: Safety (40%), Accuracy (25%), Actionability (20%), Completeness (15%)
- Pass threshold: >= 0.7 overall. Below 0.7 flags for review.
- The judge is grounded in real data: if the pipeline missed a drug interaction that FDA reports, the Safety and Accuracy scores are penalized
- FDA cross-verification call is traced separately in Opik (interaction count, warning count, any API errors)
- Requires `OPENAI_API_KEY` (always uses OpenAI regardless of active model)

**2. Model Comparison** (manual):
- Runs all demo patients through selected LLM providers
- Measures per-model: latency, discharge score accuracy vs expected range, status match, risk factor coverage
- Determines winner by weighted scoring: success rate (40%) + confidence (30%) + speed (30%)

**3. Opik Experiments** (manual):
- Runs predefined test cases through Opik SDK experiment framework
- Tracks score consistency, status correctness, and risk coverage across prompt versions
- Results stored in Opik for regression tracking

### Known Limitations

These are gaps in the current prototype that would need to be addressed before production:

- **Demo data**: All 5 patients are synthetic FHIR data. FDA API calls are real but patient data is not.

## Source Code Viewer (Was hoping to bypass public github repo requirement this is depreciated and wouldn't ship with actual product)

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