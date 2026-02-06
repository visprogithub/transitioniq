/**
 * USDA FoodData Central API Client
 *
 * Free government nutrition database with 380,000+ foods.
 * API docs: https://fdc.nal.usda.gov/api-guide/
 *
 * Rate limit: 1,000 requests/hour per IP (no key required for basic use)
 * With API key: Higher limits available
 */

import { traceError } from "@/lib/integrations/opik";

// Simple in-memory cache for nutrition data
const nutritionCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours - USDA updates quarterly

interface FDCFood {
  fdcId: number;
  description: string;
  dataType: string;
  brandOwner?: string;
  ingredients?: string;
  foodNutrients: Array<{
    nutrientId: number;
    nutrientName: string;
    nutrientNumber: string;
    unitName: string;
    value: number;
  }>;
}

interface FDCSearchResult {
  totalHits: number;
  foods: FDCFood[];
}

interface NutritionInfo {
  food: string;
  fdcId: number;
  servingInfo?: string;
  nutrients: {
    calories?: number;
    protein?: number;
    carbohydrates?: number;
    fat?: number;
    fiber?: number;
    sodium?: number;
    sugar?: number;
    potassium?: number;
    cholesterol?: number;
    saturatedFat?: number;
    vitaminK?: number;
  };
  warnings: string[];
}

interface DietaryRecommendation {
  food: string;
  isGoodChoice: boolean;
  reasons: string[];
  alternatives?: string[];
  nutrientConcerns: string[];
}

const API_BASE = "https://api.nal.usda.gov/fdc/v1";

// Get API key from env or use DEMO_KEY (limited but works)
function getApiKey(): string {
  return process.env.USDA_API_KEY || "DEMO_KEY";
}

/**
 * Search for foods in the USDA database
 */
export async function searchFoods(query: string, pageSize = 5): Promise<FDCFood[]> {
  const cacheKey = `search:${query}:${pageSize}`;
  const cached = nutritionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as FDCFood[];
  }

  try {
    const url = `${API_BASE}/foods/search?api_key=${getApiKey()}&query=${encodeURIComponent(query)}&pageSize=${pageSize}&dataType=Foundation,SR%20Legacy`;

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return [];
    }

    const data: FDCSearchResult = await response.json();
    nutritionCache.set(cacheKey, { data: data.foods, timestamp: Date.now() });
    return data.foods;
  } catch (error) {
    traceError("usda-search", error, { dataSource: "USDA" });
    return [];
  }
}

/**
 * Get detailed nutrition info for a food
 */
export async function getFoodNutrition(fdcId: number): Promise<FDCFood | null> {
  const cacheKey = `food:${fdcId}`;
  const cached = nutritionCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data as FDCFood;
  }

  try {
    const url = `${API_BASE}/food/${fdcId}?api_key=${getApiKey()}`;

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      return null;
    }

    const data: FDCFood = await response.json();
    nutritionCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error) {
    traceError("usda-get-food", error, { dataSource: "USDA" });
    return null;
  }
}

/**
 * Extract key nutrients from USDA food data
 */
function extractNutrients(food: FDCFood): NutritionInfo["nutrients"] {
  const nutrients: NutritionInfo["nutrients"] = {};

  // Map USDA nutrient IDs to our structure
  const nutrientMap: Record<number, keyof NutritionInfo["nutrients"]> = {
    1008: "calories",      // Energy (kcal)
    1003: "protein",       // Protein (g)
    1005: "carbohydrates", // Carbohydrate (g)
    1004: "fat",           // Total lipid/fat (g)
    1079: "fiber",         // Fiber (g)
    1093: "sodium",        // Sodium (mg)
    2000: "sugar",         // Sugars (g)
    1092: "potassium",     // Potassium (mg)
    1253: "cholesterol",   // Cholesterol (mg)
    1258: "saturatedFat",  // Saturated fatty acids (g)
    1185: "vitaminK",      // Vitamin K (mcg)
  };

  for (const nutrient of food.foodNutrients) {
    const key = nutrientMap[nutrient.nutrientId];
    if (key) {
      nutrients[key] = Math.round(nutrient.value * 10) / 10;
    }
  }

  return nutrients;
}

