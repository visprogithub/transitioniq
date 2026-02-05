/**
 * MyHealthfinder API Client
 *
 * Free API from the Office of Disease Prevention and Health Promotion (ODPHP)
 * that provides consumer-friendly preventive service recommendations.
 *
 * API Documentation: https://health.gov/our-work/national-health-initiatives/health-literacy/consumer-health-content/free-web-content/apis-developers
 * Base URL: https://health.gov/myhealthfinder/api/v3
 *
 * This API is free, requires no API key, and provides USPSTF-based preventive care recommendations.
 */

import type { Patient } from "../types/patient";

const MYHEALTHFINDER_BASE = "https://health.gov/myhealthfinder/api/v3";

// Cache for API responses (24 hours - recommendations don't change frequently)
const recommendationCache = new Map<string, { data: PreventiveRecommendation[]; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

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

interface MyHealthfinderResource {
  Id: string;
  Title: string;
  Categories?: string;
  Sections?: {
    Title?: string;
    Content?: string;
    Description?: string;
  }[];
  AccessibleVersion?: string;
  RelatedItems?: {
    Resources?: { Id: string; Title: string; Url: string }[];
  };
}

interface MyHealthfinderResponse {
  Result?: {
    Resources?: {
      Resource?: MyHealthfinderResource[];
    };
    Total?: number;
  };
}

/**
 * Get preventive care recommendations for a patient based on demographics
 */
export async function getPreventiveRecommendations(
  patient: Patient
): Promise<PreventiveRecommendation[]> {
  // Create cache key based on age and gender
  const cacheKey = `${patient.age}-${patient.gender}`;
  const cached = recommendationCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data;
  }

  const recommendations: PreventiveRecommendation[] = [];

  try {
    // Build query parameters based on patient demographics
    const params = new URLSearchParams({
      age: patient.age.toString(),
      sex: patient.gender === "M" ? "male" : "female",
      lang: "en",
    });

    // Optionally add pregnancy status if female
    if (patient.gender === "F") {
      const isPregnant = patient.diagnoses.some(
        (d) =>
          d.code.startsWith("O") || // ICD-10 pregnancy codes
          d.display.toLowerCase().includes("pregnant") ||
          d.display.toLowerCase().includes("pregnancy")
      );
      if (isPregnant) {
        params.set("pregnant", "true");
      }
    }

    // Note: Could add tobacco/sexual history parameters if Patient type is extended
    // For now, the API returns appropriate recommendations based on age and sex

    const url = `${MYHEALTHFINDER_BASE}/myhealthfinder.json?${params.toString()}`;
    console.log(`[MyHealthfinder] Fetching recommendations: ${url}`);

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      console.error(`[MyHealthfinder] API error: ${response.status}`);
      return getDefaultPreventiveRecommendations(patient);
    }

    const data: MyHealthfinderResponse = await response.json();
    const resources = data.Result?.Resources?.Resource || [];

    for (const resource of resources) {
      // Extract description from sections
      let description = "";
      if (resource.Sections && resource.Sections.length > 0) {
        // Get first section with content, strip HTML
        const section = resource.Sections.find((s) => s.Content || s.Description);
        if (section) {
          description = stripHtml(section.Content || section.Description || "");
        }
      }

      recommendations.push({
        id: resource.Id,
        title: resource.Title,
        category: resource.Categories || "Preventive Care",
        description: description.substring(0, 500) + (description.length > 500 ? "..." : ""),
        source: "MyHealthfinder (ODPHP)",
        actionUrl: resource.AccessibleVersion || undefined,
      });
    }

    // Cache the results
    recommendationCache.set(cacheKey, {
      data: recommendations,
      expiresAt: Date.now() + CACHE_TTL,
    });

    return recommendations;
  } catch (error) {
    console.error("[MyHealthfinder] Fetch error:", error);
    return getDefaultPreventiveRecommendations(patient);
  }
}

/**
 * Get topic-specific recommendations
 */
