# Opik Observability Insights

Live data from the Opik dashboard for `transitioniq`, spanning January 26 – February 7, 2026.

## Scale

| Metric | Value |
|--------|-------|
| Total traces | 11,837+ |
| LLM spans | 5,896+ |
| Experiments | 85 |
| Versioned prompts | 9 (31 total versions) |
| Evaluation dataset | 3 core patients × 12 total demo patients |
| LLM providers tested | 4 (OpenAI, Google AI, HuggingFace, Groq) |
| Models tested | 6 (GPT-4o Mini, Gemini 2.5 Flash, Gemini 2.5 Flash Lite, Qwen3-8B, Qwen3-30B-A3B, Llama 3.3 70B) |
| Evaluation metrics | 4 (score_accuracy, status_correctness, risk_coverage, AnswerRelevance) |
| Active development days | 12 |

---

## Experimentation Velocity

85 experiments were run over 8 active days. The spike on Jan 31 (36 experiments in one day) represents the model comparison sprint where all 6 models were evaluated head-to-head.

| Date | Experiments | What Happened |
|------|-------------|---------------|
| Jan 26 | 13 | Initial evaluation framework setup |
| Jan 27 | 1 | LLM judge prompt authoring |
| Jan 31 | **36** | Model comparison sprint — all 6 models, 14 GPT-4o Mini runs alone to establish baseline |
| Feb 1 | 4 | Specialized prompt extraction (knowledge-retrieval, cost-estimation, care-gap) |
| Feb 2 | 21 | Evaluation metric refinement — switch from generic to domain-specific metrics |
| Feb 3 | 2 | Regression check after prompt changes |
| Feb 4 | 5 | Flash Lite evaluation, cross-model comparison |
| Feb 6 | 3 | Final multi-model evaluation (GPT-4o Mini, Gemini Flash, Qwen3-8B) |

**Key insight**: The evaluation framework itself evolved. Early experiments (Jan 26) established the evaluation pipeline. By Feb 2, domain-specific clinical metrics (score_accuracy, status_correctness, risk_coverage) were designed to directly measure discharge safety. This evolution is visible in the Opik experiment history.

---

## Model Performance Deep Dive

### Head-to-Head Comparison (experiments with domain-specific metrics)

| Model | Experiments | Score Accuracy | Status Correctness | Risk Coverage | Latency p50 | Latency p90 |
|-------|-------------|:---:|:---:|:---:|:---:|:---:|
| **GPT-4o Mini** | 28 (12 scored) | **0.994** [0.933, 1.000] | **0.883** [0.767, 1.000] | **0.976** [0.767, 1.000] | 11.0s | 13.5s |
| **Qwen3-8B** | 13 (7 scored) | 0.866 [0.733, 1.000] | 0.750 [0.650, 0.767] | **0.979** [0.900, 1.000] | **6.1s** | **7.8s** |
| **Gemini 2.5 Flash** | 11 (6 scored) | 0.798 [0.613, 0.867] | 0.457 [0.200, 0.533] | 0.786 [0.767, 0.883] | 16.1s | 22.3s |
| **Gemini Flash Lite** | 10 (2 scored) | **1.000** | **1.000** | 0.533 | **3.7s** | **5.3s** |
| **Qwen3-30B-A3B** | 9 (0 scored) | — | — | — | 14.4s | 15.8s |

*Brackets show [min, max] across experiments. "Scored" = experiments with domain-specific clinical metrics (not just generic NLP metrics).*

### GPT-4o Mini Improvement Trajectory

28 experiments tracked the GPT-4o Mini performance as prompts were refined:

| Phase | Date Range | Score Accuracy | Status Correctness | Risk Coverage | What Changed |
|-------|-----------|:-:|:-:|:-:|:---|
| Early (no metrics) | Jan 31 | — | — | — | Evaluation pipeline setup, no clinical metrics yet |
| First clinical eval | Feb 2 03:45 | 0.933 | 0.767 | 0.942 | Baseline with domain-specific metrics |
| Prompt refinement | Feb 2 03:51 | **1.000** | **1.000** | **1.000** | Improved scoring prompt, structured output |
| Sustained peak | Feb 2–Feb 2 | 1.000 | 1.000 | 1.000 | 5 consecutive perfect runs |
| Regression detected | Feb 3 16:31 | 1.000 | **0.767** | 1.000 | Status correctness dropped after prompt change |
| Stabilized | Feb 4–Feb 6 | 1.000 | 0.767 | 1.000 | Status correctness settled at 0.767 |

