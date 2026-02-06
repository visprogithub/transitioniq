/**
 * FDA Drug Interactions Client
 * Uses OpenFDA Drug Label API for drug safety and interaction data
 *
 * The drug_interactions field in FDA labels contains comprehensive interaction
 * data from official prescribing information, which is more reliable than
 * third-party interaction databases.
 *
 * Includes in-memory caching to reduce API calls - drug safety data
 * doesn't change frequently (labels updated monthly, interactions are stable)
 */

const OPENFDA_BASE = "https://api.fda.gov/drug";

/**
 * Get OpenFDA API key query parameter if available
 * Without key: 240 req/min, 1,000/day
 * With free key: 240 req/min, 120,000/day
 */
function getApiKeyParam(): string {
  const apiKey = process.env.OPENFDA_API_KEY;
  return apiKey ? `&api_key=${apiKey}` : "";
}

// Cache TTLs in milliseconds
const CACHE_TTL = {
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
    drugLabel: drugLabelCache.size,
    interactions: interactionsCache.size,
    faers: faersCache.size,
    recalls: recallsCache.size,
  };
}

export function clearFDACache() {
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

// Note: RxNorm interaction API was removed in favor of FDA Drug Label API
// which provides more reliable drug interaction data from official FDA sources

/**
 * Check drug interactions using FDA Drug Label API
 * The drug_interactions field in FDA labels contains comprehensive interaction data
 * much more reliable than the RxNorm interaction API
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
  const medNames = medications.map((m) => extractGenericName(m.name).toLowerCase());

  console.log(`[FDA] Checking interactions for ${medications.length} medications:`, medNames);

  // Fetch FDA drug labels for each medication to check their interaction sections
  const interactionPromises = medications.map(async (med) => {
    const genericName = extractGenericName(med.name);
    console.log(`[FDA] Fetching label for ${genericName} to check against:`, medNames.filter(m => m !== genericName.toLowerCase()));
    return fetchFDADrugInteractions(genericName, medNames);
  });

  try {
    const results = await Promise.all(interactionPromises);
    console.log(`[FDA] Got ${results.length} label results`);
    for (const result of results) {
      console.log(`[FDA] Processing ${result.length} interactions from one label`);
      for (const interaction of result) {
        // Avoid duplicates (same pair may be found from both drug labels)
        const exists = interactions.some(
          (i) =>
            (i.drug1.toLowerCase() === interaction.drug1.toLowerCase() &&
              i.drug2.toLowerCase() === interaction.drug2.toLowerCase()) ||
            (i.drug1.toLowerCase() === interaction.drug2.toLowerCase() &&
              i.drug2.toLowerCase() === interaction.drug1.toLowerCase())
        );
        if (!exists) {
          interactions.push(interaction);
        }
      }
    }
  } catch (error) {
    console.error("FDA drug interaction check failed:", error);
  }

  // Fallback to known high-risk combinations if API didn't find anything
  // These are clinically critical interactions that should never be missed
  if (interactions.length === 0) {
    const knownInteractions = checkKnownHighRiskCombinations(medications);
    interactions.push(...knownInteractions);
  } else {
    // Even if we found some, check for any missed critical ones
    const knownInteractions = checkKnownHighRiskCombinations(medications);
    for (const known of knownInteractions) {
      const exists = interactions.some(
        (i) =>
          (i.drug1.toLowerCase().includes(known.drug1.toLowerCase()) &&
            i.drug2.toLowerCase().includes(known.drug2.toLowerCase())) ||
          (i.drug1.toLowerCase().includes(known.drug2.toLowerCase()) &&
            i.drug2.toLowerCase().includes(known.drug1.toLowerCase()))
      );
      if (!exists) {
        interactions.push(known);
      }
    }
  }

  console.log(`[FDA] Total interactions found: ${interactions.length}`);
  interactions.forEach((i) => console.log(`[FDA]   - ${i.drug1} + ${i.drug2}: ${i.severity}`));

  setCache(interactionsCache, cacheKey, interactions, CACHE_TTL.INTERACTIONS);
  return interactions;
}

/**
 * Extract generic name from a medication name that might include strength/form
 * e.g. "Warfarin 5mg" -> "Warfarin", "Lisinopril 10 mg Oral Tablet" -> "Lisinopril"
 */
function extractGenericName(medName: string): string {
  // Remove common suffixes like dosage, form, etc.
  return medName
    .replace(/\s*\d+(\.\d+)?\s*(mg|mcg|ml|g|%|units?|iu)\b.*/i, "")
    .replace(/\s*(oral|tablet|capsule|injection|solution|suspension|cream|gel|patch|inhaler|spray).*/i, "")
    .trim();
}

/**
 * Fetch FDA drug label and parse the drug_interactions field to find interactions
 * with other medications in the patient's list
 */
async function fetchFDADrugInteractions(
  drugName: string,
  allMedNames: string[]
): Promise<DrugInteraction[]> {
  const interactions: DrugInteraction[] = [];

  try {
    // Search by generic name in FDA label database
    const url = `${OPENFDA_BASE}/label.json?search=openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=1${getApiKeyParam()}`;
    const response = await fetch(url);

    if (!response.ok) {
      // Try brand name if generic fails
      const brandUrl = `${OPENFDA_BASE}/label.json?search=openfda.brand_name:"${encodeURIComponent(drugName)}"&limit=1${getApiKeyParam()}`;
      const brandResponse = await fetch(brandUrl);
      if (!brandResponse.ok) {
        return interactions;
      }
      const brandData = await brandResponse.json();
      return parseFDAInteractions(drugName, brandData, allMedNames);
    }

    const data = await response.json();
    return parseFDAInteractions(drugName, data, allMedNames);
  } catch (error) {
    console.error(`FDA label lookup failed for ${drugName}:`, error);
    return interactions;
  }
}

interface FDALabelInteractionResult {
  drug_interactions?: string[];
  drug_interactions_table?: string[];
  openfda?: {
    generic_name?: string[];
    brand_name?: string[];
  };
}

/**
 * Parse the drug_interactions field from FDA label data
 * to find interactions with medications in the patient's list
 */
function parseFDAInteractions(
  sourceDrug: string,
  data: { results?: FDALabelInteractionResult[] },
  allMedNames: string[]
): DrugInteraction[] {
  const interactions: DrugInteraction[] = [];
  const label = data.results?.[0];

  if (!label?.drug_interactions?.length) {
    return interactions;
  }

  const interactionText = label.drug_interactions.join(" ").toLowerCase();
  const drugNameFromLabel = label.openfda?.generic_name?.[0] || sourceDrug;

  // Drug classes and their member medications to check
  const drugClasses: Record<string, string[]> = {
    anticoagulants: ["warfarin", "heparin", "enoxaparin", "dabigatran", "rivaroxaban", "apixaban", "edoxaban", "eliquis", "xarelto", "pradaxa"],
    antiplatelet: ["aspirin", "clopidogrel", "plavix", "prasugrel", "ticagrelor", "dipyridamole", "cilostazol"],
    nsaids: ["ibuprofen", "naproxen", "celecoxib", "diclofenac", "meloxicam", "indomethacin", "ketorolac", "piroxicam", "advil", "motrin", "aleve"],
    ace_inhibitors: ["lisinopril", "enalapril", "ramipril", "captopril", "benazepril", "fosinopril", "quinapril"],
    arbs: ["losartan", "valsartan", "irbesartan", "candesartan", "olmesartan", "telmisartan"],
    diuretics: ["furosemide", "lasix", "hydrochlorothiazide", "hctz", "spironolactone", "bumetanide", "torsemide", "metolazone"],
    potassium: ["potassium", "k-dur", "klor-con"],
    digoxin: ["digoxin", "lanoxin"],
    statins: ["atorvastatin", "simvastatin", "rosuvastatin", "pravastatin", "lovastatin", "lipitor", "crestor", "zocor"],
    ssris: ["fluoxetine", "sertraline", "paroxetine", "citalopram", "escitalopram", "prozac", "zoloft", "paxil", "lexapro"],
    antibiotics: ["amoxicillin", "azithromycin", "ciprofloxacin", "metronidazole", "trimethoprim", "sulfamethoxazole", "bactrim"],
    antifungals: ["fluconazole", "itraconazole", "ketoconazole", "voriconazole"],
    ppi: ["omeprazole", "pantoprazole", "esomeprazole", "lansoprazole", "prilosec", "nexium", "protonix"],
    diabetes: ["metformin", "glipizide", "glyburide", "glimepiride", "insulin", "sitagliptin", "januvia"],
    thyroid: ["levothyroxine", "synthroid", "liothyronine"],
    beta_blockers: ["metoprolol", "atenolol", "carvedilol", "propranolol", "bisoprolol", "lopressor", "toprol"],
    calcium_blockers: ["amlodipine", "diltiazem", "verapamil", "nifedipine", "norvasc"],
    opioids: ["morphine", "oxycodone", "hydrocodone", "fentanyl", "tramadol", "codeine"],
    benzodiazepines: ["lorazepam", "diazepam", "alprazolam", "clonazepam", "ativan", "valium", "xanax"],
    antidepressants: ["amitriptyline", "nortriptyline", "trazodone", "bupropion", "venlafaxine", "duloxetine", "wellbutrin", "effexor", "cymbalta"],
    antipsychotics: ["quetiapine", "risperidone", "olanzapine", "aripiprazole", "haloperidol", "seroquel", "risperdal", "zyprexa"],
  };

  // Check interaction text for mentions of other patient medications
  for (const otherMed of allMedNames) {
    if (otherMed.toLowerCase() === sourceDrug.toLowerCase()) continue;

    const otherGeneric = extractGenericName(otherMed).toLowerCase();

    // Direct mention check
    if (interactionText.includes(otherGeneric)) {
      const severity = determineSeverityFromText(interactionText, otherGeneric);
      const description = extractInteractionDescription(interactionText, otherGeneric, drugNameFromLabel);

      interactions.push({
        drug1: drugNameFromLabel,
        drug2: otherMed,
        severity,
        description,
        source: "FDA Drug Label",
      });
      continue;
    }

    // Check if patient medication belongs to a drug class mentioned in interaction text
    for (const [className, members] of Object.entries(drugClasses)) {
      if (members.some((m) => otherGeneric.includes(m) || m.includes(otherGeneric))) {
        // Check if this drug class is mentioned in the interaction text
        const classKeywords = getClassKeywords(className);
        if (classKeywords.some((kw) => interactionText.includes(kw))) {
          const severity = determineSeverityFromText(interactionText, classKeywords[0]);
          interactions.push({
            drug1: drugNameFromLabel,
            drug2: otherMed,
            severity,
            description: `${capitalize(className.replace("_", " "))} may interact with ${drugNameFromLabel}. Monitor closely.`,
            source: "FDA Drug Label",
          });
          break;
        }
      }
    }
  }

  return interactions;
}

/**
 * Get keywords for searching drug class interactions
 */
function getClassKeywords(className: string): string[] {
  const keywordMap: Record<string, string[]> = {
    anticoagulants: ["anticoagulant", "blood thinner", "bleeding risk", "warfarin"],
    antiplatelet: ["antiplatelet", "aspirin", "bleeding risk", "platelet"],
    nsaids: ["nsaid", "non-steroidal", "anti-inflammatory", "ibuprofen", "naproxen"],
    ace_inhibitors: ["ace inhibitor", "angiotensin-converting enzyme", "hyperkalemia"],
    arbs: ["angiotensin receptor blocker", "arb", "hyperkalemia"],
    diuretics: ["diuretic", "loop diuretic", "thiazide", "hypokalemia", "electrolyte"],
    potassium: ["potassium", "hyperkalemia"],
    digoxin: ["digoxin", "digitalis", "cardiac glycoside"],
    statins: ["statin", "hmg-coa", "myopathy", "rhabdomyolysis"],
    ssris: ["ssri", "serotonin reuptake inhibitor", "serotonin syndrome", "bleeding"],
    antibiotics: ["antibiotic", "antibacterial"],
    antifungals: ["antifungal", "azole", "cyp3a4"],
    ppi: ["proton pump inhibitor", "ppi", "gastric acid"],
    diabetes: ["hypoglycemi", "antidiabetic", "blood glucose", "insulin"],
    thyroid: ["thyroid", "levothyroxine", "absorption"],
    beta_blockers: ["beta-blocker", "beta blocker", "bradycardia", "hypotension"],
    calcium_blockers: ["calcium channel blocker", "calcium blocker", "hypotension"],
    opioids: ["opioid", "narcotic", "respiratory depression", "cns depression"],
    benzodiazepines: ["benzodiazepine", "cns depression", "sedation"],
    antidepressants: ["antidepressant", "serotonin", "tricyclic", "maoi"],
    antipsychotics: ["antipsychotic", "neuroleptic", "qt prolongation"],
  };
  return keywordMap[className] || [className.replace("_", " ")];
}

/**
 * Determine interaction severity based on context in the text
 */
function determineSeverityFromText(text: string, drugKeyword: string): DrugInteraction["severity"] {
  // Find the section around this drug mention (up to 500 chars before and after)
  const idx = text.indexOf(drugKeyword.toLowerCase());
  const start = Math.max(0, idx - 500);
  const end = Math.min(text.length, idx + 500);
  const context = text.slice(start, end).toLowerCase();

  // Major severity indicators
  if (
    context.includes("contraindicated") ||
    context.includes("avoid") ||
    context.includes("do not use") ||
    context.includes("serious") ||
    context.includes("fatal") ||
    context.includes("life-threatening") ||
    context.includes("major") ||
    context.includes("significantly increase") ||
    context.includes("bleeding risk")
  ) {
    return "major";
  }

  // Minor severity indicators
  if (
    context.includes("minor") ||
    context.includes("minimal") ||
    context.includes("unlikely") ||
    context.includes("negligible")
  ) {
    return "minor";
  }

  // Default to moderate
  return "moderate";
}

/**
 * Extract a description of the interaction from the text
 */
function extractInteractionDescription(text: string, drugKeyword: string, sourceDrug: string): string {
  const idx = text.indexOf(drugKeyword.toLowerCase());
  if (idx === -1) return `Potential interaction with ${sourceDrug}. Monitor closely.`;

  // Find the sentence containing this drug
  const start = Math.max(0, text.lastIndexOf(".", idx - 1) + 1);
  const end = text.indexOf(".", idx);
  const endIdx = end === -1 ? Math.min(text.length, idx + 200) : Math.min(end + 1, idx + 300);

  let sentence = text.slice(start, endIdx).trim();

  // Clean up and capitalize
  sentence = sentence.replace(/\s+/g, " ");
  if (sentence.length > 200) {
    sentence = sentence.slice(0, 197) + "...";
  }

  return capitalize(sentence) || `Potential interaction between ${sourceDrug} and ${drugKeyword}. Monitor closely.`;
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Check for known high-risk drug combinations
 * These are critical interactions that should always be flagged
 */
function checkKnownHighRiskCombinations(
  medications: Array<{ name: string }>
): DrugInteraction[] {
  const interactions: DrugInteraction[] = [];
  const medNames = medications.map((m) => m.name.toLowerCase());

  // Warfarin + Aspirin (bleeding risk)
  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("aspirin"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Aspirin",
      severity: "major",
      description: "Concurrent use significantly increases bleeding risk. Monitor INR closely and watch for signs of bleeding.",
      source: "Clinical Guidelines",
    });
  }

  // Warfarin + Eliquis/Apixaban (dual anticoagulation)
  if (medNames.some((m) => m.includes("warfarin")) &&
      medNames.some((m) => m.includes("eliquis") || m.includes("apixaban"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Eliquis (Apixaban)",
      severity: "major",
      description: "Dual anticoagulation therapy significantly increases bleeding risk. Generally contraindicated.",
      source: "Clinical Guidelines",
    });
  }

  // Warfarin + Acetaminophen (INR elevation)
  if (medNames.some((m) => m.includes("warfarin")) &&
      medNames.some((m) => m.includes("acetaminophen") || m.includes("tylenol"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Acetaminophen",
      severity: "moderate",
      description: "Regular acetaminophen use can elevate INR. Monitor INR if using more than 2g/day for several days.",
      source: "Clinical Guidelines",
    });
  }

  // ACE inhibitor + Potassium (hyperkalemia)
  if ((medNames.some((m) => m.includes("lisinopril") || m.includes("enalapril") || m.includes("ramipril"))) &&
      medNames.some((m) => m.includes("potassium"))) {
    interactions.push({
      drug1: "ACE Inhibitor",
      drug2: "Potassium",
      severity: "moderate",
      description: "ACE inhibitors can increase potassium levels. Combined with supplements, risk of hyperkalemia increases.",
      source: "Clinical Guidelines",
    });
  }

  // Digoxin + Furosemide (hypokalemia increases digoxin toxicity)
  if (medNames.some((m) => m.includes("digoxin")) && medNames.some((m) => m.includes("furosemide") || m.includes("lasix"))) {
    interactions.push({
      drug1: "Digoxin",
      drug2: "Furosemide",
      severity: "moderate",
      description: "Loop diuretics can cause hypokalemia, increasing digoxin toxicity risk. Monitor potassium levels.",
      source: "Clinical Guidelines",
    });
  }

  // Digoxin + Amiodarone (increased digoxin levels)
  if (medNames.some((m) => m.includes("digoxin")) && medNames.some((m) => m.includes("amiodarone"))) {
    interactions.push({
      drug1: "Digoxin",
      drug2: "Amiodarone",
      severity: "major",
      description: "Amiodarone increases digoxin levels by 70-100%. Reduce digoxin dose by 50% when starting amiodarone.",
      source: "Clinical Guidelines",
    });
  }

  // Metformin + Contrast dye consideration (not a drug-drug but important)
  // Statin + Fibrate (rhabdomyolysis risk)
  if (medNames.some((m) => m.includes("atorvastatin") || m.includes("simvastatin") || m.includes("rosuvastatin")) &&
      medNames.some((m) => m.includes("gemfibrozil") || m.includes("fenofibrate"))) {
    interactions.push({
      drug1: "Statin",
      drug2: "Fibrate",
      severity: "major",
      description: "Increased risk of myopathy and rhabdomyolysis. Monitor for muscle pain, weakness, or dark urine.",
      source: "Clinical Guidelines",
    });
  }

  // NSAIDs + Anticoagulants (bleeding risk)
  if (medNames.some((m) => m.includes("ibuprofen") || m.includes("naproxen") || m.includes("meloxicam")) &&
      medNames.some((m) => m.includes("warfarin") || m.includes("eliquis") || m.includes("xarelto"))) {
    interactions.push({
      drug1: "NSAID",
      drug2: "Anticoagulant",
      severity: "major",
      description: "NSAIDs increase bleeding risk with anticoagulants. Avoid combination or use with extreme caution.",
      source: "Clinical Guidelines",
    });
  }

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
    const url = `${OPENFDA_BASE}/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(drugName)}"&count=receivedate${getApiKeyParam()}`;
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
    const url = `${OPENFDA_BASE}/label.json?search=openfda.brand_name:"${encodeURIComponent(drugName)}"+openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=1${getApiKeyParam()}`;
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
    )}"+openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=5${getApiKeyParam()}`;
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
    )}"&limit=${limit}${getApiKeyParam()}`;
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
