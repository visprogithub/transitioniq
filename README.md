# TransitionIQ - AI Discharge Readiness Assessment

**PROPRIETARY AND CONFIDENTIAL**

Copyright (c) 2026. All Rights Reserved.

This software and its source code are proprietary and confidential. Unauthorized copying, modification, distribution, or use of this software, in whole or in part, is strictly prohibited. This project is NOT open source and is NOT licensed for public use.

---

## Overview

TransitionIQ is an AI-powered discharge readiness assessment tool that helps healthcare providers evaluate whether patients are safe to leave the hospital. It fuses multiple data sources to provide a comprehensive risk assessment:

- **FHIR Patient Data** - Medications, conditions, and lab results
- **FDA Safety Signals** - Drug interaction checks via RxNorm
- **Clinical Guidelines** - ACC/AHA, ADA, GOLD guideline compliance
- **CMS Cost Estimates** - Out-of-pocket cost barriers

## Tech Stack

- **Frontend**: Next.js 16 with App Router, TypeScript, Tailwind CSS
- **LLM**: Multi-provider support (OpenAI, HuggingFace, Gemini, Anthropic)
- **Observability**: Opik (Comet) for tracing, evaluation, and cost tracking
- **Hosting**: Vercel

## Features

- **Multi-Model Support** - Switch between OpenAI GPT-4o Mini, HuggingFace (Qwen, Llama), Gemini, and Anthropic Claude
- **Animated Discharge Score** - Visual gauge (0-100) with status indicators (Ready/Caution/Not Ready)
- **Risk Factor Cards** - Expandable cards with severity levels (high/moderate/low) and data source attribution
- **Smart Rate Limit Handling** - Automatic prompts to switch models when rate limited
- **AI-Generated Discharge Plans** - Comprehensive checklists tailored to patient risk factors
- **Real-time Opik Tracing** - Token usage, cost estimates, and latency tracking for all LLM calls
- **Model Comparison** - A/B testing and evaluation dashboard for comparing model outputs

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
```

### Model Priority

When multiple API keys are configured, the default model is selected in this order:
1. OpenAI GPT-4o Mini (if `OPENAI_API_KEY` set)
2. HuggingFace Qwen 7B (if `HF_API_KEY` set)
3. Anthropic Claude 3 Haiku (if `ANTHROPIC_API_KEY` set)
4. Gemini 2.0 Flash Lite (if `GEMINI_API_KEY` set)

You can override this by setting `LLM_MODEL` or using the model selector in the UI.

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/patient/[id]` | GET | Fetch patient data by ID |
| `/api/analyze` | POST | Run discharge readiness analysis |
| `/api/generate-plan` | POST | Generate discharge checklist |
| `/api/model/switch` | POST | Switch active LLM model |
| `/api/model/switch` | GET | Get current model and available models |
| `/api/evaluate/models` | GET | List all models with availability |
| `/api/evaluate/models` | POST | Run model comparison experiment |

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
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Patient   │  │  Discharge  │  │    Model Selector       │ │
│  │   Header    │  │    Score    │  │  (Multi-provider)       │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Risk Factor │  │  Discharge  │  │  Evaluation Dashboard   │ │
│  │    Cards    │  │    Plan     │  │    (Model Comparison)   │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Routes (Next.js)                       │
│  /api/analyze  │  /api/generate-plan  │  /api/model/switch     │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  LLM Provider │    │  Data Sources │    │     Opik      │
│  Abstraction  │    │               │    │  Observability│
│               │    │  • FDA/RxNorm │    │               │
│  • OpenAI     │    │  • Guidelines │    │  • Traces     │
│  • HuggingFace│    │  • Cost Est.  │    │  • Token Usage│
│  • Gemini     │    │  • FHIR Data  │    │  • Latency    │
│  • Anthropic  │    │               │    │  • Cost Est.  │
└───────────────┘    └───────────────┘    └───────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/integrations/llm-provider.ts` | Multi-provider LLM abstraction with Opik tracing |
| `src/lib/integrations/analysis.ts` | Discharge analysis using LLM provider |
| `src/lib/integrations/opik-prompts.ts` | Prompt library management via Opik |
| `src/components/ModelSelector.tsx` | UI for switching between LLM models |
| `src/components/DischargeScore.tsx` | Animated circular score gauge |
| `src/components/RiskFactorCard.tsx` | Expandable risk factor cards |

## Hackathon

Built for the Encode Club "Commit To Change" (Comet Resolution V2) Hackathon, targeting:
- **Health, Fitness & Wellness Prize** ($5K)
- **Best Use of Opik Prize** ($5K)

### Opik Integration Highlights

- **Prompt Library**: Discharge analysis prompts stored and versioned in Opik
- **LLM Spans**: Every LLM call tracked with model, provider, token usage
- **Cost Tracking**: Estimated costs per request based on token pricing
- **Model Comparison**: A/B testing with Opik experiments
- **Data Source Tracing**: FDA, Guidelines, and FHIR calls tracked separately

---

**NOTICE**: This software is proprietary. No license is granted for use, modification, or distribution.
