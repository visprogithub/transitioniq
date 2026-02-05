/**
 * FDA Drug Interactions Client
 * Uses OpenFDA API for drug safety data and RxNorm for drug interactions
 *
 * Includes in-memory caching to reduce API calls - drug safety data
 * doesn't change frequently (labels updated monthly, interactions are stable)
 */

const OPENFDA_BASE = "https://api.fda.gov/drug";
const RXNORM_BASE = "https://rxnav.nlm.nih.gov/REST";

// Cache TTLs in milliseconds
const CACHE_TTL = {
  RXCUI: 7 * 24 * 60 * 60 * 1000, // 7 days - RxNorm codes are essentially static
  DRUG_LABEL: 24 * 60 * 60 * 1000, // 24 hours - labels change rarely
  INTERACTIONS: 24 * 60 * 60 * 1000, // 24 hours - interactions are stable
  FAERS_COUNT: 24 * 60 * 60 * 1000, // 24 hours - counts grow slowly
  RECALLS: 12 * 60 * 60 * 1000, // 12 hours - more time-sensitive
};

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

// In-memory caches (would use Redis in production)
const rxcuiCache = new Map<string, CacheEntry<string | null>>();
const drugLabelCache = new Map<string, CacheEntry<DrugSafetyInfo | null>>();
const interactionsCache = new Map<string, CacheEntry<DrugInteraction[]>>();
const faersCache = new Map<string, CacheEntry<number>>();
const recallsCache = new Map<string, CacheEntry<DrugRecall[]>>();

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.data;
  }
  if (entry) {
    cache.delete(key); // Expired, remove it
  }
  return undefined;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T, ttl: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttl });
}

// Cache stats for monitoring
export function getFDACacheStats() {
  return {
    rxcui: rxcuiCache.size,
    drugLabel: drugLabelCache.size,
    interactions: interactionsCache.size,
    faers: faersCache.size,
    recalls: recallsCache.size,
  };
}

export function clearFDACache() {
  rxcuiCache.clear();
  drugLabelCache.clear();
  interactionsCache.clear();
  faersCache.clear();
  recallsCache.clear();
}

export interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: "major" | "moderate" | "minor";
  description: string;
  source: string;
  faersCount?: number;
}

export interface DrugSafetyInfo {
  drugName: string;
  warnings: string[];
  adverseReactions: string[];
  contraindications: string[];
  boxedWarning?: string;
}

interface OpenFDAEvent {
  patient?: {
    drug?: Array<{
      medicinalproduct?: string;
      drugindication?: string;
    }>;
    reaction?: Array<{
      reactionmeddrapt?: string;
    }>;
  };
  serious?: number;
}

interface OpenFDAResponse {
  meta?: {
    results?: {
      total?: number;
    };
  };
  results?: OpenFDAEvent[];
}

interface RxNormInteraction {
  interactionPair?: Array<{
    interactionConcept?: Array<{
      sourceConceptItem?: {
        name?: string;
      };
      minConceptItem?: {
        name?: string;
      };
    }>;
    severity?: string;
    description?: string;
  }>;
}

interface RxNormInteractionResponse {
  fullInteractionTypeGroup?: Array<{
    fullInteractionType?: Array<{
      interactionPair?: RxNormInteraction["interactionPair"];
    }>;
    sourceName?: string;
  }>;
}

/**
 * Get RxCUI (RxNorm Concept Unique Identifier) for a drug name
 */
async function getRxCUI(drugName: string): Promise<string | null> {
  const cacheKey = drugName.toLowerCase();
  const cached = getCached(rxcuiCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const url = `${RXNORM_BASE}/rxcui.json?name=${encodeURIComponent(drugName)}&search=2`;
    const response = await fetch(url);
    const data = await response.json();
    const result = data?.idGroup?.rxnormId?.[0] || null;
    setCache(rxcuiCache, cacheKey, result, CACHE_TTL.RXCUI);
    return result;
  } catch (error) {
    console.error(`Failed to get RxCUI for ${drugName}:`, error);
    return null;
  }
}

/**
 * Check drug interactions using RxNorm Interaction API
 */
