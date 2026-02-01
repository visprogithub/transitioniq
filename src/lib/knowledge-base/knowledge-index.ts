/**
 * Knowledge Base Indexer - Builds a searchable TF-IDF index
 *
 * Converts all 4 knowledge-base modules into SearchDocuments and builds
 * a lazy-initialized TF-IDF index for vector-like search.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  Lazy Initialization (first request builds index)           │
 * │                                                             │
 * │  Drug Monographs (14) ──┐                                  │
 * │  Drug Interactions (264) ┼──→ SearchDocument[] ──→ TF-IDF  │
 * │  Symptom Triage (11) ───┤                          Index   │
 * │  Medical Terms (100+) ──┘                                  │
 * │                                                             │
 * │  Cached in module scope for serverless reuse               │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Cold start: ~10ms to build index from ~400 documents
 * Search: <1ms per query (cosine similarity over sparse vectors)
 * Memory: ~500KB for index (well within Vercel serverless limits)
 */

import { DRUG_MONOGRAPHS, type DrugMonograph } from "./drug-monographs";
import { DRUG_INTERACTIONS, type DrugInteraction } from "./drug-interactions";
import { SYMPTOM_TRIAGE, type TriageProtocol } from "./symptom-triage";
import { MEDICAL_TERMS, type MedicalTerm } from "./medical-terminology";
import {
  buildIndex,
  search,
  formatResultsForLLM,
  type SearchDocument,
  type SearchResult,
  type TFIDFIndex,
} from "./vector-search";

// Lazy-initialized singleton index
let _index: TFIDFIndex | null = null;

/**
 * Convert drug monographs into searchable documents
 */
function indexDrugMonographs(): SearchDocument[] {
  return Object.entries(DRUG_MONOGRAPHS).map(([key, drug]: [string, DrugMonograph]) => {
    // Build rich content string for indexing
    const contentParts = [
      `Generic name: ${drug.genericName}`,
      `Brand names: ${drug.brandNames.join(", ")}`,
      `Drug class: ${drug.drugClass.join(", ")}`,
      `Category: ${drug.therapeuticCategory}`,
      `Mechanism: ${drug.mechanismOfAction}`,
      `Indications: ${drug.indications.map((i) => i.condition).join(", ")}`,
      `Contraindications: ${drug.contraindications.join("; ")}`,
      drug.warnings.length > 0
        ? `Warnings: ${drug.warnings.map((w) => `[${w.type}] ${w.text}`).join("; ")}`
        : "",
      drug.adverseReactions.length > 0
        ? `Side effects: ${drug.adverseReactions.map((a) => `${a.reaction} (${a.frequency}, ${a.severity})`).join("; ")}`
        : "",
      drug.patientCounseling.length > 0
        ? `Patient counseling: ${drug.patientCounseling.map((p) => p.advice).join("; ")}`
        : "",
      drug.monitoringParameters.length > 0
        ? `Monitoring: ${drug.monitoringParameters.map((m) => `${m.parameter} (${m.frequency})`).join("; ")}`
        : "",
      drug.foodInteractions.length > 0
        ? `Food interactions: ${drug.foodInteractions.join("; ")}`
        : "",
      `Renal dosing: ${drug.renalDosing}`,
      `Hepatic dosing: ${drug.hepaticDosing}`,
      `Pregnancy: ${drug.pregnancyCategory}`,
    ].filter(Boolean);

    return {
      id: `drug-${key}`,
      type: "drug_monograph" as const,
      title: `${drug.genericName} (${drug.brandNames[0] || key})`,
      content: contentParts.join("\n"),
      metadata: {
        rxcui: drug.rxcui,
        genericName: drug.genericName,
        brandNames: drug.brandNames,
        drugClass: drug.drugClass,
        therapeuticCategory: drug.therapeuticCategory,
      },
    };
  });
}

/**
 * Convert drug interactions into searchable documents
 */
function indexDrugInteractions(): SearchDocument[] {
  return DRUG_INTERACTIONS.map((interaction: DrugInteraction, i: number) => {
    const contentParts = [
      `Severity: ${interaction.severity}`,
      `Clinical effect: ${interaction.clinicalEffect}`,
      `Mechanism: ${interaction.mechanism}`,
      `Management: ${interaction.managementRecommendation}`,
      `Patient counseling: ${interaction.patientCounseling}`,
      interaction.monitoringParameters.length > 0
        ? `Monitoring: ${interaction.monitoringParameters.join(", ")}`
        : "",
      `Documentation: ${interaction.documentation}`,
      `Onset: ${interaction.onsetTime}`,
    ].filter(Boolean);

    return {
      id: `interaction-${i}`,
      type: "drug_interaction" as const,
      title: `${interaction.drug1.genericName} + ${interaction.drug2.genericName} interaction`,
      content: contentParts.join("\n"),
      metadata: {
        drug1: interaction.drug1.genericName,
        drug2: interaction.drug2.genericName,
        severity: interaction.severity,
        documentation: interaction.documentation,
      },
    };
  });
}

/**
 * Convert symptom triage protocols into searchable documents
 */
