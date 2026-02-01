/**
 * Clinical Knowledge Base - Serverless Healthcare Database
 *
 * Designed for Vercel Edge/Serverless deployment:
 * - All data is bundled as static imports (no external DB required)
 * - In-memory lookups optimized for serverless cold starts
 * - No persistent storage - stateless design
 * - Edge-compatible (works in Edge Runtime)
 *
 * This module simulates what a commercial clinical decision support database
 * like FirstDatabank (FDB), Medi-Span, or Wolters Kluwer would provide.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │                    Vercel Serverless                        │
 * │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
 * │  │ Drug         │  │ Symptom      │  │ Medical      │     │
 * │  │ Monographs   │  │ Triage       │  │ Terminology  │     │
 * │  │ (static)     │  │ (static)     │  │ (static)     │     │
 * │  └──────────────┘  └──────────────┘  └──────────────┘     │
 * │         │                │                │                │
 * │         └────────────────┼────────────────┘                │
 * │                          │                                 │
 * │                   ┌──────▼──────┐                         │
 * │                   │  Knowledge   │                         │
 * │                   │  Base API    │                         │
 * │                   └─────────────┘                         │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Data sources simulated:
 * - Drug monographs (FDB MedKnowledge structure)
 * - Drug-drug interactions (FDB Drug Interactions)
 * - Symptom triage (Schmitt-Thompson protocol structure)
 * - Medical terminology (MeSH/SNOMED structure)
 */

// Re-export all knowledge base modules
export * from "./drug-monographs";
export * from "./drug-interactions";
export * from "./symptom-triage";
export * from "./medical-terminology";
export * from "./vector-search";
export * from "./knowledge-index";

// Knowledge base metadata
export const KNOWLEDGE_BASE_INFO = {
  name: "TransitionIQ Clinical Knowledge Base",
  version: "1.0.0",
  lastUpdated: "2025-01-28",
  deploymentModel: "Vercel Serverless/Edge Compatible",
  sources: [
    "Simulated FDB MedKnowledge structure",
    "Public FDA drug label data",
    "Clinical practice guidelines (ACC/AHA, ADA, GOLD)",
    "Schmitt-Thompson triage protocols (structure)",
    "MedlinePlus consumer health information",
  ],
  capabilities: {
    drugLookup: true,
    drugInteractions: true,
    symptomTriage: true,
    medicalTerminology: true,
    patientEducation: true,
  },
  disclaimer:
    "This is a demonstration knowledge base. For production use, integrate with licensed clinical decision support databases.",
};

/**
 * Unified knowledge base query interface
 * Optimized for serverless - minimal cold start impact
 */
export interface KnowledgeBaseQuery {
  type: "drug" | "symptom" | "term" | "interaction";
  query: string;
  context?: {
    patientAge?: number;
    patientConditions?: string[];
    currentMedications?: string[];
  };
}

export interface KnowledgeBaseResult {
  found: boolean;
  source: string;
  data: unknown;
  confidence: "high" | "medium" | "low";
  fallbackRecommended: boolean;
}