/**
 * Get nutrition info for a food query with patient-relevant warnings
 */
export async function getNutritionInfo(
  foodQuery: string,
  patientConditions: {
    hasHeartFailure?: boolean;
    hasDiabetes?: boolean;
    hasKidneyDisease?: boolean;
    takesWarfarin?: boolean;
  } = {}
): Promise<NutritionInfo | null> {
  const foods = await searchFoods(foodQuery, 1);
  if (foods.length === 0) return null;

  const food = foods[0];
  const nutrients = extractNutrients(food);
  const warnings: string[] = [];

  // Generate condition-specific warnings
  if (patientConditions.hasHeartFailure) {
    if (nutrients.sodium && nutrients.sodium > 400) {
      warnings.push(`High sodium (${nutrients.sodium}mg) - limit for heart failure`);
    }
  }

  if (patientConditions.hasDiabetes) {
    if (nutrients.sugar && nutrients.sugar > 10) {
      warnings.push(`Contains ${nutrients.sugar}g sugar - monitor blood glucose`);
    }
    if (nutrients.carbohydrates && nutrients.carbohydrates > 30) {
      warnings.push(`High carbs (${nutrients.carbohydrates}g) - count toward daily intake`);
    }
  }

  if (patientConditions.hasKidneyDisease) {
    if (nutrients.potassium && nutrients.potassium > 300) {
      warnings.push(`High potassium (${nutrients.potassium}mg) - may need to limit`);
    }
    if (nutrients.sodium && nutrients.sodium > 300) {
      warnings.push(`Contains ${nutrients.sodium}mg sodium`);
    }
  }

  if (patientConditions.takesWarfarin) {
    if (nutrients.vitaminK && nutrients.vitaminK > 50) {
      warnings.push(`High vitamin K (${nutrients.vitaminK}mcg) - keep intake consistent while on Warfarin`);
    }
  }

  return {
    food: food.description,
    fdcId: food.fdcId,
    nutrients,
    warnings,
  };
}

/**
 * Evaluate if a food is a good choice for a patient
 */
export async function evaluateFoodChoice(
  foodQuery: string,
  patientConditions: {
    hasHeartFailure?: boolean;
    hasDiabetes?: boolean;
    hasKidneyDisease?: boolean;
    takesWarfarin?: boolean;
    hasCOPD?: boolean;
  }
): Promise<DietaryRecommendation | null> {
  const info = await getNutritionInfo(foodQuery, patientConditions);
  if (!info) return null;

  const reasons: string[] = [];
  const concerns: string[] = [];
  let isGoodChoice = true;

  const { nutrients } = info;

  // Evaluate based on conditions
  if (patientConditions.hasHeartFailure) {
    if (nutrients.sodium && nutrients.sodium > 400) {
      isGoodChoice = false;
      concerns.push(`High sodium (${nutrients.sodium}mg per serving)`);
    } else if (nutrients.sodium && nutrients.sodium < 140) {
      reasons.push("Low sodium - heart-healthy choice");
    }
  }

  if (patientConditions.hasDiabetes) {
    if (nutrients.fiber && nutrients.fiber > 3) {
      reasons.push(`Good fiber content (${nutrients.fiber}g) helps blood sugar`);
    }
    if (nutrients.sugar && nutrients.sugar > 15) {
      isGoodChoice = false;
      concerns.push(`High sugar (${nutrients.sugar}g)`);
    }
  }

  if (patientConditions.takesWarfarin) {
    if (nutrients.vitaminK && nutrients.vitaminK > 100) {
      concerns.push(`Very high vitamin K (${nutrients.vitaminK}mcg) - eat consistent amounts`);
    }
  }

  if (patientConditions.hasKidneyDisease) {
    if (nutrients.potassium && nutrients.potassium > 400) {
      isGoodChoice = false;
      concerns.push(`High potassium (${nutrients.potassium}mg)`);
    }
  }

  // General positive attributes
  if (nutrients.protein && nutrients.protein > 10) {
    reasons.push(`Good protein source (${nutrients.protein}g)`);
  }
  if (nutrients.fiber && nutrients.fiber > 5) {
    reasons.push(`High fiber (${nutrients.fiber}g)`);
  }
  if (nutrients.saturatedFat && nutrients.saturatedFat < 2) {
    reasons.push("Low in saturated fat");
  }

  return {
    food: info.food,
    isGoodChoice: isGoodChoice && concerns.length === 0,
    reasons: reasons.length > 0 ? reasons : ["No specific benefits or concerns identified"],
    nutrientConcerns: concerns,
  };
}