function indexSymptomTriage(): SearchDocument[] {
  return Object.entries(SYMPTOM_TRIAGE).map(([key, protocol]: [string, TriageProtocol]) => {
    const contentParts = [
      `Symptom: ${protocol.symptom}`,
      `Also known as: ${protocol.alternativeNames.join(", ")}`,
      `Category: ${protocol.category}`,
      `Default urgency: ${protocol.defaultUrgency}`,
      protocol.redFlags.length > 0
        ? `Red flags: ${protocol.redFlags.map((f) => `${f.condition} (${f.indicatesUrgency}): ${f.patientFriendlyDescription}`).join("; ")}`
        : "",
      protocol.assessmentQuestions.length > 0
        ? `Assessment: ${protocol.assessmentQuestions.map((q) => q.question).join("; ")}`
        : "",
      protocol.selfCareGuidance.length > 0
        ? `Self-care: ${protocol.selfCareGuidance.join("; ")}`
        : "",
      protocol.whenToSeekCare.length > 0
        ? `When to seek care: ${protocol.whenToSeekCare.join("; ")}`
        : "",
      protocol.commonCauses.length > 0
        ? `Common causes: ${protocol.commonCauses.join(", ")}`
        : "",
      protocol.medicationConsiderations.length > 0
        ? `Medication considerations: ${protocol.medicationConsiderations.map((m) => `${m.medication}: ${m.concern}`).join("; ")}`
        : "",
    ].filter(Boolean);

    return {
      id: `triage-${key}`,
      type: "symptom_triage" as const,
      title: `Symptom: ${protocol.symptom}`,
      content: contentParts.join("\n"),
      metadata: {
        symptom: protocol.symptom,
        category: protocol.category,
        defaultUrgency: protocol.defaultUrgency,
        alternativeNames: protocol.alternativeNames,
      },
    };
  });
}

/**
 * Convert medical terms into searchable documents
 */
function indexMedicalTerms(): SearchDocument[] {
  return Object.entries(MEDICAL_TERMS).map(([key, term]: [string, MedicalTerm]) => {
    const contentParts = [
      `Term: ${term.term}`,
      `Also known as: ${term.alternativeNames.join(", ")}`,
      `Category: ${term.category}`,
      `Medical definition: ${term.medicalDefinition}`,
      `Patient-friendly: ${term.patientFriendlyExplanation}`,
      `Related terms: ${term.relatedTerms.join(", ")}`,
      `Context: ${term.commonContext}`,
    ];

    return {
      id: `term-${key}`,
      type: "medical_term" as const,
      title: `Term: ${term.term}`,
      content: contentParts.join("\n"),
      metadata: {
        term: term.term,
        category: term.category,
        alternativeNames: term.alternativeNames,
      },
    };
  });
}

/**
 * Get or build the TF-IDF index (lazy singleton)
 * Thread-safe for serverless: builds once per cold start
 */
export function getKnowledgeIndex(): TFIDFIndex {
  if (_index) return _index;

  console.log("[Knowledge Index] Building TF-IDF index from knowledge base...");
  const startTime = Date.now();

  const documents: SearchDocument[] = [
    ...indexDrugMonographs(),
    ...indexDrugInteractions(),
    ...indexSymptomTriage(),
    ...indexMedicalTerms(),
  ];

  _index = buildIndex(documents);

  console.log(
    `[Knowledge Index] Built index: ${documents.length} documents, ${_index.vocabulary.size} terms in ${Date.now() - startTime}ms`
  );

  return _index;
}

/**
 * Search the clinical knowledge base
 *
 * @param query - Natural language query (e.g., "warfarin bleeding risk")
 * @param options - Search options (topK, type filter, min score)
 * @returns Ranked search results with relevance scores
 */
export function searchKnowledgeBase(
  query: string,
  options: {
    topK?: number;
    minScore?: number;
    typeFilter?: SearchDocument["type"][];
  } = {}
): SearchResult[] {
  const index = getKnowledgeIndex();
  return search(index, query, options);
}

/**
 * Search and format results for LLM consumption
 *
 * This is the main entry point for the agent tool.
 * Returns a formatted string ready to be injected into an LLM prompt.
 */
export function retrieveKnowledge(
  query: string,
  options: {
    topK?: number;
    typeFilter?: SearchDocument["type"][];
  } = {}
): { results: SearchResult[]; formatted: string; documentCount: number } {
  const results = searchKnowledgeBase(query, {
    topK: options.topK || 5,
    minScore: 0.03,
    typeFilter: options.typeFilter,
  });

  return {
    results,
    formatted: formatResultsForLLM(results),
    documentCount: getKnowledgeIndex().totalDocs,
  };
}

/**
 * Get index statistics (for observability/Opik metadata)
 */
export function getIndexStats(): {
  totalDocuments: number;
  vocabularySize: number;
  documentsByType: Record<string, number>;
} {
  const index = getKnowledgeIndex();

  const documentsByType: Record<string, number> = {};
  for (const doc of index.documents) {
    documentsByType[doc.type] = (documentsByType[doc.type] || 0) + 1;
  }

  return {
    totalDocuments: index.totalDocs,
    vocabularySize: index.vocabulary.size,
    documentsByType,
  };
}

/**
 * Reset index (useful for testing)
 */
export function resetKnowledgeIndex(): void {
  _index = null;
}
