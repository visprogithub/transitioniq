/**
 * Lightweight TF-IDF Vector Search Engine
 *
 * Zero external dependencies - works on Vercel Serverless/Edge.
 * Implements a TF-IDF (Term Frequency - Inverse Document Frequency) index
 * for semantic-ish search over the clinical knowledge base.
 *
 * Why TF-IDF instead of embeddings?
 * - Zero dependencies (no ML model, no API call, no vector DB)
 * - Sub-millisecond search on ~300 documents
 * - Works in Edge Runtime (no WASM, no native modules)
 * - Sufficient for structured clinical data with consistent terminology
 * - Cold-start friendly (~1MB index, built lazily on first request)
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────┐
 * │  Knowledge Base (static)                                │
 * │  ┌────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐     │
 * │  │ Drugs  │ │Interacts │ │Symptoms│ │ Terms     │     │
 * │  └───┬────┘ └────┬─────┘ └───┬────┘ └─────┬─────┘     │
 * │      └───────────┬───────────┘             │           │
 * │                  ▼                         │           │
 * │         ┌─────────────────┐                │           │
 * │         │  TF-IDF Indexer │◄───────────────┘           │
 * │         │  (lazy init)    │                            │
 * │         └────────┬────────┘                            │
 * │                  ▼                                     │
 * │         ┌─────────────────┐                            │
 * │         │  Cosine Search  │  → Top-K results           │
 * │         └─────────────────┘                            │
 * └─────────────────────────────────────────────────────────┘
 */

// ============================================================
// Types
// ============================================================

export interface SearchDocument {
  id: string;
  type: "drug_monograph" | "drug_interaction" | "symptom_triage" | "medical_term";
  title: string;
  content: string;
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  document: SearchDocument;
  score: number;
  matchedTerms: string[];
}

export interface TFIDFIndex {
  documents: SearchDocument[];
  /** For each document, the TF vector: Map<term, tf-idf weight> */
  tfidfVectors: Map<string, number>[];
  /** IDF for each term across the corpus */
  idf: Map<string, number>;
  /** Total documents in corpus */
  totalDocs: number;
  /** Vocabulary (unique terms) */
  vocabulary: Set<string>;
}

// ============================================================
// Text Processing (lightweight NLP)
// ============================================================

/** Medical stop words - common words that add no search value */
const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "need", "dare",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "both",
  "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "about", "also", "and", "but", "or", "if", "while", "this", "that",
  "these", "those", "it", "its", "they", "them", "their", "we", "us",
  "our", "you", "your", "he", "she", "his", "her", "i", "me", "my",
  "which", "who", "whom", "what",
]);

/** Medical term synonyms for query expansion */
const MEDICAL_SYNONYMS: Record<string, string[]> = {
  "blood thinner": ["anticoagulant", "warfarin", "apixaban", "rivaroxaban", "coumadin", "eliquis"],
  "anticoagulant": ["blood thinner", "warfarin", "apixaban", "coumadin"],
  "heart failure": ["chf", "congestive", "hf", "cardiac failure", "cardiomyopathy"],
  "high blood pressure": ["hypertension", "htn", "elevated bp"],
  "hypertension": ["high blood pressure", "htn"],
  "diabetes": ["dm", "diabetic", "blood sugar", "glucose", "a1c", "hba1c"],
  "afib": ["atrial fibrillation", "irregular heartbeat", "arrhythmia"],
  "atrial fibrillation": ["afib", "a-fib", "irregular heartbeat"],
  "copd": ["chronic obstructive", "emphysema", "chronic bronchitis", "lung disease"],
  "bleeding": ["hemorrhage", "bruising", "blood loss"],
  "blood clot": ["dvt", "deep vein thrombosis", "pe", "pulmonary embolism", "thrombosis"],
  "kidney": ["renal", "ckd", "nephro"],
  "liver": ["hepatic", "hepato"],
  "pain": ["ache", "discomfort", "soreness", "tenderness"],
  "dizzy": ["dizziness", "vertigo", "lightheaded", "lightheadedness"],
  "swelling": ["edema", "swollen", "fluid retention"],
  "shortness of breath": ["dyspnea", "sob", "breathless", "difficulty breathing"],
  "chest pain": ["angina", "chest discomfort", "chest pressure", "chest tightness"],
  "side effect": ["adverse reaction", "adverse effect", "side effects"],
  "interaction": ["drug interaction", "drug-drug interaction", "ddi"],
};

/**
 * Tokenize text into normalized terms
 * Handles medical abbreviations, hyphenated terms, and numbers
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")  // Keep hyphens for medical terms
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Simple Porter-style stemmer for common medical suffixes
 * Not a full stemmer — just handles the most common patterns
 */
function stem(word: string): string {
  if (word.length <= 3) return word;

  // Medical-specific: keep full forms for clinical accuracy
  const keepWords = new Set([
    "warfarin", "aspirin", "apixaban", "lisinopril", "metoprolol",
    "atorvastatin", "metformin", "furosemide", "omeprazole", "gabapentin",
    "levothyroxine", "digoxin", "losartan", "valsartan", "carvedilol",
    "bisoprolol", "insulin", "sertraline", "tramadol", "oxycodone",
  ]);
  if (keepWords.has(word)) return word;

  // Simple suffix removal
  if (word.endsWith("tion")) return word.slice(0, -4);
  if (word.endsWith("sion")) return word.slice(0, -4);
  if (word.endsWith("ment")) return word.slice(0, -4);
  if (word.endsWith("ness")) return word.slice(0, -4);
  if (word.endsWith("ical")) return word.slice(0, -4);
  if (word.endsWith("ally")) return word.slice(0, -4);
  if (word.endsWith("ious")) return word.slice(0, -4);
  if (word.endsWith("ing")) return word.slice(0, -3);
  if (word.endsWith("ous")) return word.slice(0, -3);
  if (word.endsWith("ity")) return word.slice(0, -3);
  if (word.endsWith("ive")) return word.slice(0, -3);
  if (word.endsWith("ful")) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("er") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("ly") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) return word.slice(0, -1);

  return word;
}

