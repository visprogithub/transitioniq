import type { Patient, Diagnosis, Medication, LabResult } from "../types/patient";

const FHIR_BASE_URL = process.env.FHIR_BASE_URL || "https://launch.smarthealthit.org/v/r4/fhir";

interface FHIRPatient {
  resourceType: "Patient";
  id: string;
  name?: Array<{
    given?: string[];
    family?: string;
    use?: string;
  }>;
  gender?: string;
  birthDate?: string;
  identifier?: Array<{
    system?: string;
    value?: string;
  }>;
}

interface FHIRCondition {
  resourceType: "Condition";
  id: string;
  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  clinicalStatus?: {
    coding?: Array<{ code?: string }>;
  };
  onsetDateTime?: string;
}

interface FHIRMedicationRequest {
  resourceType: "MedicationRequest";
  id: string;
  medicationCodeableConcept?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  dosageInstruction?: Array<{
    text?: string;
    doseAndRate?: Array<{
      doseQuantity?: {
        value?: number;
        unit?: string;
      };
    }>;
    route?: {
      coding?: Array<{ display?: string }>;
    };
    timing?: {
      repeat?: {
        frequency?: number;
        period?: number;
        periodUnit?: string;
      };
    };
  }>;
  authoredOn?: string;
}

interface FHIRObservation {
  resourceType: "Observation";
  id: string;
  code?: {
    coding?: Array<{
      system?: string;
      code?: string;
      display?: string;
    }>;
    text?: string;
  };
  valueQuantity?: {
    value?: number;
    unit?: string;
  };
  effectiveDateTime?: string;
  referenceRange?: Array<{
    low?: { value?: number; unit?: string };
    high?: { value?: number; unit?: string };
    text?: string;
  }>;
  interpretation?: Array<{
    coding?: Array<{ code?: string }>;
  }>;
}

interface FHIRBundle<T> {
  resourceType: "Bundle";
  entry?: Array<{
    resource: T;
  }>;
}