**Key finding**: GPT-4o Mini achieved perfect scores across all metrics on Feb 2 but regressed on `status_correctness` (1.000 → 0.767) after a prompt change on Feb 3. The score accuracy and risk coverage remained perfect, meaning the model still identifies risks correctly but occasionally picks the wrong categorical label. This regression pattern is visible because Opik experiments track every prompt version.

### Gemini's Categorical Weakness

Gemini 2.5 Flash has a **status_correctness range of [0.200, 0.533]** across 6 evaluated experiments — meaning it gets the READY/CAUTION/NOT READY label wrong 47–80% of the time. Its score accuracy (0.798) and risk coverage (0.786) are reasonable, suggesting the model understands clinical risk but produces hedged, cautious outputs that don't map to discrete categories.

Gemini 2.5 Flash Lite shows the inverse: perfect categorization (1.000) but the worst risk coverage (0.533). It gets the headline right but misses half the evidence. For a clinical tool, this is dangerous — it would say "Not Ready" but fail to explain why.

### Token Usage Patterns (from LLM span sampling)

| Model | Avg Prompt Tokens | Avg Completion Tokens | Prompt Range | Completion Range | Avg Duration |
|-------|:-:|:-:|:-:|:-:|:-:|
| GPT-4o Mini (analysis) | 2,141 | 729 | [2,141, 2,141] | [553, 869] | 4.1s |
| Gemini 2.5 Flash | 1,525 | 1,072 | [834, 4,291] | [439, 1,660] | 30.0s |
| Qwen3-8B | 1,601 | 729 | [819, 2,266] | [249, 1,024] | 11.6s |

**Gemini uses 47% more completion tokens** on average than GPT-4o Mini (1,072 vs 729), contributing to its higher cost and latency. This aligns with its tendency to produce longer, more hedged responses.

---

## LLM Span Provider Distribution

Sampled from 100 most recent LLM spans:

| Provider | Spans | Cost Tracked | Models |
|----------|:-----:|:------------:|--------|
| OpenAI | 73 | 9 (12%) | gpt-4o-mini (67), tts-1 (7), whisper-1 (7) |
| Google AI | 13 | 11 (85%) | gemini-2.5-flash |
| HuggingFace | 3 | 3 (100%) | Qwen/Qwen3-8B |
| Unknown | 11 | 0 (0%) | Untagged spans |

**Cost tracking gap**: Only **12% of OpenAI spans** have cost data vs 85% of Gemini and 100% of HuggingFace spans. This is because the `gpt-4o-mini` spans created by the direct `LLMProvider.generate()` path (50 of 67 OpenAI spans) don't report token usage — they use a different model ID format (`gpt-4o-mini` vs `openai-gpt-4o-mini`) and their Opik spans are missing the `usage` field entirely.

### The Dual-Path Cost Problem

There are two separate Opik span creation paths in the codebase:

| Path | Span Name Format | Cost Tracked? | Token Usage? |
|------|------------------|:---:|:---:|
| `LLMProvider.generate()` | `{provider}-{modelId}` (e.g., `openai-gpt-4o-mini`) | Sometimes (53%) | Yes (when available) |
| Direct patient-chat | `{modelId}` (e.g., `gpt-4o-mini`) | Never (0%) | No |

This means the same model shows up under two different span names, and the direct path (which handles 74% of OpenAI spans) never reports cost or token usage.

---

## Trace Architecture

Recent trace sampling shows how every clinical operation generates a traceable audit trail:

| Trace Type | Sample Count | LLM Spans | Purpose |
|------------|:-----:|:---:|---------|
| `patient-summary-generation` | 16 | 0.5 avg | Patient-friendly summary (LLM call + guardrails) |
| `guardrail-patient-summary-*` | 16 | 0 | PII input + output checks (no LLM needed) |
| `discharge-analysis` | 6 | 1 | Core clinical assessment |
| `llm-discharge-analysis` | 6 | 1 | LLM synthesis step |
| `guardrail-discharge-analysis-*` | 11 | 0 | PII checks on analysis input/output |
| `patient-chat-response` | 6 | 1 | Recovery Coach conversation turn |
| `llm-judge-call` | 5 | 1 | Evaluation scoring |
| `llm-judge-evaluation` | 5 | 1 | Full evaluation pipeline |
| `discharge-plan-generation` | 3 | 1 | Checklist generation |
| `topic-classifier` | 2 | 1 | Off-topic guardrail (LLM-as-a-judge) |
| `tts-generation` | 1 | 1 | Text-to-speech |
| `error-api-analyze-stream` | 1 | 0 | Traced API error |

