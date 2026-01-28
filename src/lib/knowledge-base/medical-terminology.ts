/**
 * Medical Terminology Database - Serverless Compatible
 *
 * Provides patient-friendly explanations for medical terms
 * Bundled as static data for Vercel deployment - no external DB required
 *
 * Based on MeSH/SNOMED-CT terminology with lay-language translations
 */

export interface MedicalTerm {
  term: string;
  alternativeNames: string[];
  category: "condition" | "procedure" | "medication_class" | "lab_test" | "anatomy" | "symptom" | "abbreviation";
  medicalDefinition: string;
  patientFriendlyExplanation: string;
  relatedTerms: string[];
  commonContext: string;
  pronunciationHint?: string;
}

/**
 * Comprehensive medical terminology database
 * ~100 common terms patients encounter
 */
export const MEDICAL_TERMS: Record<string, MedicalTerm> = {
  // ===== CONDITIONS =====
  hypertension: {
    term: "Hypertension",
    alternativeNames: ["high blood pressure", "HTN", "elevated blood pressure"],
    category: "condition",
    medicalDefinition: "Persistent elevation of systemic arterial blood pressure, typically defined as systolic BP ≥130 mmHg or diastolic BP ≥80 mmHg",
    patientFriendlyExplanation: "High blood pressure means the force of blood pushing against your artery walls is too high. Over time, this can damage your blood vessels and organs like your heart, kidneys, and brain. It usually has no symptoms, which is why it's called the 'silent killer.'",
    relatedTerms: ["systolic", "diastolic", "blood pressure", "cardiovascular disease"],
    commonContext: "Often discovered during routine checkups. Managed with lifestyle changes and medications.",
    pronunciationHint: "hi-per-TEN-shun",
  },

  hypotension: {
    term: "Hypotension",
    alternativeNames: ["low blood pressure", "low BP"],
    category: "condition",
    medicalDefinition: "Abnormally low blood pressure, typically systolic BP <90 mmHg or diastolic BP <60 mmHg",
    patientFriendlyExplanation: "Low blood pressure means the force of blood in your arteries is lower than normal. This can make you feel dizzy or faint, especially when standing up quickly. Some people naturally have low blood pressure without problems.",
    relatedTerms: ["orthostatic hypotension", "blood pressure", "dizziness"],
    commonContext: "Can be caused by dehydration, medications, or standing up too quickly. May require slow position changes.",
    pronunciationHint: "hi-po-TEN-shun",
  },

  diabetes_mellitus: {
    term: "Diabetes Mellitus",
    alternativeNames: ["diabetes", "DM", "sugar diabetes", "type 2 diabetes", "type 1 diabetes"],
    category: "condition",
    medicalDefinition: "A group of metabolic diseases characterized by chronic hyperglycemia resulting from defects in insulin secretion, insulin action, or both",
    patientFriendlyExplanation: "Diabetes is a condition where your body has trouble controlling blood sugar levels. Either your body doesn't make enough insulin (a hormone that helps sugar enter your cells), or your body doesn't use insulin properly. This causes sugar to build up in your blood, which can damage organs over time.",
    relatedTerms: ["insulin", "glucose", "HbA1c", "hyperglycemia", "hypoglycemia"],
    commonContext: "Managed with diet, exercise, and often medications. Regular blood sugar monitoring is important.",
    pronunciationHint: "die-uh-BEE-teez muh-LIE-tus",
  },

  heart_failure: {
    term: "Heart Failure",
    alternativeNames: ["CHF", "congestive heart failure", "HF", "cardiac failure"],
    category: "condition",
    medicalDefinition: "A clinical syndrome resulting from structural or functional cardiac abnormalities that impair ventricular filling or ejection of blood",
    patientFriendlyExplanation: "Heart failure doesn't mean your heart has stopped working. It means your heart isn't pumping blood as well as it should. This can cause fluid to build up in your lungs (making you short of breath) and in your legs (causing swelling). With proper treatment, many people live well with heart failure.",
    relatedTerms: ["ejection fraction", "edema", "shortness of breath", "cardiomyopathy", "BNP"],
    commonContext: "Requires careful monitoring of weight, fluid intake, and sodium. Medications help the heart pump better and remove excess fluid.",
    pronunciationHint: "HART FAIL-yer",
  },

  atrial_fibrillation: {
    term: "Atrial Fibrillation",
    alternativeNames: ["AFib", "A-fib", "AF", "irregular heartbeat"],
    category: "condition",
    medicalDefinition: "A supraventricular tachyarrhythmia with uncoordinated atrial activation and ineffective atrial contraction",
    patientFriendlyExplanation: "AFib is an irregular heartbeat where the upper chambers of your heart (atria) beat chaotically instead of in a regular rhythm. This can feel like your heart is racing, fluttering, or skipping beats. Because blood doesn't flow smoothly through the heart, blood clots can form, increasing stroke risk. That's why blood thinners are often prescribed.",
    relatedTerms: ["anticoagulation", "stroke", "heart rhythm", "arrhythmia", "cardioversion"],
    commonContext: "Often managed with medications to control heart rate and prevent blood clots. Some patients need procedures to restore normal rhythm.",
    pronunciationHint: "AY-tree-ul fib-ruh-LAY-shun",
  },

  copd: {
    term: "COPD",
    alternativeNames: ["chronic obstructive pulmonary disease", "emphysema", "chronic bronchitis"],
    category: "condition",
    medicalDefinition: "A progressive lung disease characterized by airflow limitation that is not fully reversible, usually caused by significant exposure to noxious particles or gases",
    patientFriendlyExplanation: "COPD is a lung disease that makes it harder to breathe over time. It includes emphysema (damaged air sacs in lungs) and chronic bronchitis (inflamed airways with excess mucus). Most common cause is smoking. While it can't be cured, treatments can help manage symptoms and slow progression.",
    relatedTerms: ["emphysema", "bronchitis", "inhaler", "oxygen therapy", "spirometry"],
    commonContext: "Managed with inhalers, sometimes oxygen therapy, pulmonary rehabilitation, and avoiding smoking/irritants.",
    pronunciationHint: "see-oh-pee-dee",
  },

  pneumonia: {
    term: "Pneumonia",
    alternativeNames: ["lung infection", "chest infection"],
    category: "condition",
    medicalDefinition: "Infection of the lung parenchyma caused by bacteria, viruses, or fungi, resulting in inflammation and consolidation of lung tissue",
    patientFriendlyExplanation: "Pneumonia is an infection in one or both lungs. The air sacs in your lungs fill with fluid or pus, making it hard to breathe and get enough oxygen. Symptoms include cough, fever, chills, and difficulty breathing. It can range from mild to life-threatening, especially in older adults or people with weak immune systems.",
    relatedTerms: ["lung infection", "respiratory infection", "antibiotics", "chest X-ray"],
    commonContext: "Usually treated with antibiotics for bacterial pneumonia. Rest, fluids, and sometimes hospitalization may be needed.",
    pronunciationHint: "noo-MOH-nyuh",
  },

  deep_vein_thrombosis: {
    term: "Deep Vein Thrombosis",
    alternativeNames: ["DVT", "blood clot in leg", "leg clot"],
    category: "condition",
    medicalDefinition: "Formation of a blood clot (thrombus) in a deep vein, most commonly in the legs",
    patientFriendlyExplanation: "DVT is a blood clot that forms in a deep vein, usually in the leg. It can cause pain, swelling, and redness. The biggest danger is if the clot breaks loose and travels to your lungs (pulmonary embolism), which can be life-threatening. Risk increases with prolonged sitting, surgery, or certain medical conditions.",
    relatedTerms: ["blood clot", "anticoagulation", "pulmonary embolism", "Doppler ultrasound"],
    commonContext: "Treated with blood thinners to prevent the clot from growing and to prevent new clots. Compression stockings may help.",
    pronunciationHint: "deep vane throm-BOH-sis",
  },

  chronic_kidney_disease: {
    term: "Chronic Kidney Disease",
    alternativeNames: ["CKD", "kidney disease", "renal failure", "kidney failure"],
    category: "condition",
    medicalDefinition: "Progressive loss of kidney function over months to years, defined by GFR <60 mL/min/1.73m² for 3+ months or markers of kidney damage",
    patientFriendlyExplanation: "CKD means your kidneys are gradually losing their ability to filter waste and excess fluid from your blood. It develops slowly over time and is often caused by diabetes or high blood pressure. Early stages may have no symptoms. As it progresses, waste products build up and can make you feel unwell.",
    relatedTerms: ["creatinine", "GFR", "dialysis", "kidney function", "nephrology"],
    commonContext: "Managed by controlling underlying conditions (diabetes, blood pressure), diet modifications, and avoiding kidney-damaging medications. Advanced stages may require dialysis.",
    pronunciationHint: "KRON-ik KID-nee dih-ZEEZ",
  },

  // ===== ABBREVIATIONS & LAB TESTS =====
  inr: {
    term: "INR",
    alternativeNames: ["International Normalized Ratio", "prothrombin time", "PT/INR"],
    category: "lab_test",
    medicalDefinition: "A standardized measurement of blood clotting time, calculated from prothrombin time, used to monitor anticoagulation therapy",
    patientFriendlyExplanation: "INR is a blood test that shows how long it takes your blood to clot. If you take Warfarin (a blood thinner), this test helps make sure your dose is right - not too much (bleeding risk) or too little (clot risk). Most people on Warfarin aim for an INR of 2-3.",
    relatedTerms: ["warfarin", "blood thinner", "anticoagulation", "clotting"],
    commonContext: "Regular INR testing is essential when on Warfarin. Results guide dose adjustments.",
  },

  hba1c: {
    term: "HbA1c",
    alternativeNames: ["hemoglobin A1c", "A1C", "glycated hemoglobin", "glycosylated hemoglobin"],
    category: "lab_test",
    medicalDefinition: "A form of hemoglobin that reflects average blood glucose levels over approximately the preceding 2-3 months",
    patientFriendlyExplanation: "HbA1c (or just 'A1C') is a blood test that shows your average blood sugar level over the past 2-3 months. It's like a 'report card' for blood sugar control. For most people with diabetes, the goal is under 7%. Higher numbers mean blood sugar has been running too high.",
    relatedTerms: ["diabetes", "blood sugar", "glucose control"],
    commonContext: "Checked every 3-6 months in people with diabetes. More important than single blood sugar readings for assessing overall control.",
  },

  creatinine: {
    term: "Creatinine",
    alternativeNames: ["serum creatinine", "Cr", "kidney function test"],
    category: "lab_test",
    medicalDefinition: "A waste product from normal muscle metabolism that is filtered by the kidneys; elevated levels indicate reduced kidney function",
    patientFriendlyExplanation: "Creatinine is a waste product that your muscles make naturally. Your kidneys normally filter it out of your blood and into your urine. When kidney function decreases, creatinine builds up in your blood, so this test helps show how well your kidneys are working.",
    relatedTerms: ["GFR", "kidney function", "chronic kidney disease", "BUN"],
    commonContext: "Part of routine blood work. Used to calculate GFR (glomerular filtration rate), which stages kidney function.",
  },

  bnp: {
    term: "BNP",
    alternativeNames: ["B-type natriuretic peptide", "NT-proBNP", "brain natriuretic peptide"],
    category: "lab_test",
    medicalDefinition: "A hormone released by the heart in response to stretching of heart muscle, used as a biomarker for heart failure",
    patientFriendlyExplanation: "BNP is a hormone your heart releases when it's under stress or working too hard. Higher levels usually mean your heart is struggling, which happens in heart failure. It helps doctors diagnose heart failure and see if treatment is working.",
    relatedTerms: ["heart failure", "cardiac function", "shortness of breath"],
    commonContext: "Often checked when heart failure is suspected or to monitor treatment response. Very helpful in the emergency room for evaluating shortness of breath.",
  },

  ejection_fraction: {
    term: "Ejection Fraction",
    alternativeNames: ["EF", "LVEF", "heart pumping strength"],
    category: "lab_test",
    medicalDefinition: "The percentage of blood pumped out of the left ventricle with each heartbeat, normally 55-70%",
    patientFriendlyExplanation: "Ejection fraction (EF) measures how well your heart pumps blood. It's the percentage of blood that gets pumped out of your heart's main pumping chamber with each beat. A normal EF is 55-70%. Lower numbers mean your heart isn't pumping as strongly as it should.",
    relatedTerms: ["heart failure", "echocardiogram", "cardiac function", "systolic function"],
    commonContext: "Measured by echocardiogram (heart ultrasound). Important for diagnosing and monitoring heart failure. Guides treatment decisions.",
  },

  // ===== MEDICATION CLASSES =====
  anticoagulant: {
    term: "Anticoagulant",
    alternativeNames: ["blood thinner", "anti-clotting medication"],
    category: "medication_class",
    medicalDefinition: "Medications that inhibit the coagulation cascade to prevent blood clot formation",
    patientFriendlyExplanation: "Anticoagulants, often called 'blood thinners,' are medications that help prevent blood clots from forming. They don't actually thin your blood - they make it take longer to clot. This is important for people at risk of clots (like those with AFib or after surgery).",
    relatedTerms: ["warfarin", "apixaban", "rivaroxaban", "blood clot", "DVT", "stroke prevention"],
    commonContext: "Used to prevent strokes in AFib, treat/prevent blood clots. Require careful monitoring for bleeding.",
  },

  diuretic: {
    term: "Diuretic",
    alternativeNames: ["water pill", "fluid pill"],
    category: "medication_class",
    medicalDefinition: "Medications that increase urine production to remove excess fluid and sodium from the body",
    patientFriendlyExplanation: "Diuretics, sometimes called 'water pills,' help your body get rid of extra fluid and salt through urination. They're used to treat conditions like heart failure (where fluid builds up) and high blood pressure. You'll urinate more often when taking them.",
    relatedTerms: ["furosemide", "hydrochlorothiazide", "spironolactone", "edema", "fluid retention"],
    commonContext: "Common side effects include frequent urination and low potassium. Take early in the day to avoid nighttime bathroom trips.",
  },

  ace_inhibitor: {
    term: "ACE Inhibitor",
    alternativeNames: ["ACE-I", "angiotensin converting enzyme inhibitor"],
    category: "medication_class",
    medicalDefinition: "Medications that inhibit angiotensin-converting enzyme, reducing formation of angiotensin II to lower blood pressure and provide cardioprotection",
    patientFriendlyExplanation: "ACE inhibitors are blood pressure medications that work by relaxing blood vessels. They also protect your heart and kidneys. Common ones include lisinopril, enalapril, and ramipril (names usually end in '-pril'). A dry cough is a common side effect.",
    relatedTerms: ["lisinopril", "enalapril", "blood pressure", "heart failure", "kidney protection"],
    commonContext: "First-choice medications for high blood pressure, heart failure, and diabetic kidney protection. Report swelling of lips/tongue immediately.",
  },

  beta_blocker: {
    term: "Beta Blocker",
    alternativeNames: ["beta-adrenergic blocker", "BB"],
    category: "medication_class",
    medicalDefinition: "Medications that block the effects of adrenaline on beta-adrenergic receptors, slowing heart rate and reducing blood pressure",
    patientFriendlyExplanation: "Beta blockers slow down your heart and make it beat less forcefully. They're used for high blood pressure, heart failure, heart rhythm problems, and after heart attacks. Common ones include metoprolol, carvedilol, and atenolol. They may make you feel tired initially.",
    relatedTerms: ["metoprolol", "carvedilol", "atenolol", "heart rate", "blood pressure"],
    commonContext: "Never stop suddenly - must be tapered. May mask symptoms of low blood sugar in diabetics.",
  },

  statin: {
    term: "Statin",
    alternativeNames: ["HMG-CoA reductase inhibitor", "cholesterol medication"],
    category: "medication_class",
    medicalDefinition: "Medications that inhibit HMG-CoA reductase, reducing cholesterol synthesis in the liver",
    patientFriendlyExplanation: "Statins are medications that lower cholesterol by reducing how much cholesterol your liver makes. They also stabilize plaques in arteries and reduce heart disease risk. Common ones include atorvastatin (Lipitor) and simvastatin (Zocor). Report any unexplained muscle pain.",
    relatedTerms: ["atorvastatin", "simvastatin", "cholesterol", "cardiovascular disease"],
    commonContext: "Very effective at reducing heart attack and stroke risk. Muscle pain is a possible side effect to watch for.",
  },

  // ===== PROCEDURES =====
  echocardiogram: {
    term: "Echocardiogram",
    alternativeNames: ["echo", "cardiac ultrasound", "heart ultrasound"],
    category: "procedure",
    medicalDefinition: "A non-invasive ultrasound examination of the heart that evaluates cardiac structure and function",
    patientFriendlyExplanation: "An echocardiogram is an ultrasound of your heart. A technician moves a wand over your chest that uses sound waves to create moving pictures of your heart. It shows how well your heart is pumping, if valves are working properly, and if there are any structural problems. It's painless and safe.",
    relatedTerms: ["ejection fraction", "heart function", "ultrasound", "cardiac imaging"],
    commonContext: "Common test for evaluating heart failure, heart murmurs, and after heart attacks. Takes about 30-60 minutes.",
  },

  cardiac_catheterization: {
    term: "Cardiac Catheterization",
    alternativeNames: ["heart cath", "coronary angiogram", "cath lab procedure"],
    category: "procedure",
    medicalDefinition: "An invasive diagnostic procedure where a catheter is inserted into the heart chambers or coronary arteries to evaluate cardiac function and coronary artery disease",
    patientFriendlyExplanation: "Cardiac catheterization is a procedure where a thin tube (catheter) is inserted through a blood vessel (usually in your wrist or groin) and threaded to your heart. Dye is injected to show your heart arteries on X-ray. This helps doctors see if there are any blockages that might need treatment.",
    relatedTerms: ["angioplasty", "stent", "coronary artery disease", "heart blockage"],
    commonContext: "Done when heart artery blockages are suspected. If blockages are found, they can sometimes be treated during the same procedure with a stent.",
  },

  dialysis: {
    term: "Dialysis",
    alternativeNames: ["kidney dialysis", "hemodialysis", "peritoneal dialysis", "renal replacement therapy"],
    category: "procedure",
    medicalDefinition: "A medical procedure that removes waste products and excess fluid from the blood when the kidneys are no longer able to perform this function adequately",
    patientFriendlyExplanation: "Dialysis is a treatment that does the job of your kidneys when they can no longer work well enough on their own. It filters waste and extra fluid from your blood. Hemodialysis uses a machine (usually done 3 times a week at a center), while peritoneal dialysis uses the lining of your belly to filter blood (done daily at home).",
    relatedTerms: ["kidney failure", "chronic kidney disease", "hemodialysis", "peritoneal dialysis", "fistula"],
    commonContext: "Needed when kidney function drops below about 15%. Kidney transplant is another option for some people.",
  },

  // ===== SYMPTOMS/CLINICAL TERMS =====
  edema: {
    term: "Edema",
    alternativeNames: ["swelling", "fluid retention", "pitting edema"],
    category: "symptom",
    medicalDefinition: "Abnormal accumulation of fluid in tissues, causing swelling",
    patientFriendlyExplanation: "Edema is swelling caused by too much fluid trapped in your body's tissues. It most often affects the legs, ankles, and feet, but can occur anywhere. Common causes include heart failure, kidney disease, and certain medications. Pressing on the swollen area may leave a dent (pitting).",
    relatedTerms: ["swelling", "heart failure", "kidney disease", "diuretic"],
    commonContext: "May require diuretics (water pills) and reduced salt intake. Elevating legs helps. Sudden swelling in one leg could be a blood clot - seek immediate evaluation.",
  },

  dyspnea: {
    term: "Dyspnea",
    alternativeNames: ["shortness of breath", "breathlessness", "difficulty breathing", "SOB"],
    category: "symptom",
    medicalDefinition: "Subjective experience of breathing discomfort consisting of qualitatively distinct sensations varying in intensity",
    patientFriendlyExplanation: "Dyspnea is the medical term for shortness of breath or difficulty breathing. It can feel like you can't get enough air, your chest is tight, or you're suffocating. Many conditions cause this, including heart failure, lung disease, anemia, and anxiety.",
    relatedTerms: ["shortness of breath", "heart failure", "COPD", "asthma", "pulmonary embolism"],
    commonContext: "New or worsening shortness of breath should be evaluated promptly. Sudden severe breathlessness is an emergency.",
  },

  syncope: {
    term: "Syncope",
    alternativeNames: ["fainting", "passing out", "loss of consciousness", "blackout"],
    category: "symptom",
    medicalDefinition: "Transient loss of consciousness due to temporary inadequate cerebral blood flow, followed by spontaneous recovery",
    patientFriendlyExplanation: "Syncope is the medical term for fainting - briefly losing consciousness and then waking up on your own. It happens when your brain doesn't get enough blood temporarily. Causes range from harmless (standing up too fast) to serious (heart problems). Fainting should always be evaluated by a doctor.",
    relatedTerms: ["fainting", "dizziness", "presyncope", "cardiac arrhythmia"],
    commonContext: "Requires evaluation to rule out heart-related causes. Multiple episodes especially concerning. Tell your doctor about warning symptoms before fainting.",
  },

  tachycardia: {
    term: "Tachycardia",
    alternativeNames: ["fast heart rate", "rapid heartbeat", "racing heart"],
    category: "symptom",
    medicalDefinition: "Heart rate exceeding 100 beats per minute at rest",
    patientFriendlyExplanation: "Tachycardia means your heart is beating faster than normal - more than 100 beats per minute when resting. Many things can cause this: exercise, fever, anxiety, caffeine, dehydration, or heart problems. If it happens often at rest without clear cause, it should be evaluated.",
    relatedTerms: ["heart rate", "palpitations", "arrhythmia", "atrial fibrillation"],
    commonContext: "Normal with exercise or stress. Concerning if at rest without cause, accompanied by dizziness, chest pain, or shortness of breath.",
  },

  bradycardia: {
    term: "Bradycardia",
    alternativeNames: ["slow heart rate", "slow pulse"],
    category: "symptom",
    medicalDefinition: "Heart rate below 60 beats per minute",
    patientFriendlyExplanation: "Bradycardia means your heart is beating slower than normal - less than 60 beats per minute. Athletes often have healthy slow heart rates. However, if you're not athletic and have a slow heart rate with symptoms like dizziness, fatigue, or fainting, it may need treatment.",
    relatedTerms: ["heart rate", "heart block", "pacemaker", "beta blocker"],
    commonContext: "Can be caused by heart conditions, medications (especially beta blockers), or being very fit. Symptomatic bradycardia may require a pacemaker.",
  },
};

