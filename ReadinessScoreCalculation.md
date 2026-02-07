## How the Readiness Score Works

The Readiness Score is a **hybrid system**. It combines LLM-generated reasoning with strict algorithmic calibration to ensure safety and consistency.

---

## How the Score Is Produced

### Step 1. LLM Generates an Initial Score

The LLM (Gemini or a fallback model) receives structured patient data from **8 real-time sources**:

- FDA drug interactions
- FDA black box warnings
- FDA recalls
- Clinical care gaps (rule-based + MyHealthfinder + LLM-augmented)
- CMS cost estimates (with LLM reasoning)
- TF-IDF RAG clinical knowledge retrieval (with LLM synthesis)
- FHIR lab results
- Patient vitals

Using calibration ranges embedded directly in the prompt, the model generates an initial **0–100 score**.

| Score Range | Meaning |
|-----------|--------|
| **80–100** | Low complexity. Routine transition with few concerns |
| **65–79** | Moderate complexity. Minor issues, generally on track |
| **45–64** | Notable concerns. Several issues warrant clinical review |
| **25–44** | Significant concerns. Multiple serious issues |
| **0–24** | Critical. Immediate safety risks |

---

### Step 2. Algorithmic Calibration Caps the Score

LLMs tend to under-penalize even when they correctly identify serious risks. To prevent false optimism, **hard score ceilings** are enforced based on the risk factors the LLM itself produced.

These rules are implemented in `analysis.ts` (lines 350–380).

| Risk Factor Pattern | Score Cap |
|--------------------|----------|
| **2+ high-severity risks** | Capped at **35** (forces *Not Ready*) |
| **1 high + 2+ moderate** | Capped at **45** |
| **1 high-severity alone** | Capped at **55** |
| **No high-severity risks** | No cap applied |

---

### Step 3. Status Derived from Calibrated Score

After calibration, the final readiness status is derived:

- **70–100** → **Ready**
- **40–69** → **Caution**
- **0–39** → **Not Ready**

---

## What Factors Contribute Most Heavily

The LLM generates the initial score and risk factors — there are no fixed deduction weights in the primary pipeline. The LLM reasons holistically over all data sources.

However, the **post-LLM calibration** (Step 2) ensures that high-severity risk factors always dominate the final score regardless of what the LLM outputs. In practice, drug interactions are the **single heaviest factor** because they most frequently produce high-severity risk factors. Two high-severity interactions trigger the algorithmic cap, forcing the final score to **≤ 35**.

> **Note:** A separate rule-based fallback scorer exists in `evaluation.ts` for Opik evaluation experiments. It uses explicit deduction weights (−20/−10/−5 pts for drug interactions, −15/−8/−3 pts for care gaps, −5 pts per abnormal lab). This scorer is used for automated test case evaluation, **not** for the actual patient discharge analysis pipeline.

---

## Post-LLM Injections

The system catches issues the LLM may miss:

- **Cost barriers**
  Any medication with monthly out-of-pocket ≥ **$100** that the LLM did not flag is injected as a risk factor.
  - OOP ≥ **$400** → Injected as **high** severity
  - OOP **$100–399** → Injected as **moderate** severity

  This distinction matters because injected high-severity cost barriers count toward the calibration caps (e.g., 2+ high → score ≤ 35).

- **Missing medications**
  Patient summary backfill ensures no prescribed medications are omitted from analysis.

---

## Risk Factor Categories

The score incorporates risk factors across multiple categories, each tagged with a data-source badge in the UI. Four categories are **code-enforced** (always generated when relevant data exists):

- `drug_interaction` — Source: FDA
- `care_gap` — Source: Clinical Guidelines
- `cost_barrier` — Source: CMS (also injected post-LLM)
- `lab_abnormality` — Source: FHIR

The LLM may also generate risk factors in additional categories based on patient context:

- `follow_up` — Missed or unscheduled appointments
- `patient_education` — Knowledge gaps about medications or self-care
- `vital_sign` — Concerning vital sign trends
- `social_determinant` — Transportation, housing, caregiver availability

Each category is tied to its source system (FDA, CMS, Clinical Guidelines, or FHIR).