async function fhirFetch<T>(endpoint: string): Promise<T> {
  const url = `${FHIR_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/fhir+json",
    },
  });

  if (!response.ok) {
    throw new Error(`FHIR request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function mapGender(fhirGender?: string): "M" | "F" | "O" {
  switch (fhirGender?.toLowerCase()) {
    case "male":
      return "M";
    case "female":
      return "F";
    default:
      return "O";
  }
}

function extractMRN(patient: FHIRPatient): string | undefined {
  const mrnIdentifier = patient.identifier?.find(
    (id) => id.system?.includes("mrn") || id.system?.includes("medical-record")
  );
  return mrnIdentifier?.value;
}

export async function fetchPatientFromFHIR(patientId: string): Promise<Patient | null> {
  try {
    // Fetch patient demographics
    const fhirPatient = await fhirFetch<FHIRPatient>(`/Patient/${patientId}`);

    // Fetch conditions
    const conditionsBundle = await fhirFetch<FHIRBundle<FHIRCondition>>(
      `/Condition?patient=${patientId}&_count=50`
    );

    // Fetch medications
    const medicationsBundle = await fhirFetch<FHIRBundle<FHIRMedicationRequest>>(
      `/MedicationRequest?patient=${patientId}&status=active&_count=50`
    );

    // Fetch recent labs
    const labsBundle = await fhirFetch<FHIRBundle<FHIRObservation>>(
      `/Observation?patient=${patientId}&category=laboratory&_count=20&_sort=-date`
    );

    // Fetch vital signs
    const vitalsBundle = await fhirFetch<FHIRBundle<FHIRObservation>>(
      `/Observation?patient=${patientId}&category=vital-signs&_count=10&_sort=-date`
    );

    // Map to our Patient type
    const name = fhirPatient.name?.find((n) => n.use === "official") || fhirPatient.name?.[0];
    const fullName = name
      ? `${name.given?.join(" ") || ""} ${name.family || ""}`.trim()
      : "Unknown";

    const diagnoses: Diagnosis[] =
      conditionsBundle.entry?.map((entry) => {
        const condition = entry.resource;
        const coding = condition.code?.coding?.[0];
        const status = condition.clinicalStatus?.coding?.[0]?.code;
        return {
          code: coding?.code || "unknown",
          display: coding?.display || condition.code?.text || "Unknown condition",
          onsetDate: condition.onsetDateTime,
          status:
            status === "active"
              ? "active"
              : status === "resolved"
                ? "resolved"
                : "inactive",
        };
      }) || [];

    const medications: Medication[] =
      medicationsBundle.entry?.map((entry) => {
        const med = entry.resource;
        const coding = med.medicationCodeableConcept?.coding?.[0];
        const dosage = med.dosageInstruction?.[0];
        const doseValue = dosage?.doseAndRate?.[0]?.doseQuantity;

        let frequency = "as directed";
        if (dosage?.timing?.repeat) {
          const repeat = dosage.timing.repeat;
          if (repeat.frequency && repeat.period && repeat.periodUnit) {
            frequency = `${repeat.frequency} time(s) per ${repeat.period} ${repeat.periodUnit}`;
          }
        } else if (dosage?.text) {
          frequency = dosage.text;
        }

        return {
          name: coding?.display || med.medicationCodeableConcept?.text || "Unknown",
          dose: doseValue ? `${doseValue.value}${doseValue.unit || ""}` : "as directed",
          frequency,
          route: dosage?.route?.coding?.[0]?.display || "oral",
          startDate: med.authoredOn,
          rxNormCode: coding?.system?.includes("rxnorm") ? coding.code : undefined,
        };
      }) || [];

    const recentLabs: LabResult[] =
      labsBundle.entry?.map((entry) => {
        const obs = entry.resource;
        const coding = obs.code?.coding?.[0];
        const refRange = obs.referenceRange?.[0];
        const isAbnormal = obs.interpretation?.some(
          (i) => i.coding?.some((c) => c.code !== "N")
        );

        let referenceRangeText = "";
        if (refRange?.text) {
          referenceRangeText = refRange.text;
        } else if (refRange?.low && refRange?.high) {
          referenceRangeText = `${refRange.low.value}-${refRange.high.value}`;
        }

        return {
          name: coding?.display || obs.code?.text || "Unknown",
          value: obs.valueQuantity?.value || 0,
          unit: obs.valueQuantity?.unit || "",
          referenceRange: referenceRangeText,
          date: obs.effectiveDateTime || new Date().toISOString(),
          abnormal: isAbnormal || false,
        };
      }) || [];

    // Extract latest vital signs
    const latestVitals: Record<string, FHIRObservation> = {};
    vitalsBundle.entry?.forEach((entry) => {
      const obs = entry.resource;
      const code = obs.code?.coding?.[0]?.code;
      if (code && !latestVitals[code]) {
        latestVitals[code] = obs;
      }
    });

    const vitalSigns = Object.keys(latestVitals).length > 0 ? {
      bloodPressure: (() => {
        const systolic = vitalsBundle.entry?.find(
          (e) => e.resource.code?.coding?.[0]?.code === "8480-6"
        )?.resource;
        const diastolic = vitalsBundle.entry?.find(
          (e) => e.resource.code?.coding?.[0]?.code === "8462-4"
        )?.resource;
        if (systolic?.valueQuantity?.value && diastolic?.valueQuantity?.value) {
          return `${systolic.valueQuantity.value}/${diastolic.valueQuantity.value}`;
        }
        return undefined;
      })(),
      heartRate: latestVitals["8867-4"]?.valueQuantity?.value,
      temperature: latestVitals["8310-5"]?.valueQuantity?.value,
      respiratoryRate: latestVitals["9279-1"]?.valueQuantity?.value,
      oxygenSaturation: latestVitals["2708-6"]?.valueQuantity?.value,
      recordedAt: Object.values(latestVitals)[0]?.effectiveDateTime || new Date().toISOString(),
    } : undefined;

    return {
      id: patientId,
      name: fullName,
      age: fhirPatient.birthDate ? calculateAge(fhirPatient.birthDate) : 0,
      gender: mapGender(fhirPatient.gender),
      mrn: extractMRN(fhirPatient),
      admissionDate: new Date().toISOString().split("T")[0], // Not typically in Patient resource
      diagnoses,
      medications,
      allergies: [], // Would need to fetch AllergyIntolerance resource
      recentLabs,
      vitalSigns,
    };
  } catch (error) {
    console.error("FHIR fetch error:", error);
    return null;
  }
}

export async function fetchAllergiesFromFHIR(patientId: string): Promise<string[]> {
  try {
    interface FHIRAllergyIntolerance {
      resourceType: "AllergyIntolerance";
      code?: {
        coding?: Array<{ display?: string }>;
        text?: string;
      };
    }

    const bundle = await fhirFetch<FHIRBundle<FHIRAllergyIntolerance>>(
      `/AllergyIntolerance?patient=${patientId}&_count=20`
    );

    return (
      bundle.entry?.map((entry) => {
        const allergy = entry.resource;
        return allergy.code?.coding?.[0]?.display || allergy.code?.text || "Unknown allergen";
      }) || []
    );
  } catch (error) {
    console.error("Failed to fetch allergies:", error);
    return [];
  }
}

// List of test patients available in the SMART sandbox
export const SMART_TEST_PATIENTS = [
  { id: "smart-1288992", name: "Amy V. Shaw", description: "Adult female, multiple conditions" },
  { id: "smart-1482713", name: "Mr. Al Stein", description: "Adult male, diabetes" },
  { id: "smart-1551992", name: "Daniel X. Adams", description: "Adult male, heart disease" },
  { id: "smart-1727024", name: "Mariana Acosta", description: "Adult female, pregnancy" },
  { id: "smart-2169591", name: "Brian Z. Gracia", description: "Adult male, COPD" },
];