export async function checkDrugInteractions(
  medications: Array<{ name: string; rxNormCode?: string }>
): Promise<DrugInteraction[]> {
  // Create cache key from sorted drug names (order doesn't matter for interactions)
  const cacheKey = medications
    .map((m) => m.name.toLowerCase())
    .sort()
    .join("|");
  const cached = getCached(interactionsCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const interactions: DrugInteraction[] = [];

  // Get RxCUIs for all medications
  const rxCuis: string[] = [];
  for (const med of medications) {
    if (med.rxNormCode) {
      rxCuis.push(med.rxNormCode);
    } else {
      const rxcui = await getRxCUI(med.name);
      if (rxcui) rxCuis.push(rxcui);
    }
  }

  if (rxCuis.length < 2) {
    return interactions;
  }

  try {
    // Use RxNorm interaction API with multiple drugs
    const rxcuiList = rxCuis.join("+");
    const url = `${RXNORM_BASE}/interaction/list.json?rxcuis=${rxcuiList}`;
    const response = await fetch(url);
    if (!response.ok) {
      return interactions;
    }
    const text = await response.text();
    if (!text || text === "Not found" || !text.startsWith("{")) {
      return interactions; // RxNorm returns plain text "Not found" when no interactions exist
    }
    const data: RxNormInteractionResponse = JSON.parse(text);

    if (data.fullInteractionTypeGroup) {
      for (const group of data.fullInteractionTypeGroup) {
        const source = group.sourceName || "RxNorm";

        if (group.fullInteractionType) {
          for (const interactionType of group.fullInteractionType) {
            if (interactionType.interactionPair) {
              for (const pair of interactionType.interactionPair) {
                if (pair.interactionConcept && pair.interactionConcept.length >= 2) {
                  const drug1 =
                    pair.interactionConcept[0]?.sourceConceptItem?.name ||
                    pair.interactionConcept[0]?.minConceptItem?.name ||
                    "Unknown";
                  const drug2 =
                    pair.interactionConcept[1]?.sourceConceptItem?.name ||
                    pair.interactionConcept[1]?.minConceptItem?.name ||
                    "Unknown";

                  // Map severity from various sources
                  let severity: DrugInteraction["severity"] = "moderate";
                  const severityText = (pair.severity || "").toLowerCase();
                  if (severityText.includes("high") || severityText.includes("major") || severityText.includes("serious")) {
                    severity = "major";
                  } else if (severityText.includes("low") || severityText.includes("minor")) {
                    severity = "minor";
                  }

                  interactions.push({
                    drug1,
                    drug2,
                    severity,
                    description: pair.description || "Potential drug interaction identified",
                    source,
                  });
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    console.error("Drug interaction check failed:", error);
  }

  // NOTE: Removed hardcoded checkKnownHighRiskCombinations() function
  // RxNorm API covers thousands of drug interactions including all common high-risk pairs
  // (Warfarin+Aspirin, Warfarin+Eliquis, ACE+Potassium, Digoxin+Amiodarone, Statin+Fibrate)
  // Relying on API data is more accurate, up-to-date, and evidence-based (with FAERS enrichment)

  setCache(interactionsCache, cacheKey, interactions, CACHE_TTL.INTERACTIONS);
  return interactions;
}

/**
 * Get FDA adverse event reports (FAERS) count for a drug
 */
export async function getFAERSCount(drugName: string): Promise<number> {
  const cacheKey = drugName.toLowerCase();
  const cached = getCached(faersCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const url = `${OPENFDA_BASE}/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(drugName)}"&count=receivedate`;
    const response = await fetch(url);

    if (!response.ok) {
      return 0;
    }

    const data: OpenFDAResponse = await response.json();
    const count = data.meta?.results?.total || 0;
    setCache(faersCache, cacheKey, count, CACHE_TTL.FAERS_COUNT);
    return count;
  } catch (error) {
    console.error(`FAERS lookup failed for ${drugName}:`, error);
    return 0;
  }
}

/**
 * Get drug safety information from FDA labels
 */
export async function getDrugSafetyInfo(drugName: string): Promise<DrugSafetyInfo | null> {
  const cacheKey = drugName.toLowerCase();
  const cached = getCached(drugLabelCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const url = `${OPENFDA_BASE}/label.json?search=openfda.brand_name:"${encodeURIComponent(drugName)}"+openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=1`;
    const response = await fetch(url);

    if (!response.ok) {
      setCache(drugLabelCache, cacheKey, null, CACHE_TTL.DRUG_LABEL);
      return null;
    }

    interface FDALabelResult {
      openfda?: {
        brand_name?: string[];
        generic_name?: string[];
      };
      boxed_warning?: string[];
      warnings?: string[];
      adverse_reactions?: string[];
      contraindications?: string[];
    }

    const data: { results?: FDALabelResult[] } = await response.json();
    const label = data.results?.[0];

    if (!label) {
      setCache(drugLabelCache, cacheKey, null, CACHE_TTL.DRUG_LABEL);
      return null;
    }

    const result: DrugSafetyInfo = {
      drugName: label.openfda?.brand_name?.[0] || label.openfda?.generic_name?.[0] || drugName,
      boxedWarning: label.boxed_warning?.[0],
      warnings: label.warnings || [],
      adverseReactions: label.adverse_reactions || [],
      contraindications: label.contraindications || [],
    };
    setCache(drugLabelCache, cacheKey, result, CACHE_TTL.DRUG_LABEL);
    return result;
  } catch (error) {
    console.error(`FDA label lookup failed for ${drugName}:`, error);
    return null;
  }
}

/**
 * Check if any medications have FDA boxed warnings (Black Box Warnings)
 */
export async function checkBoxedWarnings(
  medications: Array<{ name: string }>
): Promise<Array<{ drug: string; warning: string }>> {
  const warnings: Array<{ drug: string; warning: string }> = [];

  for (const med of medications) {
    const safety = await getDrugSafetyInfo(med.name);
    if (safety?.boxedWarning) {
      warnings.push({
        drug: med.name,
        warning: safety.boxedWarning.substring(0, 500) + (safety.boxedWarning.length > 500 ? "..." : ""),
      });
    }
  }

  return warnings;
}

/**
 * Get drug recalls from OpenFDA
 */
export interface DrugRecall {
  drugName: string;
  recallNumber: string;
  reason: string;
  classification: string; // Class I, II, or III
  status: string;
  recallDate: string;
}

export async function checkDrugRecalls(
  drugName: string
): Promise<DrugRecall[]> {
  const cacheKey = drugName.toLowerCase();
  const cached = getCached(recallsCache, cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const url = `${OPENFDA_BASE}/enforcement.json?search=openfda.brand_name:"${encodeURIComponent(
      drugName
    )}"+openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=5`;
    const response = await fetch(url);

    if (!response.ok) {
      setCache(recallsCache, cacheKey, [], CACHE_TTL.RECALLS);
      return [];
    }

    interface EnforcementResult {
      recall_number?: string;
      reason_for_recall?: string;
      classification?: string;
      status?: string;
      recall_initiation_date?: string;
      openfda?: {
        brand_name?: string[];
        generic_name?: string[];
      };
    }

    const data: { results?: EnforcementResult[] } = await response.json();

    const results = (data.results || []).map((r) => ({
      drugName: r.openfda?.brand_name?.[0] || r.openfda?.generic_name?.[0] || drugName,
      recallNumber: r.recall_number || "Unknown",
      reason: r.reason_for_recall || "Not specified",
      classification: r.classification || "Unknown",
      status: r.status || "Unknown",
      recallDate: r.recall_initiation_date || "Unknown",
    }));
    setCache(recallsCache, cacheKey, results, CACHE_TTL.RECALLS);
    return results;
  } catch (error) {
    console.error(`Drug recall check failed for ${drugName}:`, error);
    return [];
  }
}

/**
 * Get recent adverse events for a drug pair (co-reported)
 */
export async function getCoReportedAdverseEvents(
  drug1: string,
  drug2: string,
  limit = 10
): Promise<Array<{ reactions: string[]; serious: boolean; date: string }>> {
  try {
    const url = `${OPENFDA_BASE}/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(
      drug1
    )}"+AND+patient.drug.medicinalproduct:"${encodeURIComponent(
      drug2
    )}"&limit=${limit}`;
    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const data: OpenFDAResponse = await response.json();

    return (data.results || []).map((event) => ({
      reactions:
        event.patient?.reaction?.map((r) => r.reactionmeddrapt || "Unknown") || [],
      serious: event.serious === 1,
      date: "Recent", // Could parse actual dates if needed
    }));
  } catch (error) {
    console.error(`Co-reported events check failed:`, error);
    return [];
  }
}

/**
 * Get comprehensive drug safety summary
 * Combines multiple OpenFDA endpoints for a complete safety picture
 */
export interface ComprehensiveDrugSafety {
  drugName: string;
  faersReportCount: number;
  hasBoxedWarning: boolean;
  boxedWarningSummary?: string;
  recentRecalls: DrugRecall[];
  topAdverseReactions: string[];
  riskLevel: "high" | "moderate" | "low";
}

export async function getComprehensiveDrugSafety(
  drugName: string
): Promise<ComprehensiveDrugSafety> {
  const [faersCount, safetyInfo, recalls] = await Promise.all([
    getFAERSCount(drugName),
    getDrugSafetyInfo(drugName),
    checkDrugRecalls(drugName),
  ]);

  // Determine risk level based on available data
  let riskLevel: "high" | "moderate" | "low" = "low";

  if (safetyInfo?.boxedWarning || recalls.some((r) => r.classification === "Class I")) {
    riskLevel = "high";
  } else if (
    faersCount > 10000 ||
    recalls.some((r) => r.classification === "Class II")
  ) {
    riskLevel = "moderate";
  }

  return {
    drugName,
    faersReportCount: faersCount,
    hasBoxedWarning: !!safetyInfo?.boxedWarning,
    boxedWarningSummary: safetyInfo?.boxedWarning?.substring(0, 200),
    recentRecalls: recalls.slice(0, 3),
    topAdverseReactions: safetyInfo?.adverseReactions?.slice(0, 5) || [],
    riskLevel,
  };
}

/**
 * Enhanced drug interaction check with FAERS data
 */
export async function checkDrugInteractionsEnhanced(
  medications: Array<{ name: string; rxNormCode?: string }>
): Promise<DrugInteraction[]> {
  // Get basic interactions
  const interactions = await checkDrugInteractions(medications);

  // Enhance high-severity interactions with FAERS counts
  for (const interaction of interactions) {
    if (interaction.severity === "major") {
      try {
        // Get FAERS count for drug pair co-reports
        const coEvents = await getCoReportedAdverseEvents(
          interaction.drug1,
          interaction.drug2,
          1
        );
        if (coEvents.length > 0) {
          // Just mark that we found co-reported events
          interaction.faersCount = coEvents.length;
        }
      } catch {
        // Silently ignore FAERS lookup failures
      }
    }
  }

  return interactions;
}
