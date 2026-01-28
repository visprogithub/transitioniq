/**
 * MedlinePlus Client - Health Topic Information
 *
 * Uses the NLM MedlinePlus Connect API to fetch health topic information
 * for symptoms, conditions, and medical concepts.
 *
 * API Documentation: https://medlineplus.gov/about/developers/webservices/
 */

const MEDLINEPLUS_BASE = "https://connect.medlineplus.gov/service";

export interface HealthTopicInfo {
  title: string;
  summary: string;
  fullSummary: string;
  url: string;
  lastUpdated: string;
  relatedTopics: string[];
  source: "MEDLINEPLUS";
}

export interface SymptomInfo {
  symptom: string;
  title: string;
  summary: string;
  whenToSeekCare: string[];
  homeRemedies: string[];
  relatedConditions: string[];
  links: string[];
  source: "MEDLINEPLUS";
}

/**
 * Search MedlinePlus for health topics
 */
export async function searchHealthTopics(query: string): Promise<HealthTopicInfo[]> {
  try {
    // MedlinePlus Connect v1 API
    const params = new URLSearchParams({
      "mainSearchCriteria.v.cs": "2.16.840.1.113883.6.177", // MedlinePlus Topic ID system
      "mainSearchCriteria.v.dn": query,
      "informationRecipient.languageCode.c": "en",
      "knowledgeResponseType": "application/json",
    });

    const url = `${MEDLINEPLUS_BASE}?${params}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      console.error(`[MedlinePlus] Search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();

    // Parse the feed structure
    const entries = data.feed?.entry || [];
    return entries.map((entry: Record<string, unknown>) => ({
      title: extractValue(entry, "title"),
      summary: extractValue(entry, "summary"),
      fullSummary: extractValue(entry, "content"),
      url: extractLink(entry),
      lastUpdated: extractValue(entry, "updated"),
      relatedTopics: [],
      source: "MEDLINEPLUS" as const,
    }));
  } catch (error) {
    console.error("[MedlinePlus] Search error:", error);
    return [];
  }
}

/**
 * Extract value from MedlinePlus entry structure
 */
function extractValue(entry: Record<string, unknown>, field: string): string {
  const fieldData = entry[field] as Record<string, unknown> | string | undefined;
  if (!fieldData) return "";
  if (typeof fieldData === "string") return fieldData;
  return (fieldData._value as string) || (fieldData["#text"] as string) || "";
}

/**
 * Extract link from MedlinePlus entry
 */
function extractLink(entry: Record<string, unknown>): string {
  const links = entry.link as Array<Record<string, unknown>> | Record<string, unknown> | undefined;
  if (!links) return "";
  if (Array.isArray(links)) {
    const link = links.find((l) => l.rel === "alternate" || !l.rel);
    return (link?.href as string) || "";
  }
  return (links.href as string) || "";
}

/**
 * Get symptom-specific information with urgency guidance
 */
export async function getSymptomInfo(symptom: string): Promise<SymptomInfo | null> {
  try {
    const topics = await searchHealthTopics(symptom);

    if (topics.length === 0) {
      // Try alternative search terms
      const alternatives = getAlternativeTerms(symptom);
      for (const alt of alternatives) {
        const altTopics = await searchHealthTopics(alt);
        if (altTopics.length > 0) {
          topics.push(...altTopics);
          break;
        }
      }
    }

    if (topics.length === 0) {
      console.log(`[MedlinePlus] No results for symptom: ${symptom}`);
      return null;
    }

    const topic = topics[0];

    // Extract urgency information from summary
    const whenToSeekCare = extractUrgencyInfo(topic.summary, topic.fullSummary);
    const homeRemedies = extractHomeRemedies(topic.summary, topic.fullSummary);

    return {
      symptom,
      title: topic.title,
      summary: simplifyText(topic.summary),
      whenToSeekCare,
      homeRemedies,
      relatedConditions: topic.relatedTopics,
      links: topic.url ? [topic.url] : [],
      source: "MEDLINEPLUS",
    };
  } catch (error) {
    console.error("[MedlinePlus] getSymptomInfo error:", error);
    return null;
  }
}

/**
 * Get alternative search terms for common symptoms
 */
function getAlternativeTerms(symptom: string): string[] {
  const alternatives: Record<string, string[]> = {
    dizzy: ["dizziness", "vertigo", "lightheaded"],
    dizziness: ["dizzy", "vertigo", "balance problems"],
    chest_pain: ["chest pain", "angina", "heart pain"],
    "chest pain": ["angina", "chest discomfort"],
    headache: ["head pain", "migraine", "tension headache"],
    nausea: ["nauseous", "sick stomach", "vomiting"],
    tired: ["fatigue", "tiredness", "exhaustion"],
    fatigue: ["tired", "exhaustion", "weakness"],
    "short of breath": ["shortness of breath", "dyspnea", "breathing problems"],
    swelling: ["edema", "swollen", "fluid retention"],
    bleeding: ["blood", "hemorrhage"],
    fever: ["high temperature", "febrile"],
    confusion: ["confused", "disorientation", "mental confusion"],
  };

  const normalized = symptom.toLowerCase().trim();
  return alternatives[normalized] || [];
}

/**
 * Extract urgency/when-to-seek-care information from text
 */
