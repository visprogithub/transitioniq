/**
 * DailyMed Client - FDA Drug Label Information
 *
 * Uses the NLM DailyMed API to fetch real FDA drug label information
 * including indications, warnings, adverse reactions, and patient counseling.
 *
 * API Documentation: https://dailymed.nlm.nih.gov/dailymed/webservices-help/v2/spls_api.cfm
 */

import { traceError } from "@/lib/integrations/opik";

const DAILYMED_BASE = "https://dailymed.nlm.nih.gov/dailymed/services/v2";

export interface DrugLabelInfo {
  drugName: string;
  brandNames: string[];
  genericName: string;
  purpose: string;
  warnings: string[];
  adverseReactions: string[];
  dosageInstructions: string;
  patientCounseling: string;
  contraindications: string[];
  drugInteractions: string[];
  setId: string;
  source: "FDA_DAILYMED";
}

export interface DailyMedSearchResult {
  setid: string;
  title: string;
  published_date: string;
  labeler_name: string;
}

/**
 * SPL Section LOINC codes for drug labels
 * See: https://www.fda.gov/regulatory-information/structured-product-labeling-resources/spl-loinc-codes
 */
const SPL_SECTIONS = {
  INDICATIONS: "34067-9",
  DOSAGE: "34068-7",
  WARNINGS: "34071-1",
  PRECAUTIONS: "34072-9",
  ADVERSE_REACTIONS: "34084-4",
  DRUG_INTERACTIONS: "34073-7",
  CONTRAINDICATIONS: "34070-3",
  PATIENT_COUNSELING: "34076-0",
  USE_IN_PREGNANCY: "42228-7",
  GERIATRIC_USE: "34082-8",
  OVERDOSAGE: "34088-5",
  CLINICAL_PHARMACOLOGY: "34090-1",
  HOW_SUPPLIED: "34069-5",
  STORAGE: "44425-7",
  DESCRIPTION: "34089-3",
};

/**
 * Search DailyMed for drug labels by name
 */
