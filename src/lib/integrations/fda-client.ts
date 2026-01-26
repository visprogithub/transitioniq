/**
 * FDA Drug Interactions Client
 * Uses OpenFDA API for drug safety data and RxNorm for drug interactions
 */

const OPENFDA_BASE = "https://api.fda.gov/drug";
const RXNORM_BASE = "https://rxnav.nlm.nih.gov/REST";

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
  try {
    const url = `${RXNORM_BASE}/rxcui.json?name=${encodeURIComponent(drugName)}&search=2`;
    const response = await fetch(url);
    const data = await response.json();
    return data?.idGroup?.rxnormId?.[0] || null;
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
    const data: RxNormInteractionResponse = await response.json();

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

  // Check known high-risk combinations manually if API doesn't return them
  const knownInteractions = checkKnownHighRiskCombinations(medications);
  for (const known of knownInteractions) {
    if (!interactions.some((i) =>
      (i.drug1.toLowerCase().includes(known.drug1.toLowerCase()) && i.drug2.toLowerCase().includes(known.drug2.toLowerCase())) ||
      (i.drug1.toLowerCase().includes(known.drug2.toLowerCase()) && i.drug2.toLowerCase().includes(known.drug1.toLowerCase()))
    )) {
      interactions.push(known);
    }
  }

  return interactions;
}

/**
 * Known high-risk drug combinations for clinical decision support
 */
function checkKnownHighRiskCombinations(
  medications: Array<{ name: string }>
): DrugInteraction[] {
  const interactions: DrugInteraction[] = [];
  const medNames = medications.map((m) => m.name.toLowerCase());

  // Warfarin + Aspirin
  if (medNames.some((m) => m.includes("warfarin")) && medNames.some((m) => m.includes("aspirin"))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Aspirin",
      severity: "major",
      description:
        "Concurrent use increases bleeding risk significantly. Monitor INR closely and watch for signs of bleeding.",
      source: "Clinical Guidelines",
    });
  }

  // Warfarin + Eliquis (Apixaban) - double anticoagulation
  if (medNames.some((m) => m.includes("warfarin")) &&
      (medNames.some((m) => m.includes("eliquis")) || medNames.some((m) => m.includes("apixaban")))) {
    interactions.push({
      drug1: "Warfarin",
      drug2: "Eliquis (Apixaban)",
      severity: "major",
      description:
        "Dual anticoagulation therapy significantly increases bleeding risk. Generally contraindicated unless specific clinical indication.",
      source: "Clinical Guidelines",
    });
  }

  // ACE inhibitor + Potassium supplements
  if ((medNames.some((m) => m.includes("lisinopril")) || medNames.some((m) => m.includes("enalapril"))) &&
      medNames.some((m) => m.includes("potassium"))) {
    interactions.push({
      drug1: "ACE Inhibitor",
      drug2: "Potassium Chloride",
      severity: "moderate",
      description:
        "ACE inhibitors can increase potassium levels. Combined with potassium supplements, risk of hyperkalemia increases.",
      source: "Clinical Guidelines",
    });
  }

  // Metformin + Contrast dye (flagged by presence of renal impairment indicators)
  if (medNames.some((m) => m.includes("metformin"))) {
    interactions.push({
      drug1: "Metformin",
      drug2: "Renal Function",
      severity: "moderate",
      description:
        "Metformin should be held before IV contrast procedures and for 48 hours after if creatinine is elevated.",
      source: "Clinical Guidelines",
    });
  }

  // Digoxin + Amiodarone
  if (medNames.some((m) => m.includes("digoxin")) && medNames.some((m) => m.includes("amiodarone"))) {
    interactions.push({
      drug1: "Digoxin",
      drug2: "Amiodarone",
      severity: "major",
      description:
        "Amiodarone increases digoxin levels by 70-100%. Reduce digoxin dose by 50% when starting amiodarone.",
      source: "Clinical Guidelines",
    });
  }

  // Statin + Fibrate
  if ((medNames.some((m) => m.includes("atorvastatin")) || medNames.some((m) => m.includes("simvastatin"))) &&
      medNames.some((m) => m.includes("gemfibrozil"))) {
    interactions.push({
      drug1: "Statin",
      drug2: "Gemfibrozil",
      severity: "major",
      description:
        "Increased risk of myopathy and rhabdomyolysis. Consider alternative lipid-lowering therapy.",
      source: "Clinical Guidelines",
    });
  }

  return interactions;
}

/**
 * Get FDA adverse event reports (FAERS) count for a drug
 */
export async function getFAERSCount(drugName: string): Promise<number> {
  try {
    const url = `${OPENFDA_BASE}/event.json?search=patient.drug.medicinalproduct:"${encodeURIComponent(drugName)}"&count=receivedate`;
    const response = await fetch(url);

    if (!response.ok) {
      return 0;
    }

    const data: OpenFDAResponse = await response.json();
    return data.meta?.results?.total || 0;
  } catch (error) {
    console.error(`FAERS lookup failed for ${drugName}:`, error);
    return 0;
  }
}

/**
 * Get drug safety information from FDA labels
 */
export async function getDrugSafetyInfo(drugName: string): Promise<DrugSafetyInfo | null> {
  try {
    const url = `${OPENFDA_BASE}/label.json?search=openfda.brand_name:"${encodeURIComponent(drugName)}"+openfda.generic_name:"${encodeURIComponent(drugName)}"&limit=1`;
    const response = await fetch(url);

    if (!response.ok) {
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
      return null;
    }

    return {
      drugName: label.openfda?.brand_name?.[0] || label.openfda?.generic_name?.[0] || drugName,
      boxedWarning: label.boxed_warning?.[0],
      warnings: label.warnings || [],
      adverseReactions: label.adverse_reactions || [],
      contraindications: label.contraindications || [],
    };
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
