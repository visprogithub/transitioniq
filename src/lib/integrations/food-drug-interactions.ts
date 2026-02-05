/**
 * Food-Drug Interactions Database
 *
 * Evidence-based food-drug interactions commonly encountered in clinical practice.
 * Sources: FDA drug labels, clinical pharmacology references, DDInter/FooDrugs concepts.
 *
 * For production use, consider integrating:
 * - DDInter 2.0 (drug-drug/food interactions database)
 * - FooDrugs (food-drug interaction database)
 * - DrugBank (requires license for API access)
 */

export interface FoodDrugInteraction {
  drug: string;
  drugClass?: string;
  food: string;
  foodCategory?: string;
  severity: "major" | "moderate" | "minor";
  mechanism: string;
  recommendation: string;
  timing?: string;
}

/**
 * Comprehensive food-drug interactions database
 * Organized by drug/drug class for efficient lookup
 */
const FOOD_DRUG_INTERACTIONS: FoodDrugInteraction[] = [
  // ============================================
  // ANTICOAGULANTS (Vitamin K interactions)
  // ============================================
  {
    drug: "warfarin",
    drugClass: "anticoagulant",
    food: "leafy greens",
    foodCategory: "vegetables",
    severity: "major",
    mechanism: "Vitamin K in leafy greens counteracts warfarin's anticoagulant effect",
    recommendation: "Maintain CONSISTENT intake of vitamin K foods - don't suddenly increase or decrease",
    timing: "Daily consistency matters more than avoidance",
  },
  {
    drug: "warfarin",
    drugClass: "anticoagulant",
    food: "cranberry",
    foodCategory: "fruit",
    severity: "moderate",
    mechanism: "Cranberry may inhibit warfarin metabolism, increasing bleeding risk",
    recommendation: "Limit cranberry juice to small amounts; avoid cranberry supplements",
    timing: "Ongoing interaction",
  },
  {
    drug: "warfarin",
    drugClass: "anticoagulant",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "moderate",
    mechanism: "Grapefruit inhibits CYP enzymes, may increase warfarin levels",
    recommendation: "Limit grapefruit and grapefruit juice consumption",
    timing: "Avoid large amounts",
  },
  {
    drug: "warfarin",
    drugClass: "anticoagulant",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Alcohol affects warfarin metabolism unpredictably; increases bleeding risk",
    recommendation: "Limit alcohol to 1-2 drinks occasionally; avoid binge drinking",
    timing: "Ongoing; acute intoxication especially risky",
  },
  {
    drug: "warfarin",
    drugClass: "anticoagulant",
    food: "garlic",
    foodCategory: "supplement",
    severity: "moderate",
    mechanism: "Garlic has antiplatelet effects that may add to warfarin's bleeding risk",
    recommendation: "Moderate garlic in cooking is fine; avoid high-dose garlic supplements",
  },
  {
    drug: "warfarin",
    drugClass: "anticoagulant",
    food: "ginger",
    foodCategory: "supplement",
    severity: "moderate",
    mechanism: "Ginger may inhibit platelet aggregation, adding to bleeding risk",
    recommendation: "Avoid high-dose ginger supplements while on warfarin",
  },
  {
    drug: "warfarin",
    drugClass: "anticoagulant",
    food: "green tea",
    foodCategory: "beverage",
    severity: "moderate",
    mechanism: "Green tea contains vitamin K and may reduce warfarin effectiveness",
    recommendation: "Keep green tea consumption consistent; don't suddenly increase",
  },

  // ============================================
  // STATINS (Grapefruit interactions)
  // ============================================
  {
    drug: "atorvastatin",
    drugClass: "statin",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "major",
    mechanism: "Grapefruit inhibits CYP3A4, dramatically increasing statin levels and muscle damage risk",
    recommendation: "AVOID grapefruit and grapefruit juice entirely while on atorvastatin",
    timing: "Even small amounts can cause interaction for 24+ hours",
  },
  {
    drug: "simvastatin",
    drugClass: "statin",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "major",
    mechanism: "Grapefruit inhibits CYP3A4, dramatically increasing statin levels and muscle damage risk",
    recommendation: "AVOID grapefruit and grapefruit juice entirely while on simvastatin",
    timing: "Even small amounts can cause interaction for 24+ hours",
  },
  {
    drug: "lovastatin",
    drugClass: "statin",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "major",
    mechanism: "Grapefruit inhibits CYP3A4, increasing statin levels",
    recommendation: "AVOID grapefruit and grapefruit juice",
  },
  // Note: Pravastatin and rosuvastatin have minimal grapefruit interaction

  // ============================================
  // CALCIUM CHANNEL BLOCKERS (Grapefruit)
  // ============================================
  {
    drug: "amlodipine",
    drugClass: "calcium_channel_blocker",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "moderate",
    mechanism: "Grapefruit inhibits CYP3A4, may increase amlodipine levels",
    recommendation: "Limit grapefruit juice; monitor for dizziness, swelling, low blood pressure",
  },
  {
    drug: "felodipine",
    drugClass: "calcium_channel_blocker",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "major",
    mechanism: "Grapefruit significantly increases felodipine blood levels",
    recommendation: "AVOID grapefruit and grapefruit juice",
  },
  {
    drug: "nifedipine",
    drugClass: "calcium_channel_blocker",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "major",
    mechanism: "Grapefruit increases nifedipine levels, causing excessive blood pressure drop",
    recommendation: "AVOID grapefruit and grapefruit juice",
  },

  // ============================================
  // ACE INHIBITORS (Potassium interactions)
  // ============================================
  {
    drug: "lisinopril",
    drugClass: "ace_inhibitor",
    food: "potassium-rich foods",
    foodCategory: "multiple",
    severity: "moderate",
    mechanism: "ACE inhibitors increase potassium retention; high-potassium foods add to this",
    recommendation: "Moderate intake of bananas, oranges, potatoes, tomatoes; avoid salt substitutes (KCl)",
  },
  {
    drug: "enalapril",
    drugClass: "ace_inhibitor",
    food: "potassium-rich foods",
    foodCategory: "multiple",
    severity: "moderate",
    mechanism: "ACE inhibitors increase potassium retention",
    recommendation: "Avoid excessive potassium-rich foods and salt substitutes",
  },
  {
    drug: "ramipril",
    drugClass: "ace_inhibitor",
    food: "potassium-rich foods",
    foodCategory: "multiple",
    severity: "moderate",
    mechanism: "ACE inhibitors increase potassium retention",
    recommendation: "Moderate potassium intake; avoid salt substitutes",
  },

  // ============================================
  // THYROID MEDICATIONS (Absorption interactions)
  // ============================================
  {
    drug: "levothyroxine",
    drugClass: "thyroid",
    food: "calcium-rich foods",
    foodCategory: "dairy",
    severity: "moderate",
    mechanism: "Calcium binds to levothyroxine, reducing absorption",
    recommendation: "Take levothyroxine 4 hours apart from calcium supplements and dairy products",
    timing: "Separate by 4 hours",
  },
  {
    drug: "levothyroxine",
    drugClass: "thyroid",
    food: "iron-rich foods",
    foodCategory: "multiple",
    severity: "moderate",
    mechanism: "Iron binds to levothyroxine, reducing absorption",
    recommendation: "Take levothyroxine 4 hours apart from iron supplements",
    timing: "Separate by 4 hours",
  },
  {
    drug: "levothyroxine",
    drugClass: "thyroid",
    food: "soy",
    foodCategory: "protein",
    severity: "moderate",
    mechanism: "Soy may interfere with levothyroxine absorption",
    recommendation: "Maintain consistent soy intake; take levothyroxine on empty stomach",
    timing: "30-60 minutes before food",
  },
  {
    drug: "levothyroxine",
    drugClass: "thyroid",
    food: "coffee",
    foodCategory: "beverage",
    severity: "moderate",
    mechanism: "Coffee can reduce levothyroxine absorption",
    recommendation: "Take levothyroxine 30-60 minutes before coffee",
    timing: "Separate by 30-60 minutes",
  },
  {
    drug: "levothyroxine",
    drugClass: "thyroid",
    food: "fiber",
    foodCategory: "multiple",
    severity: "minor",
    mechanism: "High-fiber foods may reduce levothyroxine absorption",
    recommendation: "Take levothyroxine consistently relative to high-fiber meals",
  },

  // ============================================
  // ANTIBIOTICS (Various interactions)
  // ============================================
  {
    drug: "ciprofloxacin",
    drugClass: "fluoroquinolone",
    food: "dairy",
    foodCategory: "dairy",
    severity: "major",
    mechanism: "Calcium in dairy binds to ciprofloxacin, dramatically reducing absorption",
    recommendation: "Take ciprofloxacin 2 hours before or 6 hours after dairy products",
    timing: "Strict separation required",
  },
  {
    drug: "ciprofloxacin",
    drugClass: "fluoroquinolone",
    food: "antacids",
    foodCategory: "supplement",
    severity: "major",
    mechanism: "Aluminum/magnesium antacids bind to ciprofloxacin",
    recommendation: "Take ciprofloxacin 2 hours before or 6 hours after antacids",
    timing: "Strict separation required",
  },
  {
    drug: "tetracycline",
    drugClass: "antibiotic",
    food: "dairy",
    foodCategory: "dairy",
    severity: "major",
    mechanism: "Calcium binds tetracycline, reducing effectiveness",
    recommendation: "Avoid dairy products within 2 hours of taking tetracycline",
    timing: "Separate by 2 hours minimum",
  },
  {
    drug: "doxycycline",
    drugClass: "antibiotic",
    food: "dairy",
    foodCategory: "dairy",
    severity: "moderate",
    mechanism: "Calcium can reduce doxycycline absorption (less than other tetracyclines)",
    recommendation: "Can be taken with food, but separate from dairy by 1-2 hours if possible",
  },
  {
    drug: "metronidazole",
    drugClass: "antibiotic",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Causes severe nausea, vomiting, flushing, headache (disulfiram-like reaction)",
    recommendation: "AVOID ALL alcohol during treatment and for 3 days after finishing",
    timing: "Avoid alcohol for 72 hours after last dose",
  },

  // ============================================
  // MAO INHIBITORS (Tyramine interaction)
  // ============================================
  {
    drug: "phenelzine",
    drugClass: "maoi",
    food: "tyramine-rich foods",
    foodCategory: "multiple",
    severity: "major",
    mechanism: "Tyramine accumulation causes potentially fatal hypertensive crisis",
    recommendation: "AVOID aged cheese, cured meats, fermented foods, soy sauce, draft beer, red wine",
    timing: "Must avoid during treatment and 2 weeks after stopping",
  },
  {
    drug: "tranylcypromine",
    drugClass: "maoi",
    food: "tyramine-rich foods",
    foodCategory: "multiple",
    severity: "major",
    mechanism: "Tyramine accumulation causes potentially fatal hypertensive crisis",
    recommendation: "AVOID aged cheese, cured meats, fermented foods, soy sauce, draft beer, red wine",
    timing: "Must avoid during treatment and 2 weeks after stopping",
  },
  {
    drug: "selegiline",
    drugClass: "maoi",
    food: "tyramine-rich foods",
    foodCategory: "multiple",
    severity: "moderate",
    mechanism: "At higher doses, can cause tyramine interaction",
    recommendation: "Moderate tyramine restriction recommended",
  },

  // ============================================
  // DIABETES MEDICATIONS
  // ============================================
  {
    drug: "metformin",
    drugClass: "biguanide",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Alcohol increases risk of lactic acidosis with metformin",
    recommendation: "Limit alcohol consumption; avoid heavy drinking",
  },
  {
    drug: "glipizide",
    drugClass: "sulfonylurea",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Alcohol can cause unpredictable blood sugar changes and severe hypoglycemia",
    recommendation: "Limit alcohol; always eat when drinking; monitor blood sugar closely",
  },
  {
    drug: "insulin",
    drugClass: "insulin",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Alcohol can mask hypoglycemia symptoms and cause delayed low blood sugar",
    recommendation: "Limit alcohol; always eat carbs when drinking; monitor closely",
  },

  // ============================================
  // BENZODIAZEPINES & SEDATIVES
  // ============================================
  {
    drug: "alprazolam",
    drugClass: "benzodiazepine",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "moderate",
    mechanism: "Grapefruit increases alprazolam levels, enhancing sedation",
    recommendation: "Avoid grapefruit juice",
  },
  {
    drug: "alprazolam",
    drugClass: "benzodiazepine",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Additive CNS depression - dangerous respiratory depression possible",
    recommendation: "AVOID alcohol while taking benzodiazepines",
  },
  {
    drug: "lorazepam",
    drugClass: "benzodiazepine",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Additive CNS depression - dangerous respiratory depression possible",
    recommendation: "AVOID alcohol while taking benzodiazepines",
  },
  {
    drug: "diazepam",
    drugClass: "benzodiazepine",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Additive CNS depression - dangerous respiratory depression possible",
    recommendation: "AVOID alcohol while taking benzodiazepines",
  },

  // ============================================
  // OPIOIDS
  // ============================================
  {
    drug: "oxycodone",
    drugClass: "opioid",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Additive CNS and respiratory depression - potentially fatal",
    recommendation: "AVOID alcohol completely while taking opioids",
  },
  {
    drug: "hydrocodone",
    drugClass: "opioid",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Additive CNS and respiratory depression - potentially fatal",
    recommendation: "AVOID alcohol completely while taking opioids",
  },
  {
    drug: "tramadol",
    drugClass: "opioid",
    food: "alcohol",
    foodCategory: "beverage",
    severity: "major",
    mechanism: "Additive CNS depression; increases seizure risk",
    recommendation: "AVOID alcohol while taking tramadol",
  },
  {
    drug: "fentanyl",
    drugClass: "opioid",
    food: "grapefruit",
    foodCategory: "fruit",
    severity: "major",
    mechanism: "Grapefruit increases fentanyl levels, potentially causing overdose",
    recommendation: "AVOID grapefruit and grapefruit juice",
  },

  // ============================================
  // HEART MEDICATIONS
  // ============================================
  {
    drug: "digoxin",
    drugClass: "cardiac_glycoside",
    food: "fiber",
    foodCategory: "multiple",
    severity: "minor",
    mechanism: "High-fiber diets may reduce digoxin absorption",
    recommendation: "Maintain consistent fiber intake; don't suddenly change diet",
  },
  {
    drug: "digoxin",
    drugClass: "cardiac_glycoside",
    food: "licorice",
    foodCategory: "food",
    severity: "moderate",
    mechanism: "Natural licorice causes potassium loss, increasing digoxin toxicity risk",
    recommendation: "Avoid natural licorice (glycyrrhizin); artificial licorice flavoring is OK",
  },
  {
    drug: "spironolactone",
    drugClass: "potassium_sparing_diuretic",
    food: "potassium-rich foods",
    foodCategory: "multiple",
    severity: "moderate",
    mechanism: "Spironolactone causes potassium retention; high-K foods add to this",
    recommendation: "Moderate intake of high-potassium foods; avoid salt substitutes",
  },

  // ============================================
  // BISPHOSPHONATES (Bone medications)
  // ============================================
  {
    drug: "alendronate",
    drugClass: "bisphosphonate",
    food: "any food",
    foodCategory: "any",
    severity: "major",
    mechanism: "Food dramatically reduces absorption (by up to 60%)",
    recommendation: "Take on EMPTY stomach with plain water only; wait 30+ min before eating",
    timing: "30-60 minutes before any food, drink, or other medications",
  },
  {
    drug: "risedronate",
    drugClass: "bisphosphonate",
    food: "any food",
    foodCategory: "any",
    severity: "major",
    mechanism: "Food dramatically reduces absorption",
    recommendation: "Take on EMPTY stomach with plain water only; wait 30+ min before eating",
    timing: "30-60 minutes before any food",
  },

  // ============================================
  // PROTON PUMP INHIBITORS
  // ============================================
  {
    drug: "omeprazole",
    drugClass: "ppi",
    food: "any food",
    foodCategory: "any",
    severity: "minor",
    mechanism: "Food delays but doesn't significantly reduce absorption",
    recommendation: "Best taken 30-60 minutes before meals for maximum effectiveness",
    timing: "Before meals",
  },
];

