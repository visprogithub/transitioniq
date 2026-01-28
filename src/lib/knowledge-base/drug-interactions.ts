/**
 * Drug-Drug Interaction Database - Serverless Compatible
 *
 * Simulates FDB Drug Interactions / Medi-Span DDI database structure
 * Bundled as static data for Vercel deployment - no external DB required
 *
 * Interaction severity levels follow standard clinical classifications:
 * - Contraindicated: Should never be used together
 * - Major: Life-threatening or permanent damage potential
 * - Moderate: May require intervention or monitoring
 * - Minor: Minimal clinical significance
 */

export interface DrugInteraction {
  drug1: DrugIdentifier;
  drug2: DrugIdentifier;
  severity: "contraindicated" | "major" | "moderate" | "minor";
  clinicalEffect: string;
  mechanism: string;
  managementRecommendation: string;
  patientCounseling: string;
  monitoringParameters: string[];
  documentation: "established" | "probable" | "suspected" | "possible";
  onsetTime: "rapid" | "delayed" | "variable";
  references: string[];
}

export interface DrugIdentifier {
  genericName: string;
  drugClass?: string;
  rxcui?: string;
}

/**
 * Comprehensive drug interaction database
 * Structure based on FDB/Medi-Span clinical classification
 */
export const DRUG_INTERACTIONS: DrugInteraction[] = [
  // ===== ANTICOAGULANT INTERACTIONS =====
  {
    drug1: { genericName: "warfarin", drugClass: "Vitamin K antagonist" },
    drug2: { genericName: "aspirin", drugClass: "NSAID/Antiplatelet" },
    severity: "major",
    clinicalEffect: "Significantly increased risk of bleeding, including intracranial and gastrointestinal hemorrhage",
    mechanism: "Warfarin inhibits vitamin K-dependent clotting factors; aspirin inhibits platelet aggregation and may cause GI mucosal damage",
    managementRecommendation: "If combination required (e.g., mechanical valve + CAD), use lowest effective aspirin dose (81mg). Monitor closely for bleeding.",
    patientCounseling: "You're taking two blood thinners together. Watch carefully for unusual bleeding, bruising, blood in stool/urine, or prolonged bleeding from cuts. Report any signs immediately.",
    monitoringParameters: ["INR more frequently", "Hemoglobin/hematocrit", "Signs of bleeding"],
    documentation: "established",
    onsetTime: "rapid",
    references: ["FDA Drug Safety Communication", "ACCP Guidelines"],
  },
  {
    drug1: { genericName: "warfarin", drugClass: "Vitamin K antagonist" },
    drug2: { genericName: "apixaban", drugClass: "Factor Xa inhibitor" },
    severity: "contraindicated",
    clinicalEffect: "Extreme bleeding risk - double anticoagulation provides no additional benefit with dramatically increased hemorrhage risk",
    mechanism: "Both drugs prevent blood clotting through different mechanisms; combined effect is excessive anticoagulation",
    managementRecommendation: "Do not use together. When switching between agents, appropriate washout period required.",
    patientCounseling: "These two blood thinners should never be taken together. If you have both medications, contact your doctor immediately - this may be an error.",
    monitoringParameters: ["Should not be co-administered"],
    documentation: "established",
    onsetTime: "rapid",
    references: ["Product labeling", "ISTH Guidelines"],
  },
  {
    drug1: { genericName: "warfarin", drugClass: "Vitamin K antagonist" },
    drug2: { genericName: "ibuprofen", drugClass: "NSAID" },
    severity: "major",
    clinicalEffect: "Increased bleeding risk, especially GI bleeding; NSAIDs may also increase INR",
    mechanism: "NSAIDs inhibit platelet function, cause GI mucosal damage, and may displace warfarin from protein binding",
    managementRecommendation: "Avoid if possible. If NSAID needed, use lowest dose for shortest duration. Consider acetaminophen as alternative.",
    patientCounseling: "Ibuprofen (Advil, Motrin) can increase your bleeding risk with warfarin. Use acetaminophen (Tylenol) for pain instead, unless your doctor specifically approves an NSAID.",
    monitoringParameters: ["INR", "Signs of GI bleeding", "Blood pressure"],
    documentation: "established",
    onsetTime: "rapid",
    references: ["ACCP Guidelines", "FDA Warning"],
  },

  // ===== ACE INHIBITOR INTERACTIONS =====
  {
    drug1: { genericName: "lisinopril", drugClass: "ACE inhibitor" },
    drug2: { genericName: "potassium chloride", drugClass: "Potassium supplement" },
    severity: "moderate",
    clinicalEffect: "Risk of hyperkalemia (dangerously high potassium levels)",
    mechanism: "ACE inhibitors reduce aldosterone, decreasing potassium excretion. Additional potassium can lead to accumulation.",
    managementRecommendation: "Monitor potassium levels closely if combination necessary. Consider dietary potassium restriction.",
    patientCounseling: "Your blood pressure medication can increase potassium levels. Don't take potassium supplements or use salt substitutes (which contain potassium) without your doctor's approval.",
    monitoringParameters: ["Serum potassium within 1 week, then periodically", "Renal function", "ECG if potassium elevated"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["Product labeling", "Clinical guidelines"],
  },
  {
    drug1: { genericName: "lisinopril", drugClass: "ACE inhibitor" },
    drug2: { genericName: "spironolactone", drugClass: "Potassium-sparing diuretic" },
    severity: "moderate",
    clinicalEffect: "Increased risk of hyperkalemia",
    mechanism: "Both drugs independently increase serum potassium through different mechanisms",
    managementRecommendation: "Used together in heart failure with careful monitoring. Start spironolactone at low dose. Monitor potassium frequently.",
    patientCounseling: "Both medications can raise your potassium level. Your doctor will monitor this with blood tests. Report muscle weakness, irregular heartbeat, or tingling.",
    monitoringParameters: ["Serum potassium", "Renal function", "Blood pressure"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["ACCF/AHA Heart Failure Guidelines"],
  },

  // ===== DIGOXIN INTERACTIONS =====
  {
    drug1: { genericName: "digoxin", drugClass: "Cardiac glycoside" },
    drug2: { genericName: "amiodarone", drugClass: "Antiarrhythmic" },
    severity: "major",
    clinicalEffect: "Digoxin toxicity - amiodarone increases digoxin levels by 70-100%",
    mechanism: "Amiodarone inhibits P-glycoprotein and reduces renal/non-renal clearance of digoxin",
    managementRecommendation: "Reduce digoxin dose by 50% when starting amiodarone. Monitor digoxin levels and for signs of toxicity.",
    patientCounseling: "When starting amiodarone, your digoxin dose will be reduced. Watch for nausea, vision changes (yellow halos), or irregular heartbeat and report immediately.",
    monitoringParameters: ["Digoxin level", "Heart rate/rhythm", "Symptoms of toxicity"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["Product labeling", "Clinical studies"],
  },
  {
    drug1: { genericName: "digoxin", drugClass: "Cardiac glycoside" },
    drug2: { genericName: "furosemide", drugClass: "Loop diuretic" },
    severity: "moderate",
    clinicalEffect: "Increased risk of digoxin toxicity due to diuretic-induced hypokalemia and hypomagnesemia",
    mechanism: "Loop diuretics cause potassium and magnesium loss; low levels of these electrolytes increase cardiac sensitivity to digoxin",
    managementRecommendation: "Monitor and maintain normal potassium and magnesium levels. May need potassium supplementation.",
    patientCounseling: "Your water pill can lower potassium, which makes digoxin more likely to cause side effects. You may need to take potassium supplements and eat potassium-rich foods.",
    monitoringParameters: ["Serum potassium", "Serum magnesium", "Digoxin level", "Heart rhythm"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["Clinical pharmacology", "Heart failure guidelines"],
  },

  // ===== STATIN INTERACTIONS =====
  {
    drug1: { genericName: "atorvastatin", drugClass: "HMG-CoA reductase inhibitor" },
    drug2: { genericName: "gemfibrozil", drugClass: "Fibrate" },
    severity: "major",
    clinicalEffect: "Significantly increased risk of rhabdomyolysis (severe muscle breakdown)",
    mechanism: "Gemfibrozil inhibits statin glucuronidation, dramatically increasing statin exposure",
    managementRecommendation: "Avoid combination. If fibrate needed with statin, fenofibrate is preferred (lower interaction risk).",
    patientCounseling: "This combination significantly increases the risk of severe muscle damage. If you experience unexplained muscle pain, tenderness, or weakness with dark urine, stop the medications and seek immediate medical attention.",
    monitoringParameters: ["CK levels if symptoms occur", "Muscle symptoms", "Renal function"],
    documentation: "established",
    onsetTime: "variable",
    references: ["FDA Drug Safety Communication", "Product labeling"],
  },
  {
    drug1: { genericName: "simvastatin", drugClass: "HMG-CoA reductase inhibitor" },
    drug2: { genericName: "amlodipine", drugClass: "Calcium channel blocker" },
    severity: "moderate",
    clinicalEffect: "Increased simvastatin levels and risk of myopathy",
    mechanism: "Amlodipine inhibits CYP3A4, reducing simvastatin metabolism",
    managementRecommendation: "Limit simvastatin to 20mg daily when used with amlodipine. Consider alternative statin.",
    patientCounseling: "Your blood pressure medication can increase statin levels. Report any unexplained muscle pain or weakness.",
    monitoringParameters: ["Muscle symptoms", "CK if symptomatic"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["FDA Drug Safety Communication"],
  },

  // ===== METFORMIN INTERACTIONS =====
  {
    drug1: { genericName: "metformin", drugClass: "Biguanide" },
    drug2: { genericName: "iodinated contrast", drugClass: "Contrast media" },
    severity: "major",
    clinicalEffect: "Risk of contrast-induced nephropathy leading to metformin accumulation and lactic acidosis",
    mechanism: "Contrast can impair renal function; if metformin accumulates due to reduced clearance, lactic acidosis may occur",
    managementRecommendation: "Hold metformin on day of procedure and for 48 hours after. Restart only after renal function confirmed stable.",
    patientCounseling: "If you're having a CT scan or other test with contrast dye, tell them you take metformin. You'll need to stop it temporarily and restart after your kidney function is checked.",
    monitoringParameters: ["Renal function before and 48h after contrast", "Signs of lactic acidosis"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["ACR Manual on Contrast Media", "Product labeling"],
  },

  // ===== SEROTONERGIC INTERACTIONS =====
  {
    drug1: { genericName: "sertraline", drugClass: "SSRI" },
    drug2: { genericName: "tramadol", drugClass: "Opioid analgesic" },
    severity: "major",
    clinicalEffect: "Risk of serotonin syndrome - potentially life-threatening",
    mechanism: "Both drugs increase serotonergic activity; combined effect can cause serotonin syndrome",
    managementRecommendation: "Use with caution if combination necessary. Start tramadol at low dose. Educate patient on serotonin syndrome symptoms.",
    patientCounseling: "Watch for agitation, confusion, rapid heartbeat, fever, muscle twitching, or diarrhea. These could be signs of a serious reaction. Seek immediate medical attention if they occur.",
    monitoringParameters: ["Signs of serotonin syndrome", "Mental status", "Vital signs"],
    documentation: "established",
    onsetTime: "rapid",
    references: ["FDA Drug Safety Communication"],
  },

  // ===== QT PROLONGATION INTERACTIONS =====
  {
    drug1: { genericName: "amiodarone", drugClass: "Antiarrhythmic" },
    drug2: { genericName: "azithromycin", drugClass: "Macrolide antibiotic" },
    severity: "major",
    clinicalEffect: "Additive QT prolongation - risk of torsades de pointes",
    mechanism: "Both drugs independently prolong QT interval; combined effect increases arrhythmia risk",
    managementRecommendation: "Avoid if possible. If necessary, monitor ECG and electrolytes closely.",
    patientCounseling: "This antibiotic can affect your heart rhythm, especially with your heart medication. Report any dizziness, fainting, or palpitations immediately.",
    monitoringParameters: ["ECG (QTc)", "Electrolytes (K, Mg)", "Symptoms of arrhythmia"],
    documentation: "probable",
    onsetTime: "variable",
    references: ["CredibleMeds QT database", "Clinical studies"],
  },

  // ===== OPIOID INTERACTIONS =====
  {
    drug1: { genericName: "oxycodone", drugClass: "Opioid analgesic" },
    drug2: { genericName: "gabapentin", drugClass: "Gabapentinoid" },
    severity: "major",
    clinicalEffect: "Increased risk of profound sedation, respiratory depression, coma, and death",
    mechanism: "Additive CNS depressant effects",
    managementRecommendation: "If combination necessary, use lowest effective doses and shortest duration. Monitor closely for respiratory depression.",
    patientCounseling: "Both medications can cause drowsiness. Taking them together significantly increases this risk. Never take more than prescribed. Don't drive or operate machinery. Seek help immediately if you have trouble breathing or extreme drowsiness.",
    monitoringParameters: ["Respiratory rate", "Sedation level", "Pain control"],
    documentation: "established",
    onsetTime: "rapid",
    references: ["FDA Boxed Warning", "CDC Opioid Guidelines"],
  },
  {
    drug1: { genericName: "methadone", drugClass: "Opioid" },
    drug2: { genericName: "benzodiazepines", drugClass: "Benzodiazepine" },
    severity: "contraindicated",
    clinicalEffect: "Profound sedation, respiratory depression, coma, and death",
    mechanism: "Additive CNS and respiratory depression",
    managementRecommendation: "Avoid concomitant use. If absolutely necessary, limit dosages and duration to minimum required.",
    patientCounseling: "Taking benzodiazepines (like Xanax, Valium, Ativan) with methadone is extremely dangerous. This combination causes many overdose deaths. If prescribed both, use extreme caution and have naloxone available.",
    monitoringParameters: ["Respiratory status", "Mental status", "Signs of overdose"],
    documentation: "established",
    onsetTime: "rapid",
    references: ["FDA Boxed Warning"],
  },

  // ===== THYROID INTERACTIONS =====
  {
    drug1: { genericName: "levothyroxine", drugClass: "Thyroid hormone" },
    drug2: { genericName: "calcium carbonate", drugClass: "Calcium supplement" },
    severity: "moderate",
    clinicalEffect: "Reduced levothyroxine absorption leading to hypothyroidism",
    mechanism: "Calcium binds to levothyroxine in GI tract, forming insoluble complex that reduces absorption",
    managementRecommendation: "Separate administration by at least 4 hours. Take levothyroxine first thing in morning, calcium later.",
    patientCounseling: "Take your thyroid medication at least 4 hours before or after calcium supplements or antacids. Take thyroid medication first thing in the morning on an empty stomach.",
    monitoringParameters: ["TSH", "Free T4", "Hypothyroid symptoms"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["Product labeling", "Clinical studies"],
  },
  {
    drug1: { genericName: "levothyroxine", drugClass: "Thyroid hormone" },
    drug2: { genericName: "ferrous sulfate", drugClass: "Iron supplement" },
    severity: "moderate",
    clinicalEffect: "Reduced levothyroxine absorption",
    mechanism: "Iron binds to levothyroxine forming poorly absorbed complex",
    managementRecommendation: "Separate administration by at least 4 hours",
    patientCounseling: "Take your thyroid medication at least 4 hours before or after iron supplements. Take thyroid medication first thing in the morning.",
    monitoringParameters: ["TSH", "Hypothyroid symptoms"],
    documentation: "established",
    onsetTime: "delayed",
    references: ["Product labeling"],
  },
];

/**
 * Check for interactions between two drugs
 */
export function checkDrugInteraction(
  drug1: string,
  drug2: string
): DrugInteraction | null {
  const d1 = drug1.toLowerCase();
  const d2 = drug2.toLowerCase();

  for (const interaction of DRUG_INTERACTIONS) {
    const match1 =
      interaction.drug1.genericName.toLowerCase().includes(d1) ||
      d1.includes(interaction.drug1.genericName.toLowerCase()) ||
      (interaction.drug1.drugClass &&
        interaction.drug1.drugClass.toLowerCase().includes(d1));

    const match2 =
      interaction.drug2.genericName.toLowerCase().includes(d2) ||
      d2.includes(interaction.drug2.genericName.toLowerCase()) ||
      (interaction.drug2.drugClass &&
        interaction.drug2.drugClass.toLowerCase().includes(d2));

    // Check both directions
    if ((match1 && match2) || (match1 && d2.includes(interaction.drug2.genericName.toLowerCase())) ||
        (match2 && d1.includes(interaction.drug1.genericName.toLowerCase()))) {
      return interaction;
    }

    // Also check reverse order
    const reverseMatch1 =
      interaction.drug1.genericName.toLowerCase().includes(d2) ||
      d2.includes(interaction.drug1.genericName.toLowerCase());

    const reverseMatch2 =
      interaction.drug2.genericName.toLowerCase().includes(d1) ||
      d1.includes(interaction.drug2.genericName.toLowerCase());

    if (reverseMatch1 && reverseMatch2) {
      return interaction;
    }
  }

  return null;
}

/**
 * Check multiple drugs for interactions (returns all found)
 */
export function checkMultipleDrugInteractions(
  medications: string[]
): DrugInteraction[] {
  const interactions: DrugInteraction[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < medications.length; i++) {
    for (let j = i + 1; j < medications.length; j++) {
      const interaction = checkDrugInteraction(medications[i], medications[j]);
      if (interaction) {
        const key = [medications[i], medications[j]].sort().join("|");
        if (!seen.has(key)) {
          interactions.push(interaction);
          seen.add(key);
        }
      }
    }
  }

  // Sort by severity
  const severityOrder = { contraindicated: 0, major: 1, moderate: 2, minor: 3 };
  return interactions.sort(
    (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
  );
}

/**
 * Get patient-friendly interaction summary
 */
export function getPatientFriendlyInteraction(interaction: DrugInteraction): {
  severity: string;
  message: string;
  action: string;
} {
  const severityMessages = {
    contraindicated: "🚫 DANGER",
    major: "⚠️ SERIOUS",
    moderate: "⚡ CAUTION",
    minor: "ℹ️ MINOR",
  };

  return {
    severity: severityMessages[interaction.severity],
    message: interaction.patientCounseling,
    action: interaction.managementRecommendation,
  };
}
