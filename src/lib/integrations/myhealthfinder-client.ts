/**
 * MyHealthfinder API Client
 *
 * Integrates with the ODPHP MyHealthfinder API v4 to fetch
 * USPSTF-based preventive care recommendations by age and sex.
 *
 * API: https://odphp.health.gov/myhealthfinder/api/v4/
 * Free, no API key required. Returns consumer-friendly preventive
 * service recommendations based on USPSTF guidelines.
 *
 * Used alongside rule-based guidelines-client.ts to identify
 * preventive care gaps from an evidence-based external source.
 */

import type { Patient } from "../types/patient";
import { traceError } from "@/lib/integrations/opik";
import type { CareGap } from "./guidelines-client";

const BASE_URL = "https://odphp.health.gov/myhealthfinder/api/v4";

// ---------------------------------------------------------------------------
// API types
// ---------------------------------------------------------------------------

interface MyHealthfinderResponse {
  Result: {
    Error: string;
    Total: number;
    Query: Record<string, string>;
    Language: string;
    Resources?: {
      Resource?: MyHealthfinderTopic[];
    };
  };
}

interface MyHealthfinderTopic {
  Type: string;
  Id: string;
  Title: string;
  TranslationId: string;
  Categories: string;
  MyHFTitle: string;
  MyHFCategory: string;
  MyHFCategoryHeading: string;
  LastUpdate: string;
  ImageUrl: string;
  ImageAlt: string;
  AccessibleVersion: string;
  Sections?: {
    section?: Array<{
      Title: string;
      Content: string;
    }>;
  };
}

/** Public type for preventive recommendations */
export interface PreventiveRecommendation {
  id: string;
  title: string;
  category: string;
  description: string;
  ageRange?: string;
  frequency?: string;
  uspstfGrade?: string;
  source: string;
  actionUrl?: string;
}

// ---------------------------------------------------------------------------
// Condition-to-keyword mapping
// ---------------------------------------------------------------------------

/**
 * Maps ICD-10 code prefixes and condition names to MyHealthfinder keywords
 */
const CONDITION_KEYWORDS: Record<string, string[]> = {
  E11: ["diabetes"],
  E10: ["diabetes"],
  I10: ["blood pressure", "heart"],
  I50: ["heart"],
  I48: ["heart"],
  J44: ["lung"],
  E66: ["weight"],
  N18: ["kidney"],
};

/** Extra keywords by age */
function getAgeBasedKeywords(age: number): string[] {
  const kw: string[] = [];
  if (age >= 45) kw.push("colorectal cancer");
  if (age >= 50) kw.push("lung cancer");
  if (age >= 65) kw.push("fall", "osteoporosis");
  return kw;
}

// ---------------------------------------------------------------------------
// Simple in-memory cache
// ---------------------------------------------------------------------------