/**
 * Check for food-drug interactions given a patient's medications and a food item
 */
export function checkFoodDrugInteractions(
  medications: Array<{ name: string }>,
  foodQuery: string
): FoodDrugInteraction[] {
  const interactions: FoodDrugInteraction[] = [];
  const medNamesLower = medications.map((m) => m.name.toLowerCase());
  const foodLower = foodQuery.toLowerCase();

  // Map food queries to food categories/keywords
  const foodMappings: Record<string, string[]> = {
    grapefruit: ["grapefruit", "pomelo", "tangelo"],
    leafy_greens: ["spinach", "kale", "lettuce", "collard", "swiss chard", "arugula", "romaine", "greens", "salad"],
    dairy: ["milk", "cheese", "yogurt", "cream", "butter", "ice cream", "dairy", "calcium"],
    alcohol: ["alcohol", "beer", "wine", "vodka", "whiskey", "rum", "cocktail", "liquor", "drink"],
    coffee: ["coffee", "espresso", "caffeine", "latte", "cappuccino"],
    tyramine: ["aged cheese", "cured meat", "salami", "pepperoni", "soy sauce", "fermented", "kimchi", "sauerkraut", "miso"],
    potassium: ["banana", "orange", "potato", "tomato", "avocado", "spinach", "sweet potato", "coconut water"],
    fiber: ["whole grain", "bran", "oats", "beans", "lentils", "fiber", "vegetables"],
    soy: ["soy", "tofu", "edamame", "soy milk", "tempeh", "miso"],
    cranberry: ["cranberry", "cranberries"],
    garlic: ["garlic"],
    ginger: ["ginger"],
    licorice: ["licorice", "liquorice"],
  };

  // Determine which food categories match the query
  const matchedCategories: string[] = [];
  for (const [category, keywords] of Object.entries(foodMappings)) {
    if (keywords.some((kw) => foodLower.includes(kw))) {
      matchedCategories.push(category);
    }
  }

  // Check each interaction
  for (const interaction of FOOD_DRUG_INTERACTIONS) {
    // Check if patient is on this drug
    const drugMatch = medNamesLower.some((med) =>
      med.includes(interaction.drug.toLowerCase()) ||
      (interaction.drugClass && med.includes(interaction.drugClass.replace("_", " ")))
    );

    if (!drugMatch) continue;

    // Check if food matches
    const interactionFoodLower = interaction.food.toLowerCase();
    let foodMatch = false;

    // Direct match
    if (foodLower.includes(interactionFoodLower) || interactionFoodLower.includes(foodLower)) {
      foodMatch = true;
    }

    // Category match
    if (!foodMatch) {
      const interactionCategories = Object.entries(foodMappings)
        .filter(([, keywords]) => keywords.some((kw) => interactionFoodLower.includes(kw)))
        .map(([cat]) => cat);

      foodMatch = matchedCategories.some((cat) => interactionCategories.includes(cat));
    }

    // Special case for "any food" (bisphosphonates)
    if (interactionFoodLower === "any food") {
      foodMatch = true;
    }

    if (foodMatch) {
      // Avoid duplicate interactions
      const exists = interactions.some(
        (i) => i.drug === interaction.drug && i.food === interaction.food
      );
      if (!exists) {
        interactions.push(interaction);
      }
    }
  }

  return interactions;
}