/**
 * Process text into stemmed terms
 */
function processText(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * Expand query with medical synonyms
 */
function expandQuery(query: string): string {
  let expanded = query.toLowerCase();

  for (const [term, synonyms] of Object.entries(MEDICAL_SYNONYMS)) {
    if (expanded.includes(term)) {
      expanded += " " + synonyms.join(" ");
    }
  }

  return expanded;
}

// ============================================================
// TF-IDF Engine
// ============================================================

/**
 * Compute term frequency for a document
 */
function computeTF(terms: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  const total = terms.length;
  if (total === 0) return tf;

  for (const term of terms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }

  // Normalize by document length
  for (const [term, count] of tf) {
    tf.set(term, count / total);
  }

  return tf;
}

/**
 * Compute inverse document frequency for the corpus
 */
function computeIDF(documentTerms: string[][]): Map<string, number> {
  const idf = new Map<string, number>();
  const totalDocs = documentTerms.length;

  // Count documents containing each term
  const docFreq = new Map<string, number>();
  for (const terms of documentTerms) {
    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  // Compute IDF with smoothing: log((N + 1) / (df + 1)) + 1
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }

  return idf;
}

/**
 * Build a TF-IDF index from documents
 */
export function buildIndex(documents: SearchDocument[]): TFIDFIndex {
  const allTerms: string[][] = documents.map((doc) => {
    // Combine title (weighted 2x) and content for indexing
    const text = `${doc.title} ${doc.title} ${doc.content}`;
    return processText(text);
  });

  const idf = computeIDF(allTerms);
  const vocabulary = new Set<string>();

  const tfidfVectors: Map<string, number>[] = allTerms.map((terms) => {
    const tf = computeTF(terms);
    const tfidf = new Map<string, number>();

    for (const [term, tfVal] of tf) {
      const idfVal = idf.get(term) || 0;
      tfidf.set(term, tfVal * idfVal);
      vocabulary.add(term);
    }

    return tfidf;
  });

  return {
    documents,
    tfidfVectors,
    idf,
    totalDocs: documents.length,
    vocabulary,
  };
}

/**
 * Compute cosine similarity between query vector and document vector
 */
function cosineSimilarity(
  queryVec: Map<string, number>,
  docVec: Map<string, number>
): { score: number; matchedTerms: string[] } {
  let dotProduct = 0;
  let queryMag = 0;
  let docMag = 0;
  const matchedTerms: string[] = [];

  for (const [term, qw] of queryVec) {
    queryMag += qw * qw;
    const dw = docVec.get(term) || 0;
    if (dw > 0) {
      dotProduct += qw * dw;
      matchedTerms.push(term);
    }
  }

  for (const [, dw] of docVec) {
    docMag += dw * dw;
  }

  queryMag = Math.sqrt(queryMag);
  docMag = Math.sqrt(docMag);

  if (queryMag === 0 || docMag === 0) return { score: 0, matchedTerms: [] };

  return {
    score: dotProduct / (queryMag * docMag),
    matchedTerms,
  };
}

/**
 * Search the index for relevant documents
 */
export function search(
  index: TFIDFIndex,
  query: string,
  options: {
    topK?: number;
    minScore?: number;
    typeFilter?: SearchDocument["type"][];
  } = {}
): SearchResult[] {
  const { topK = 5, minScore = 0.05, typeFilter } = options;

  // Expand query with medical synonyms
  const expandedQuery = expandQuery(query);
  const queryTerms = processText(expandedQuery);

  if (queryTerms.length === 0) return [];

  // Build query TF-IDF vector
  const queryTF = computeTF(queryTerms);
  const queryVec = new Map<string, number>();
  for (const [term, tf] of queryTF) {
    const idfVal = index.idf.get(term) || 0;
    queryVec.set(term, tf * idfVal);
  }

  // Score each document
  const results: SearchResult[] = [];
  for (let i = 0; i < index.documents.length; i++) {
    const doc = index.documents[i];

    // Apply type filter
    if (typeFilter && !typeFilter.includes(doc.type)) continue;

    const { score, matchedTerms } = cosineSimilarity(queryVec, index.tfidfVectors[i]);

    if (score >= minScore) {
      results.push({ document: doc, score, matchedTerms });
    }
  }

  // Sort by score descending, take top K
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * Format search results for LLM consumption
 */
export function formatResultsForLLM(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No relevant knowledge base entries found.";
  }

  return results
    .map((r, i) => {
      const typeLabel = {
        drug_monograph: "Drug Monograph",
        drug_interaction: "Drug Interaction",
        symptom_triage: "Symptom Triage",
        medical_term: "Medical Term",
      }[r.document.type];

      return `[${i + 1}] ${typeLabel}: ${r.document.title} (relevance: ${(r.score * 100).toFixed(0)}%)\n${r.document.content}`;
    })
    .join("\n\n---\n\n");
}