export async function searchDrugLabels(drugName: string): Promise<DailyMedSearchResult[]> {
  try {
    const url = `${DAILYMED_BASE}/spls.json?drug_name=${encodeURIComponent(drugName)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.data || [];
  } catch (error) {
    traceError("dailymed-search", error, { dataSource: "DailyMed" });
    return [];
  }
}

/**
 * Get full SPL document by setId
 */
async function getSPLDocument(setId: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `${DAILYMED_BASE}/spls/${setId}.json`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    traceError("dailymed-spl-fetch", error, { dataSource: "DailyMed" });
    return null;
  }
}

/**
 * Extract text content from an SPL section
 */
function extractSectionText(spl: Record<string, unknown>, loincCode: string): string {
  try {
    // Navigate the SPL structure to find the section
    const data = spl.data as Record<string, unknown> | undefined;
    if (!data) return "";

    // SPL structure varies, try multiple paths
    const sections = (data.sections as Array<Record<string, unknown>>) || [];

    for (const section of sections) {
      if (section.code === loincCode || section.loinc_code === loincCode) {
        // Get text content, handling nested HTML/text
        const text = section.text as string || section.title as string || "";
        // Strip HTML tags and clean up whitespace
        return cleanHtml(text);
      }
    }

    return "";
  } catch (error) {
    traceError("dailymed-section-extract", error, { dataSource: "DailyMed" });
    return "";
  }
}

/**
 * Clean HTML content to plain text
 */
function cleanHtml(html: string): string {
  if (!html) return "";

  return html
    // Remove HTML tags
    .replace(/<[^>]*>/g, " ")
    // Decode common HTML entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Clean up whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split text into bullet points
 */
function textToBullets(text: string): string[] {
  if (!text) return [];

  // Split on common separators
  const bullets = text
    .split(/[.;•]\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10 && s.length < 500); // Filter out too short/long

  // Return first 5 most relevant items
  return bullets.slice(0, 5);
}

/**
 * Simplify medical language for patient understanding
 */
function simplifyForPatient(text: string): string {
  if (!text) return "";

  // Common medical term replacements for patient-friendly language
  const replacements: [RegExp, string][] = [
    [/\badverse reaction[s]?\b/gi, "side effect"],
    [/\bhypotension\b/gi, "low blood pressure"],
    [/\bhypertension\b/gi, "high blood pressure"],
    [/\bdyspnea\b/gi, "shortness of breath"],
    [/\bedema\b/gi, "swelling"],
    [/\bnausea\b/gi, "feeling sick to your stomach"],
    [/\bdizziness\b/gi, "feeling lightheaded or unsteady"],
    [/\bfatigue\b/gi, "tiredness"],
    [/\bcephalgia\b/gi, "headache"],
    [/\bmyalgia\b/gi, "muscle pain"],
    [/\barthralgia\b/gi, "joint pain"],
    [/\bpruritus\b/gi, "itching"],
    [/\burticaria\b/gi, "hives"],
    [/\bdyspepsia\b/gi, "upset stomach"],
    [/\bsomnolence\b/gi, "drowsiness"],
    [/\binsomnia\b/gi, "trouble sleeping"],
    [/\bcontracted\b/gi, "narrowed"],
    [/\bdilated\b/gi, "widened"],
    [/\bparenteral\b/gi, "by injection"],
    [/\boral administration\b/gi, "by mouth"],
    [/\bcontraindicated\b/gi, "should not be used"],
    [/\bpotentiates?\b/gi, "increases the effect of"],
    [/\binhibits?\b/gi, "reduces the effect of"],
  ];

  let simplified = text;
  for (const [pattern, replacement] of replacements) {
    simplified = simplified.replace(pattern, replacement);
  }

  return simplified;
}

/**
 * Get comprehensive drug label information
 */
export async function getDrugLabel(drugName: string): Promise<DrugLabelInfo | null> {
  try {
    // 1. Search for the drug
    const searchResults = await searchDrugLabels(drugName);

    if (searchResults.length === 0) {
      console.log(`[DailyMed] No results for: ${drugName}`);
      return null;
    }

    // 2. Get the first (most relevant) result's full SPL
    const topResult = searchResults[0];
    const spl = await getSPLDocument(topResult.setid);

    if (!spl) {
      console.log(`[DailyMed] Could not fetch SPL for: ${drugName}`);
      return null;
    }

    // 3. Extract relevant sections
    const indicationsText = extractSectionText(spl, SPL_SECTIONS.INDICATIONS);
    const warningsText = extractSectionText(spl, SPL_SECTIONS.WARNINGS);
    const adverseText = extractSectionText(spl, SPL_SECTIONS.ADVERSE_REACTIONS);
    const dosageText = extractSectionText(spl, SPL_SECTIONS.DOSAGE);
    const counselingText = extractSectionText(spl, SPL_SECTIONS.PATIENT_COUNSELING);
    const contraindicationsText = extractSectionText(spl, SPL_SECTIONS.CONTRAINDICATIONS);
    const interactionsText = extractSectionText(spl, SPL_SECTIONS.DRUG_INTERACTIONS);

    // 4. Build patient-friendly result
    return {
      drugName,
      brandNames: [topResult.title.split(" ")[0]], // First word is usually brand name
      genericName: drugName.toLowerCase(),
      purpose: simplifyForPatient(indicationsText) || `This medication is used to treat your condition as prescribed by your doctor.`,
      warnings: textToBullets(simplifyForPatient(warningsText)).map((w) => `⚠️ ${w}`),
      adverseReactions: textToBullets(simplifyForPatient(adverseText)),
      dosageInstructions: simplifyForPatient(dosageText) || "Take as directed by your doctor.",
      patientCounseling: simplifyForPatient(counselingText) || "Follow your doctor's instructions and report any unusual symptoms.",
      contraindications: textToBullets(simplifyForPatient(contraindicationsText)),
      drugInteractions: textToBullets(simplifyForPatient(interactionsText)),
      setId: topResult.setid,
      source: "FDA_DAILYMED",
    };
  } catch (error) {
    traceError("dailymed-get-label", error, { dataSource: "DailyMed" });
    return null;
  }
}

/**
 * Get patient-friendly medication information
 * Returns simplified version suitable for patient education
 */
export async function getPatientFriendlyDrugInfo(drugName: string): Promise<{
  purpose: string;
  sideEffects: string[];
  warnings: string[];
  patientTips: string[];
  source: string;
} | null> {
  const label = await getDrugLabel(drugName);

  if (!label) {
    return null;
  }

  return {
    purpose: label.purpose,
    sideEffects: label.adverseReactions.length > 0
      ? label.adverseReactions
      : ["Ask your pharmacist about potential side effects"],
    warnings: label.warnings.length > 0
      ? label.warnings
      : ["⚠️ Take exactly as prescribed", "⚠️ Don't stop taking without talking to your doctor first"],
    patientTips: [
      label.dosageInstructions || "Take as directed",
      label.patientCounseling || "Follow your doctor's instructions",
      "Keep a list of all your medications to show your doctors",
    ].filter(Boolean),
    source: "FDA_DAILYMED",
  };
}