export async function getTopicRecommendations(
  topicId: string
): Promise<PreventiveRecommendation | null> {
  try {
    const url = `${MYHEALTHFINDER_BASE}/topicsearch.json?topicId=${encodeURIComponent(topicId)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const data: MyHealthfinderResponse = await response.json();
    const resource = data.Result?.Resources?.Resource?.[0];

    if (!resource) return null;

    let description = "";
    if (resource.Sections && resource.Sections.length > 0) {
      const section = resource.Sections.find((s) => s.Content || s.Description);
      if (section) {
        description = stripHtml(section.Content || section.Description || "");
      }
    }

    return {
      id: resource.Id,
      title: resource.Title,
      category: resource.Categories || "Preventive Care",
      description: description.substring(0, 500) + (description.length > 500 ? "..." : ""),
      source: "MyHealthfinder (ODPHP)",
      actionUrl: resource.AccessibleVersion || undefined,
    };
  } catch (error) {
    console.error("[MyHealthfinder] Topic fetch error:", error);
    return null;
  }
}

/**
 * Search for health topics
 */
export async function searchHealthTopics(
  keyword: string
): Promise<PreventiveRecommendation[]> {
  try {
    const url = `${MYHEALTHFINDER_BASE}/itemlist.json?type=topic&keyword=${encodeURIComponent(keyword)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return [];
    }

    const data: MyHealthfinderResponse = await response.json();
    const resources = data.Result?.Resources?.Resource || [];

    return resources.map((r) => ({
      id: r.Id,
      title: r.Title,
      category: r.Categories || "Health Information",
      description: "",
      source: "MyHealthfinder (ODPHP)",
      actionUrl: r.AccessibleVersion || undefined,
    }));
  } catch (error) {
    console.error("[MyHealthfinder] Search error:", error);
    return [];
  }
}

/**
 * Compare MyHealthfinder recommendations against what's documented in patient record
 * Returns recommendations that appear to be care gaps (not documented as completed)
 */
export async function identifyPreventiveCareGaps(
  patient: Patient
): Promise<{
  recommendation: PreventiveRecommendation;
  status: "likely_gap" | "may_be_due" | "check_with_provider";
  reason: string;
}[]> {
  const recommendations = await getPreventiveRecommendations(patient);
  const gaps: {
    recommendation: PreventiveRecommendation;
    status: "likely_gap" | "may_be_due" | "check_with_provider";
    reason: string;
  }[] = [];

  // Extract patient's documented conditions and labs for comparison
  // Note: Full procedure/immunization history would require extending Patient type
  const patientHistory = [
    ...patient.diagnoses.map((d) => d.display.toLowerCase()),
    ...patient.recentLabs?.map((l) => l.name.toLowerCase()) || [],
  ].join(" ");

  // If API returned empty results, use default recommendations to check for gaps
  const recsToCheck = recommendations.length > 0
    ? recommendations
    : getDefaultPreventiveRecommendations(patient);

  console.log(`[MyHealthfinder] Checking ${recsToCheck.length} recommendations for gaps (API returned ${recommendations.length})`);

  for (const rec of recsToCheck) {
    const titleLower = rec.title.toLowerCase();

    // Check for common preventive screenings
    if (titleLower.includes("colonoscopy") || titleLower.includes("colon cancer")) {
      if (!patientHistory.includes("colonoscopy") && patient.age >= 45) {
        gaps.push({
          recommendation: rec,
          status: "may_be_due",
          reason: "Colonoscopy is recommended for adults 45-75. Not documented in record.",
        });
      }
    } else if (titleLower.includes("mammogram") || titleLower.includes("breast cancer")) {
      if (patient.gender === "F" && patient.age >= 40 && !patientHistory.includes("mammogram")) {
        gaps.push({
          recommendation: rec,
          status: "may_be_due",
          reason: "Mammogram recommended for women 40+. Not documented in record.",
        });
      }
    } else if (titleLower.includes("flu") || titleLower.includes("influenza")) {
      if (!patientHistory.includes("flu") && !patientHistory.includes("influenza")) {
        gaps.push({
          recommendation: rec,
          status: "check_with_provider",
          reason: "Annual flu vaccine recommended. Check if received this season.",
        });
      }
    } else if (titleLower.includes("blood pressure")) {
      if (!patient.vitalSigns?.bloodPressure) {
        gaps.push({
          recommendation: rec,
          status: "check_with_provider",
          reason: "Blood pressure monitoring recommended. Should be checked at visits.",
        });
      }
    } else if (titleLower.includes("cholesterol") || titleLower.includes("lipid")) {
      const hasLipidLab = patient.recentLabs?.some(
        (l) => l.name.toLowerCase().includes("cholesterol") || l.name.toLowerCase().includes("lipid")
      );
      if (!hasLipidLab && patient.age >= 20) {
        gaps.push({
          recommendation: rec,
          status: "may_be_due",
          reason: "Lipid screening recommended. Not found in recent labs.",
        });
      }
    } else if (titleLower.includes("diabetes") && titleLower.includes("screen")) {
      const hasDiabetesScreen = patient.recentLabs?.some(
        (l) => l.name.toLowerCase().includes("glucose") || l.name.toLowerCase().includes("a1c")
      );
      if (!hasDiabetesScreen && patient.age >= 35) {
        gaps.push({
          recommendation: rec,
          status: "check_with_provider",
          reason: "Diabetes screening recommended for adults 35-70 with overweight/obesity.",
        });
      }
    }
  }

  return gaps;
}