function extractUrgencyInfo(summary: string, fullText: string): string[] {
  const combined = `${summary} ${fullText}`.toLowerCase();
  const urgencyPhrases: string[] = [];

  // Look for emergency keywords
  if (
    combined.includes("911") ||
    combined.includes("emergency") ||
    combined.includes("immediately")
  ) {
    urgencyPhrases.push("🚨 Call 911 if symptoms are severe or you feel like something is seriously wrong");
  }

  // Look for "call your doctor" type phrases
  if (
    combined.includes("call your doctor") ||
    combined.includes("see your doctor") ||
    combined.includes("seek medical")
  ) {
    urgencyPhrases.push("📞 Call your doctor if symptoms persist or worsen");
  }

  // Look for warning signs
  const warningPatterns = [
    /if you (?:experience|have|notice) (.+?)(?:\.|,|;)/gi,
    /seek (?:immediate |medical )?(?:care|help|attention) (?:if|when) (.+?)(?:\.|,|;)/gi,
    /call (?:your doctor|911|emergency) (?:if|when) (.+?)(?:\.|,|;)/gi,
  ];

  for (const pattern of warningPatterns) {
    const matches = combined.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length < 100) {
        urgencyPhrases.push(`⚠️ ${capitalizeFirst(match[1].trim())}`);
      }
    }
  }

  // Default guidance if nothing specific found
  if (urgencyPhrases.length === 0) {
    urgencyPhrases.push("📞 Contact your doctor if symptoms persist or concern you");
    urgencyPhrases.push("🚨 Seek emergency care if symptoms are severe");
  }

  return urgencyPhrases.slice(0, 4); // Return max 4 items
}

/**
 * Extract home remedy/self-care information from text
 */
function extractHomeRemedies(summary: string, fullText: string): string[] {
  const combined = `${summary} ${fullText}`.toLowerCase();
  const remedies: string[] = [];

  // Look for self-care patterns
  const selfCarePatterns = [
    /you can (?:try|use) (.+?)(?:\.|,|;)/gi,
    /try (.+?) (?:to help|for relief)/gi,
    /rest (.+?)(?:\.|,|;)/gi,
    /drink (.+?)(?:\.|,|;)/gi,
  ];

  for (const pattern of selfCarePatterns) {
    const matches = combined.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length < 80 && match[1].length > 5) {
        remedies.push(capitalizeFirst(match[1].trim()));
      }
    }
  }

  // Add common appropriate self-care if nothing specific found
  if (remedies.length === 0) {
    remedies.push("Rest when you feel tired");
    remedies.push("Stay hydrated by drinking water");
    remedies.push("Track your symptoms to report to your doctor");
  }

  return remedies.slice(0, 4);
}

/**
 * Simplify text for patient understanding
 */
function simplifyText(text: string): string {
  if (!text) return "";

  // Clean HTML if present
  let clean = text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

  // Limit length
  if (clean.length > 300) {
    clean = clean.slice(0, 297) + "...";
  }

  return clean;
}

/**
 * Capitalize first letter
 */
function capitalizeFirst(text: string): string {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Get patient-friendly symptom assessment
 * Combines MedlinePlus info with urgency guidance
 */
export async function getPatientSymptomAssessment(
  symptom: string,
  severity: "mild" | "moderate" | "severe" = "moderate"
): Promise<{
  message: string;
  urgencyLevel: "emergency" | "call_doctor_today" | "call_doctor_soon" | "monitor";
  actions: string[];
  medicalInfo?: string;
  source: string;
} | null> {
  const info = await getSymptomInfo(symptom);

  // Determine urgency based on symptom type and severity
  let urgencyLevel: "emergency" | "call_doctor_today" | "call_doctor_soon" | "monitor" = "monitor";

  // Emergency symptoms (always urgent regardless of stated severity)
  const emergencySymptoms = [
    "chest pain",
    "difficulty breathing",
    "shortness of breath",
    "severe bleeding",
    "stroke",
    "heart attack",
    "seizure",
    "unconscious",
    "severe allergic",
  ];

  const normalizedSymptom = symptom.toLowerCase();
  const isEmergency = emergencySymptoms.some((e) => normalizedSymptom.includes(e));

  if (isEmergency || severity === "severe") {
    urgencyLevel = "emergency";
  } else if (severity === "moderate") {
    urgencyLevel = "call_doctor_today";
  } else {
    urgencyLevel = "monitor";
  }

  // Build response
  const actions: string[] = [];

  if (urgencyLevel === "emergency") {
    actions.push("🚨 Call 911 or go to the emergency room immediately");
    actions.push("Don't drive yourself - have someone take you or call an ambulance");
  } else if (urgencyLevel === "call_doctor_today") {
    actions.push("📞 Call your doctor's office today");
    if (info) {
      actions.push(...info.whenToSeekCare.slice(0, 2));
    }
  } else {
    if (info) {
      actions.push(...info.homeRemedies.slice(0, 2));
    }
    actions.push("📞 Call your doctor if symptoms persist or worsen");
  }

  return {
    message: info?.summary || `${capitalizeFirst(symptom)} can have various causes. Here's guidance based on your situation.`,
    urgencyLevel,
    actions: actions.slice(0, 4),
    medicalInfo: info?.summary,
    source: info ? "MEDLINEPLUS" : "GUIDELINES",
  };
}