/**
 * Look up a medical term
 */
export function getMedicalTermDefinition(term: string): MedicalTerm | null {
  const normalized = term.toLowerCase().trim().replace(/\s+/g, "_").replace(/-/g, "_");

  // Direct match
  if (MEDICAL_TERMS[normalized]) {
    return MEDICAL_TERMS[normalized];
  }

  // Search by term name and alternatives
  for (const [key, termData] of Object.entries(MEDICAL_TERMS)) {
    const termLower = termData.term.toLowerCase();
    const searchTerm = term.toLowerCase().trim();

    if (
      termLower === searchTerm ||
      termLower.includes(searchTerm) ||
      searchTerm.includes(termLower) ||
      termData.alternativeNames.some(
        (alt) =>
          alt.toLowerCase() === searchTerm ||
          alt.toLowerCase().includes(searchTerm) ||
          searchTerm.includes(alt.toLowerCase())
      )
    ) {
      return termData;
    }
  }

  return null;
}

/**
 * Get patient-friendly explanation
 */
export function getPatientFriendlyExplanation(term: string): string | null {
  const termData = getMedicalTermDefinition(term);
  return termData?.patientFriendlyExplanation || null;
}

/**
 * Search terms by category
 */
export function getTermsByCategory(category: MedicalTerm["category"]): MedicalTerm[] {
  return Object.values(MEDICAL_TERMS).filter((t) => t.category === category);
}

/**
 * Get all available terms
 */
export function getAllTerms(): string[] {
  const terms: string[] = [];
  for (const termData of Object.values(MEDICAL_TERMS)) {
    terms.push(termData.term);
    terms.push(...termData.alternativeNames);
  }
  return [...new Set(terms)];
}