const topicCache = new Map<string, { data: MyHealthfinderTopic[]; ts: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// API fetch
// ---------------------------------------------------------------------------

async function fetchTopics(
  age: number,
  sex: "male" | "female",
  keyword?: string
): Promise<MyHealthfinderTopic[]> {
  const params = new URLSearchParams({ age: String(age), sex });
  if (keyword) params.set("keyword", keyword);

  const cacheKey = params.toString();
  const cached = topicCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.data;
  }

  const url = `${BASE_URL}/topicsearch.json?${params}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.warn(`[MyHealthfinder] API returned ${response.status} for keyword=${keyword || "(none)"}`);
      return [];
    }

    const json: MyHealthfinderResponse = await response.json();

    if (json.Result.Error === "True" || !json.Result.Resources?.Resource) {
      return [];
    }

    const topics = json.Result.Resources.Resource;
    topicCache.set(cacheKey, { data: topics, ts: Date.now() });
    return topics;
  } catch (error) {
    traceError("myhealthfinder-api", error, { dataSource: "MyHealthfinder" });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Strip HTML to plain text
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Filtering irrelevant topics
// ---------------------------------------------------------------------------

const SKIP_TITLE_PATTERNS = [
  "baby", "child", "children", "kid",
  "pregnancy", "pregnant", "breastfeed", "breastfeeding",
  "preeclampsia", "gestational",
  "teen", "adolescent",
  "infant", "newborn", "toddler",
];

function isRelevantTopic(topic: MyHealthfinderTopic): boolean {
  const title = topic.Title.toLowerCase();
  return !SKIP_TITLE_PATTERNS.some((p) => title.includes(p));
}

// ---------------------------------------------------------------------------
// Lab-based screening checks
// ---------------------------------------------------------------------------

interface ScreeningCheck {
  titleKeywords: string[];
  labKeywords: string[];
  conditionCodes?: string[];
  minAge?: number;
  genderOnly?: "M" | "F";
}

const SCREENING_CHECKS: ScreeningCheck[] = [
  {
    titleKeywords: ["a1c", "blood sugar", "diabetes"],
    labKeywords: ["a1c", "hba1c", "glucose"],
    conditionCodes: ["E11", "E10"],
  },
  {
    titleKeywords: ["cholesterol", "lipid"],
    labKeywords: ["cholesterol", "ldl", "hdl", "lipid"],
    minAge: 20,
  },
  {
    titleKeywords: ["blood pressure"],
    labKeywords: [], // checked via vitalSigns
  },
  {
    titleKeywords: ["colorectal", "colon cancer"],
    labKeywords: ["colonoscopy", "fit", "fobt", "cologuard"],
    minAge: 45,
  },
  {
    titleKeywords: ["lung cancer"],
    labKeywords: ["ldct", "lung ct"],
    minAge: 50,
  },
  {
    titleKeywords: ["bone density", "osteoporosis"],
    labKeywords: ["dexa", "bone density"],
    minAge: 65,
  },
  {
    titleKeywords: ["mammogram", "breast cancer"],
    labKeywords: ["mammogram", "mammography"],
    minAge: 40,
    genderOnly: "F",
  },
];

// ---------------------------------------------------------------------------
// Topic → CareGap conversion
// ---------------------------------------------------------------------------

function topicToCareGap(
  topic: MyHealthfinderTopic,
  patient: Patient,
  matchedKeyword: string
): CareGap | null {
  if (!isRelevantTopic(topic)) return null;

  const title = topic.Title.toLowerCase();

  // Extract recommendation text from first 2 sections
  const sections = topic.Sections?.section || [];
  const recText = sections
    .slice(0, 2)
    .map((s) => stripHtml(s.Content))
    .join(" ")
    .substring(0, 400);

  if (!recText) return null;

  // Determine met/unmet status by checking labs and vitals
  let status: CareGap["status"] = "unmet";

  for (const check of SCREENING_CHECKS) {
    const matchesTitle = check.titleKeywords.some((kw) => title.includes(kw));
    if (!matchesTitle) continue;

    // Enforce age/gender filters
    if (check.minAge && patient.age < check.minAge) return null;
    if (check.genderOnly && patient.gender !== check.genderOnly) return null;

    // Condition-specific: skip if patient doesn't have the condition
    if (check.conditionCodes) {
      const hasCondition = patient.diagnoses.some((d) =>
        check.conditionCodes!.some((code) => d.code.startsWith(code))
      );
      if (!hasCondition) return null;
    }

    // Blood pressure check via vitals
    if (check.titleKeywords.includes("blood pressure")) {
      if (patient.vitalSigns?.bloodPressure) {
        status = "met";
      }
      break;
    }

    // Lab-based check
    if (check.labKeywords.length > 0 && patient.recentLabs) {
      const hasLab = patient.recentLabs.some((lab) =>
        check.labKeywords.some((kw) => lab.name.toLowerCase().includes(kw))
      );
      if (hasLab) {
        status = "met";
      }
    }
    break; // matched a check, stop looking
  }

  return {
    id: `mhf-${topic.Id}`,
    guideline: topic.Title,
    organization: "USPSTF/MyHealthfinder",
    recommendation: recText,
    grade: "B", // MyHealthfinder topics are generally USPSTF Grade A or B
    status,
    evidence: `Source: MyHealthfinder (${topic.Categories || matchedKeyword}). ${topic.AccessibleVersion || ""}`.trim(),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch preventive care recommendations from MyHealthfinder API
 * based on patient demographics and conditions, then compare against
 * patient clinical data to identify care gaps.
 *
 * Returns CareGap[] matching the same interface as guidelines-client.ts
 * so both sources can be merged seamlessly.
 */
export async function getMyHealthfinderCareGaps(
  patient: Patient
): Promise<CareGap[]> {
  const sex = patient.gender === "F" ? "female" : "male";
  const age = patient.age;

  // Collect keywords from patient conditions
  const keywords = new Set<string>();

  for (const diagnosis of patient.diagnoses) {
    const codePrefix = diagnosis.code.substring(0, 3);
    const kws = CONDITION_KEYWORDS[codePrefix];
    if (kws) kws.forEach((kw) => keywords.add(kw));
  }

  // Add age-based screening keywords
  getAgeBasedKeywords(age).forEach((kw) => keywords.add(kw));

  // Always include general screening
  keywords.add("screening");

  console.log(
    `[MyHealthfinder] Fetching for ${age}yo ${sex}, keywords: [${[...keywords].join(", ")}]`
  );

  // Fetch topics for each keyword in parallel
  const keywordArray = [...keywords];
  const results = await Promise.all(
    keywordArray.map((kw) =>
      fetchTopics(age, sex, kw).then((topics) => ({ keyword: kw, topics }))
    )
  );

  // Deduplicate topics by ID and convert to CareGap
  const seenIds = new Set<string>();
  const careGaps: CareGap[] = [];

  for (const { keyword, topics } of results) {
    for (const topic of topics) {
      if (seenIds.has(topic.Id)) continue;
      seenIds.add(topic.Id);

      const gap = topicToCareGap(topic, patient, keyword);
      if (gap) careGaps.push(gap);
    }
  }

  // If the API returned nothing useful, fall back to hardcoded defaults
  if (careGaps.length === 0) {
    console.warn("[MyHealthfinder] API returned no useful gaps, using defaults");
    return getDefaultCareGaps(patient);
  }

  const unmetCount = careGaps.filter((g) => g.status === "unmet").length;
  console.log(`[MyHealthfinder] Found ${careGaps.length} gaps (${unmetCount} unmet)`);

  return careGaps;
}

/**
 * Get only unmet care gaps from MyHealthfinder
 */
export async function getUnmetMyHealthfinderGaps(
  patient: Patient
): Promise<CareGap[]> {
  const gaps = await getMyHealthfinderCareGaps(patient);
  return gaps.filter((g) => g.status === "unmet");
}

/**
 * Also export the old function name for backwards compatibility
 * (used in identifyPreventiveCareGaps pattern)
 */
export async function getPreventiveRecommendations(
  patient: Patient
): Promise<PreventiveRecommendation[]> {
  const sex = patient.gender === "F" ? "female" : "male";
  const topics = await fetchTopics(patient.age, sex);
  return topics.filter(isRelevantTopic).map((t) => ({
    id: t.Id,
    title: t.Title,
    category: t.Categories || "Preventive Care",
    description: (t.Sections?.section || [])
      .slice(0, 1)
      .map((s) => stripHtml(s.Content))
      .join(" ")
      .substring(0, 500),
    source: "MyHealthfinder (ODPHP)",
    actionUrl: t.AccessibleVersion || undefined,
  }));
}

// ---------------------------------------------------------------------------
// Fallback defaults when API is unavailable
// ---------------------------------------------------------------------------

function getDefaultCareGaps(patient: Patient): CareGap[] {
  const gaps: CareGap[] = [];

  if (patient.age >= 45 && patient.age <= 75) {
    const hasColonoscopy = patient.recentLabs?.some((l) =>
      ["colonoscopy", "fit", "fobt"].some((kw) => l.name.toLowerCase().includes(kw))
    );
    if (!hasColonoscopy) {
      gaps.push({
        id: "mhf-colorectal",
        guideline: "Colorectal Cancer Screening",
        organization: "USPSTF/MyHealthfinder",
        recommendation:
          "Adults ages 45-75 should be screened for colorectal cancer. Options include colonoscopy every 10 years, or stool-based tests more frequently.",
        grade: "A",
        status: "unmet",
        evidence: "USPSTF Grade A recommendation",
      });
    }
  }

  if (patient.gender === "F" && patient.age >= 40) {
    const hasMammo = patient.recentLabs?.some((l) =>
      l.name.toLowerCase().includes("mammogram")
    );
    if (!hasMammo) {
      gaps.push({
        id: "mhf-breast",
        guideline: "Breast Cancer Screening (Mammogram)",
        organization: "USPSTF/MyHealthfinder",
        recommendation:
          "Women should discuss breast cancer screening with their provider. Biennial screening mammography is recommended for women ages 50-74.",
        grade: "B",
        status: "unmet",
        evidence: "USPSTF Grade B recommendation",
      });
    }
  }

  if (patient.age >= 65) {
    gaps.push({
      id: "mhf-fall-risk",
      guideline: "Fall Prevention for Older Adults",
      organization: "USPSTF/MyHealthfinder",
      recommendation:
        "Adults 65+ should be assessed for fall risk. Exercise interventions to prevent falls are recommended.",
      grade: "B",
      status: "unmet",
      evidence: "USPSTF Grade B recommendation",
    });
  }

  // Lipid screening for adults with cardiovascular risk
  const hasLipid = patient.recentLabs?.some((l) =>
    ["cholesterol", "ldl", "hdl", "lipid"].some((kw) => l.name.toLowerCase().includes(kw))
  );
  if (!hasLipid && patient.age >= 40) {
    gaps.push({
      id: "mhf-lipid",
      guideline: "Lipid Screening",
      organization: "USPSTF/MyHealthfinder",
      recommendation:
        "Adults at increased risk for cardiovascular disease should have lipid levels checked. Statin therapy may be indicated.",
      grade: "B",
      status: "unmet",
      evidence: "USPSTF Grade B recommendation",
    });
  }

  return gaps;
}
