/**
 * PII/PHI Detection for Healthcare Applications
 *
 * Detects and sanitizes Protected Health Information (PHI) and
 * Personally Identifiable Information (PII) to ensure HIPAA compliance.
 */

export interface PIIMatch {
  type: PIIType;
  value: string;
  startIndex: number;
  endIndex: number;
  confidence: "high" | "medium" | "low";
}

export type PIIType =
  | "ssn"
  | "mrn"
  | "dob"
  | "phone"
  | "email"
  | "address"
  | "name"
  | "credit_card"
  | "ip_address"
  | "date"
  | "health_plan_id"
  | "account_number"
  | "license_number"
  | "vehicle_id"
  | "device_id"
  | "biometric"
  | "photo"
  | "url";

export interface PIIDetectionResult {
  hasPII: boolean;
  matches: PIIMatch[];
  riskLevel: "high" | "medium" | "low" | "none";
  categories: PIIType[];
}

// Regex patterns for PII detection
const PII_PATTERNS: Record<PIIType, { pattern: RegExp; confidence: "high" | "medium" | "low" }> = {
  // SSN: XXX-XX-XXXX or XXXXXXXXX
  ssn: {
    pattern: /\b(?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4}\b/g,
    confidence: "high",
  },

  // Medical Record Number (common formats)
  mrn: {
    pattern: /\b(?:MRN|Medical Record|Patient ID|Chart)[:\s#-]*(\d{6,12})\b/gi,
    confidence: "high",
  },

  // Date of Birth patterns
  dob: {
    pattern: /\b(?:DOB|Date of Birth|Birth Date|Born)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi,
    confidence: "high",
  },

  // Phone numbers (various formats)
  phone: {
    pattern: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    confidence: "medium",
  },

  // Email addresses
  email: {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    confidence: "high",
  },

  // Street addresses (simplified pattern)
  address: {
    pattern: /\b\d{1,5}\s+[A-Za-z0-9\s.,]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl)\.?\s*(?:,?\s*(?:Apt|Suite|Unit|#)\.?\s*\d+)?\b/gi,
    confidence: "medium",
  },

  // Names (after common identifiers) - lower confidence
  name: {
    pattern: /\b(?:Patient|Name|Mr\.|Mrs\.|Ms\.|Dr\.)[:\s]+([A-Z][a-z]+\s+[A-Z][a-z]+)\b/g,
    confidence: "low",
  },

  // Credit card numbers
  credit_card: {
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    confidence: "high",
  },

  // IP addresses
  ip_address: {
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    confidence: "medium",
  },

  // Generic dates (potential DOB or service dates)
  date: {
    pattern: /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g,
    confidence: "low",
  },

  // Health Plan ID
  health_plan_id: {
    pattern: /\b(?:Health Plan|Insurance|Policy|Member)[:\s#]*([A-Z]{2,3}\d{6,12})\b/gi,
    confidence: "high",
  },

  // Bank Account Numbers
  account_number: {
    pattern: /\b(?:Account|Acct)[:\s#]*(\d{8,17})\b/gi,
    confidence: "high",
  },

  // Driver's License
  license_number: {
    pattern: /\b(?:License|DL|Driver)[:\s#]*([A-Z]\d{7,14})\b/gi,
    confidence: "high",
  },

  // Vehicle IDs (VIN)
  vehicle_id: {
    pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g,
    confidence: "medium",
  },

  // Device Identifiers (UDI, IMEI)
  device_id: {
    pattern: /\b(?:UDI|IMEI|Device ID)[:\s]*([A-Z0-9]{10,20})\b/gi,
    confidence: "medium",
  },

  // Biometric (mentioned but can't be detected as data)
  biometric: {
    pattern: /\b(?:fingerprint|retina|iris|facial recognition|voice print|dna sample)\b/gi,
    confidence: "low",
  },

  // Photo references
  photo: {
    pattern: /\b(?:photo|photograph|image|picture)[:\s]+[^\s]+\.(?:jpg|jpeg|png|gif|bmp)\b/gi,
    confidence: "medium",
  },

  // URLs that might contain PII
  url: {
    pattern: /https?:\/\/[^\s]+(?:patient|user|profile|account|record)[^\s]*/gi,
    confidence: "low",
  },
};

/**
 * Detect PII in text
 */
export function detectPII(text: string): PIIDetectionResult {
  const matches: PIIMatch[] = [];
  const categories = new Set<PIIType>();

  for (const [type, config] of Object.entries(PII_PATTERNS)) {
    const regex = new RegExp(config.pattern.source, config.pattern.flags);
    let match;

    while ((match = regex.exec(text)) !== null) {
      matches.push({
        type: type as PIIType,
        value: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
        confidence: config.confidence,
      });
      categories.add(type as PIIType);
    }
  }

  // Determine risk level
  let riskLevel: "high" | "medium" | "low" | "none" = "none";
  const highConfidence = matches.filter((m) => m.confidence === "high");
  const mediumConfidence = matches.filter((m) => m.confidence === "medium");

  if (highConfidence.length > 0) {
    riskLevel = "high";
  } else if (mediumConfidence.length > 0) {
    riskLevel = "medium";
  } else if (matches.length > 0) {
    riskLevel = "low";
  }

  return {
    hasPII: matches.length > 0,
    matches,
    riskLevel,
    categories: Array.from(categories),
  };
}

/**
 * Sanitize PII from text by redacting detected patterns
 */
export function sanitizePII(text: string, redactionChar = "█"): string {
  const detection = detectPII(text);

  if (!detection.hasPII) {
    return text;
  }

  // Sort matches by start index in reverse order to avoid index shifting
  const sortedMatches = [...detection.matches].sort(
    (a, b) => b.startIndex - a.startIndex
  );

  let sanitized = text;
  for (const match of sortedMatches) {
    const redaction = redactionChar.repeat(match.value.length);
    sanitized =
      sanitized.slice(0, match.startIndex) +
      redaction +
      sanitized.slice(match.endIndex);
  }

  return sanitized;
}

/**
 * Sanitize PII with type-specific placeholders
 */
export function sanitizePIIWithPlaceholders(text: string): string {
  const detection = detectPII(text);

  if (!detection.hasPII) {
    return text;
  }

  const placeholders: Record<PIIType, string> = {
    ssn: "[SSN REDACTED]",
    mrn: "[MRN REDACTED]",
    dob: "[DOB REDACTED]",
    phone: "[PHONE REDACTED]",
    email: "[EMAIL REDACTED]",
    address: "[ADDRESS REDACTED]",
    name: "[NAME REDACTED]",
    credit_card: "[CARD REDACTED]",
    ip_address: "[IP REDACTED]",
    date: "[DATE REDACTED]",
    health_plan_id: "[HEALTH PLAN ID REDACTED]",
    account_number: "[ACCOUNT REDACTED]",
    license_number: "[LICENSE REDACTED]",
    vehicle_id: "[VIN REDACTED]",
    device_id: "[DEVICE ID REDACTED]",
    biometric: "[BIOMETRIC REDACTED]",
    photo: "[PHOTO REF REDACTED]",
    url: "[URL REDACTED]",
  };

  // Sort matches by start index in reverse order
  const sortedMatches = [...detection.matches].sort(
    (a, b) => b.startIndex - a.startIndex
  );

  let sanitized = text;
  for (const match of sortedMatches) {
    const placeholder = placeholders[match.type] || "[REDACTED]";
    sanitized =
      sanitized.slice(0, match.startIndex) +
      placeholder +
      sanitized.slice(match.endIndex);
  }

  return sanitized;
}

/**
 * Check if text should be blocked entirely due to high-risk PII
 */
export function shouldBlockContent(text: string): { block: boolean; reason?: string } {
  const detection = detectPII(text);

  // Block if SSN, credit card, or multiple high-confidence matches
  const criticalTypes: PIIType[] = ["ssn", "credit_card"];
  const hasCritical = detection.matches.some((m) => criticalTypes.includes(m.type));

  if (hasCritical) {
    return {
      block: true,
      reason: `Critical PII detected: ${detection.categories.filter((c) => criticalTypes.includes(c)).join(", ")}`,
    };
  }

  // Block if too many high-confidence matches (potential bulk PII)
  const highConfidenceCount = detection.matches.filter((m) => m.confidence === "high").length;
  if (highConfidenceCount >= 3) {
    return {
      block: true,
      reason: `Multiple high-risk PII instances detected (${highConfidenceCount} items)`,
    };
  }

  return { block: false };
}

/**
 * Get a summary of PII detection for logging
 */
export function getPIIDetectionSummary(detection: PIIDetectionResult): string {
  if (!detection.hasPII) {
    return "No PII detected";
  }

  const summary = [
    `Risk level: ${detection.riskLevel}`,
    `Total matches: ${detection.matches.length}`,
    `Categories: ${detection.categories.join(", ")}`,
    `High confidence: ${detection.matches.filter((m) => m.confidence === "high").length}`,
  ];

  return summary.join(" | ");
}