**Guardrail-to-LLM ratio**: For every LLM-calling trace (discharge-analysis, patient-chat, plan-generation), there are 2 corresponding guardrail traces (input + output PII checks). This 2:1 guardrail-to-LLM ratio creates a verifiable audit trail that no PHI leaked into or out of any LLM call.

---

## Prompt Evolution

| Prompt | Versions | Created | Last Updated | Role |
|--------|:--------:|:-------:|:------------|------|
| `discharge-analysis` | **16** | Jan 26 | Jan 27 | Core clinical assessment — 16 versions in 2 days |
| `discharge-plan` | 5 | Jan 27 | Jan 27 | Checklist generation |
| `patient-coach` | 2 | Jan 27 | Jan 27 | Recovery Coach system prompt |
| `patient-summary` | 2 | Jan 27 | Jan 27 | Patient-friendly summary |
| `llm-judge` | 1 | Jan 27 | Jan 27 | Evaluation quality scoring |
| `knowledge-retrieval` | 1 | Feb 1 | Feb 1 | RAG synthesis (extracted from monolithic prompt) |
| `cost-estimation` | 1 | Feb 1 | Feb 1 | CMS cost fallback (extracted) |
| `care-gap-evaluation` | 1 | Feb 1 | Feb 1 | Guideline compliance (extracted) |

**Architecture pattern visible in the data**: The project started with a monolithic `discharge-analysis` prompt (16 versions, Jan 26–27) that tried to do everything. On Feb 1, three specialized prompts were extracted (`knowledge-retrieval`, `cost-estimation`, `care-gap-evaluation`) — each with just 1 version because their scope is narrower and more stable. This decomposition from monolith → specialized prompts is a common LLM application maturation pattern, and the Opik versioning history makes it traceable.

---

## Cost Tracking Gap Analysis

| What Opik Reports | Actual Provider Bills | Gap |
|:------------------:|:---------------------:|:---:|
| ~$0.46 | ~$4.63 | **10.1×** undercount |

### Breakdown

| Provider | Opik Estimated | Actual Bill | Gap Factor | Root Cause |
|----------|:-------------:|:----------:|:----------:|-----------|
| OpenAI | ~$0.10 | $1.42 | 14× | 88% of GPT-4o Mini spans have no cost/usage data |
| Gemini | ~$0.30 | $3.11 | 10× | Pricing tables used 2.0 Flash rates (4.2× too low) |
| HuggingFace | ~$0.06 | $0.10 | 1.7× | Best tracked — 100% of spans have cost data |

### What's Been Fixed (pending deployment)

1. **Gemini pricing corrected**: $0.15/M input → $0.30/M, $0.60/M output → $2.50/M
2. **`totalEstimatedCostVersion: "manual"`** added to all span creation points to prevent Opik server-side cost override
3. **Duplicate pricing tables unified**: `llm-provider.ts` and `analysis.ts` now use consistent rates

### What Still Needs Fixing

- The dual-path span creation (direct `gpt-4o-mini` spans vs `openai-gpt-4o-mini` spans) means 74% of OpenAI LLM calls never report token usage or cost. These two paths need to be consolidated.
- TTS (tts-1) and STT (whisper-1) spans have 0% cost tracking — they calculate cost internally but it isn't being written to the span's `total_estimated_cost` field.

---

## What the Data Says About Product Direction

### Clinical Assessment

- **GPT-4o Mini is the only production-viable model** — it's the sole model achieving >0.88 across all three clinical metrics simultaneously. The regression from perfect scores (Feb 2) to 0.767 status correctness (Feb 3+) suggests the current prompt could be improved, and the Opik experiment framework makes it safe to iterate.

### Patient-Facing Features

- **Qwen3-8B is viable for Recovery Coach** — its 0.979 risk coverage shows it understands medical content well, and its free-tier hosting makes it cost-effective for high-volume patient chat. The 0.750 status correctness is acceptable here because the Recovery Coach doesn't make discharge decisions.

### Multi-Model Strategy

- The data supports a **tiered model architecture**: GPT-4o Mini for clinical decisions (high accuracy, acceptable latency), Qwen3-8B for patient chat (good enough accuracy, free hosting), and the topic classifier using whichever model is cheapest for binary classification tasks.

### Evaluation Maturity

- The shift to domain-specific clinical metrics (score_accuracy, status_correctness, risk_coverage) reflects the project's evolution from "does the LLM produce reasonable text?" to "does the LLM make safe clinical decisions?" — a necessary maturation for any healthcare AI tool.