/**
 * Get foods to recommend or avoid for specific conditions
 */
export async function getConditionBasedFoodSuggestions(
  condition: "heart_failure" | "diabetes" | "kidney_disease" | "warfarin"
): Promise<{ goodChoices: string[]; avoid: string[]; tips: string[] }> {
  // These are evidence-based recommendations, not from the API
  // The API can be used to verify specific foods the patient asks about

  const suggestions: Record<string, { goodChoices: string[]; avoid: string[]; tips: string[] }> = {
    heart_failure: {
      goodChoices: [
        "Fresh fruits (apples, berries, oranges)",
        "Fresh vegetables (no added salt)",
        "Skinless chicken or fish",
        "Brown rice, quinoa, oats",
        "Unsalted nuts",
      ],
      avoid: [
        "Canned soups and vegetables (high sodium)",
        "Deli meats and processed foods",
        "Frozen dinners",
        "Restaurant food",
        "Pickles, olives, sauerkraut",
      ],
      tips: [
        "Aim for less than 2,000mg sodium per day",
        "Cook at home to control salt",
        "Use herbs, spices, lemon, and vinegar for flavor",
        "Read labels - look for 'low sodium' options",
      ],
    },
    diabetes: {
      goodChoices: [
        "Non-starchy vegetables (broccoli, spinach, peppers)",
        "Whole grains (brown rice, quinoa, whole wheat)",
        "Lean proteins (chicken, fish, tofu)",
        "Berries in moderation",
        "Legumes (beans, lentils)",
      ],
      avoid: [
        "Sugary drinks and fruit juices",
        "White bread, white rice, regular pasta",
        "Candy, cookies, pastries",
        "Sweetened cereals",
        "Large portions of fruit",
      ],
      tips: [
        "Eat consistent amounts at regular times",
        "Pair carbs with protein or healthy fat",
        "Choose foods with low glycemic index",
        "Read labels for total carbohydrates",
      ],
    },
    kidney_disease: {
      goodChoices: [
        "Cabbage, cauliflower, bell peppers",
        "Apples, berries, grapes",
        "White rice, white bread (lower phosphorus)",
        "Egg whites",
        "Fresh meat in moderate portions",
      ],
      avoid: [
        "Bananas, oranges, potatoes (high potassium)",
        "Dairy products (high phosphorus)",
        "Nuts and seeds",
        "Whole grains (high phosphorus)",
        "Processed meats",
      ],
      tips: [
        "Your dietitian can give specific limits for potassium/phosphorus",
        "Leach potatoes by soaking in water before cooking",
        "Limit portion sizes of high-potassium foods",
      ],
    },
    warfarin: {
      goodChoices: [
        "You can eat most foods - just be consistent",
        "Fruits, vegetables, grains, proteins are all fine",
        "Keep vitamin K intake steady week to week",
      ],
      avoid: [
        "Don't suddenly eat large amounts of leafy greens",
        "Avoid drastic diet changes",
        "Limit cranberry juice",
        "Avoid new herbal supplements without asking doctor",
      ],
      tips: [
        "You don't need to avoid vitamin K foods",
        "Eat about the same amount of greens each week",
        "If you want to change your diet, do it gradually",
        "Tell your doctor about any diet changes",
      ],
    },
  };

  return suggestions[condition] || {
    goodChoices: ["Balanced diet with variety"],
    avoid: ["No specific restrictions"],
    tips: ["Ask your healthcare team about your specific needs"],
  };
}