/**
 * Get all food-drug interactions for a patient's medication list
 */
export function getAllFoodInteractionsForMedications(
  medications: Array<{ name: string }>
): FoodDrugInteraction[] {
  const interactions: FoodDrugInteraction[] = [];
  const medNamesLower = medications.map((m) => m.name.toLowerCase());

  for (const interaction of FOOD_DRUG_INTERACTIONS) {
    const drugMatch = medNamesLower.some((med) =>
      med.includes(interaction.drug.toLowerCase())
    );

    if (drugMatch) {
      interactions.push(interaction);
    }
  }

  // Remove duplicates (same drug-food pair)
  const unique = interactions.filter(
    (item, index, self) =>
      index === self.findIndex((t) => t.drug === item.drug && t.food === item.food)
  );

  return unique;
}

/**
 * Get foods to avoid and foods that need timing adjustments for a patient
 */
export function getFoodGuidanceForPatient(
  medications: Array<{ name: string }>
): {
  mustAvoid: FoodDrugInteraction[];
  needsTiming: FoodDrugInteraction[];
  limitIntake: FoodDrugInteraction[];
} {
  const allInteractions = getAllFoodInteractionsForMedications(medications);

  const mustAvoid = allInteractions.filter(
    (i) =>
      i.severity === "major" &&
      (i.recommendation.toLowerCase().includes("avoid") ||
        i.recommendation.toLowerCase().includes("do not"))
  );

  const needsTiming = allInteractions.filter(
    (i) =>
      i.timing ||
      i.recommendation.toLowerCase().includes("separate") ||
      i.recommendation.toLowerCase().includes("before") ||
      i.recommendation.toLowerCase().includes("after") ||
      i.recommendation.toLowerCase().includes("apart")
  );

  const limitIntake = allInteractions.filter(
    (i) =>
      !mustAvoid.includes(i) &&
      !needsTiming.includes(i) &&
      (i.recommendation.toLowerCase().includes("limit") ||
        i.recommendation.toLowerCase().includes("moderate") ||
        i.recommendation.toLowerCase().includes("consistent"))
  );

  return { mustAvoid, needsTiming, limitIntake };
}
