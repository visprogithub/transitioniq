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

- **Frontend**: Next.js 15 with App Router, TypeScript, Tailwind CSS
- **LLM**: Google Gemini 2.0 Flash
- **Observability**: Opik (Comet) for tracing and evaluation
- **Hosting**: Vercel

## Features

- Animated discharge readiness score (0-100)
- Risk factor cards with severity levels (high/moderate/low)
- Data source attribution (FDA, FHIR, Guidelines)
- AI-generated discharge planning checklist
- Real-time Opik tracing for all API calls

## Environment Variables

Create a `.env.local` file with:

```env
GEMINI_API_KEY=your_gemini_api_key
OPIK_API_KEY=your_opik_api_key
OPIK_PROJECT_NAME=transitioniq
```

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## API Endpoints

- `GET /api/patient/[id]` - Fetch patient data
- `POST /api/analyze` - Run discharge readiness analysis
- `POST /api/generate-plan` - Generate discharge checklist
- `GET /api/evaluate` - View test cases
- `POST /api/evaluate` - Run evaluation with Opik tracking

## Demo Patients

| ID | Name | Scenario |
|----|------|----------|
| `demo-polypharmacy` | John Smith | 12 medications, high drug interaction risk |
| `demo-heart-failure` | Mary Johnson | CHF + COPD, elevated BNP |
| `demo-ready` | Robert Chen | Post-appendectomy, stable |

## Hackathon

Built for the Encode Club "Commit To Change" (Comet Resolution V2) Hackathon, targeting:
- Health, Fitness & Wellness Prize
- Best Use of Opik Prize

---

**NOTICE**: This software is proprietary. No license is granted for use, modification, or distribution.