/**
 * Default preventive recommendations when API is unavailable
 */
function getDefaultPreventiveRecommendations(patient: Patient): PreventiveRecommendation[] {
  const recommendations: PreventiveRecommendation[] = [];

  // Age-based screening recommendations (USPSTF)
  if (patient.age >= 45 && patient.age <= 75) {
    recommendations.push({
      id: "colorectal-screening",
      title: "Colorectal Cancer Screening",
      category: "Cancer Screening",
      description: "Adults ages 45-75 should be screened for colorectal cancer. Options include colonoscopy every 10 years, or stool-based tests more frequently.",
      ageRange: "45-75",
      frequency: "Every 10 years (colonoscopy) or 1-3 years (stool tests)",
      uspstfGrade: "A",
      source: "USPSTF",
    });
  }

  if (patient.gender === "F" && patient.age >= 40) {
    recommendations.push({
      id: "breast-screening",
      title: "Breast Cancer Screening (Mammogram)",
      category: "Cancer Screening",
      description: "Women should discuss breast cancer screening with their provider. Mammograms are recommended every 1-2 years starting between ages 40-50.",
      ageRange: "40-74",
      frequency: "Every 1-2 years",
      uspstfGrade: "B",
      source: "USPSTF",
    });
  }

  if (patient.gender === "F" && patient.age >= 21 && patient.age <= 65) {
    recommendations.push({
      id: "cervical-screening",
      title: "Cervical Cancer Screening",
      category: "Cancer Screening",
      description: "Women ages 21-65 should be screened for cervical cancer with Pap smear every 3 years or Pap + HPV testing every 5 years (ages 30-65).",
      ageRange: "21-65",
      frequency: "Every 3-5 years",
      uspstfGrade: "A",
      source: "USPSTF",
    });
  }

  // Everyone
  recommendations.push({
    id: "flu-vaccine",
    title: "Annual Flu Vaccine",
    category: "Immunizations",
    description: "Everyone 6 months and older should get a flu vaccine every year, ideally by the end of October.",
    frequency: "Annually",
    source: "CDC/ACIP",
  });

  if (patient.age >= 65) {
    recommendations.push({
      id: "pneumonia-vaccine",
      title: "Pneumonia Vaccine",
      category: "Immunizations",
      description: "Adults 65 and older should receive pneumococcal vaccines (PCV15 or PCV20).",
      ageRange: "65+",
      source: "CDC/ACIP",
    });
  }

  if (patient.age >= 50) {
    recommendations.push({
      id: "shingles-vaccine",
      title: "Shingles Vaccine (Shingrix)",
      category: "Immunizations",
      description: "Adults 50 and older should receive 2 doses of the Shingrix vaccine to prevent shingles.",
      ageRange: "50+",
      source: "CDC/ACIP",
    });
  }

  return recommendations;
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
