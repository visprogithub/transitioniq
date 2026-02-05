/**
 * Grounding Verification - Checks LLM answers against source evidence
 *
 * This module verifies that claims in LLM-generated answers are actually
 * supported by the tool observations (evidence) gathered during reasoning.
 * Catches hallucinations where the LLM invents information not in sources.
 */

import { createLLMProvider } from "@/lib/integrations/llm-provider";

export interface GroundingResult {
  isGrounded: boolean;
  score: number; // 0-1, percentage of claims that are grounded
  totalClaims: number;
  groundedClaims: number;
  ungroundedClaims: ClaimVerification[];
  allClaims: ClaimVerification[];
}

export interface ClaimVerification {
  claim: string;
  isGrounded: boolean;
  supportingEvidence: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Verify that an answer is grounded in the provided observations
 *
 * @param answer - The LLM's final answer to verify
 * @param observations - Array of tool observation strings (evidence)
 * @returns Grounding verification result with claim-level details
 */
export async function verifyGrounding(
  answer: string,
  observations: string[]
): Promise<GroundingResult> {
  if (observations.length === 0) {
    // No observations means no grounding possible
    return {
      isGrounded: false,
      score: 0,
      totalClaims: 0,
      groundedClaims: 0,
      ungroundedClaims: [],
      allClaims: [],
    };
  }

  const provider = createLLMProvider();

  // Combine observations into evidence block
  const evidenceBlock = observations
    .map((obs, i) => `[Source ${i + 1}]:\n${obs}`)
    .join("\n\n");

  const verificationPrompt = `You are a fact-checker. Your job is to verify that claims in an ANSWER are supported by the EVIDENCE.

## EVIDENCE (from tool calls):
${evidenceBlock}

## ANSWER TO VERIFY:
${answer}

## TASK:
1. Extract each factual claim from the ANSWER (skip greetings, opinions, suggestions to "ask your doctor")
2. For each claim, check if it is supported by the EVIDENCE
3. A claim is GROUNDED if the evidence explicitly states or strongly implies it
4. A claim is UNGROUNDED if it's not in the evidence or contradicts it

Respond with ONLY valid JSON:
{
  "claims": [
    {
      "claim": "the specific factual claim",
      "isGrounded": true/false,
      "supportingEvidence": "quote from evidence that supports this, or null if ungrounded",
      "confidence": "high/medium/low"
    }
  ]
}

Be strict - if you can't find clear evidence for a medical fact, mark it ungrounded.`;

  try {
    const response = await provider.generate(verificationPrompt, {
      spanName: "grounding-verification",
      metadata: {
        answer_length: answer.length,
        evidence_sources: observations.length,
      },
    });

    // Parse the response
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[Grounding] Failed to parse verification response");
      return {
        isGrounded: true, // Fail open to avoid blocking
        score: 1,
        totalClaims: 0,
        groundedClaims: 0,
        ungroundedClaims: [],
        allClaims: [],
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      claims: ClaimVerification[];
    };

    const claims = parsed.claims || [];
    const groundedClaims = claims.filter((c) => c.isGrounded);
    const ungroundedClaims = claims.filter((c) => !c.isGrounded);

    return {
      isGrounded: ungroundedClaims.length === 0,
      score: claims.length > 0 ? groundedClaims.length / claims.length : 1,
      totalClaims: claims.length,
      groundedClaims: groundedClaims.length,
      ungroundedClaims,
      allClaims: claims,
    };
  } catch (error) {
    console.error("[Grounding] Verification error:", error);
    // Fail open - don't block on verification errors
    return {
      isGrounded: true,
      score: 1,
      totalClaims: 0,
      groundedClaims: 0,
      ungroundedClaims: [],
      allClaims: [],
    };
  }
}

/**
 * Quick check if answer contains claims not in observations
 * Lighter weight than full verification - just checks for suspicious patterns
 */
export function quickGroundingCheck(
  answer: string,
  observations: string[]
): { suspicious: boolean; flags: string[] } {
  const flags: string[] = [];
  const observationText = observations.join(" ").toLowerCase();

  // Check for specific dosage claims
  const dosagePattern = /(\d+)\s*(mg|ml|mcg|units?)/gi;
  const dosages = answer.match(dosagePattern) || [];
  for (const dosage of dosages) {
    if (!observationText.includes(dosage.toLowerCase())) {
      flags.push(`Dosage "${dosage}" not found in evidence`);
    }
  }

  // Check for time-based claims (every X hours, X times daily)
  const timePattern = /every\s+(\d+)\s+hours?|(\d+)\s+times?\s+(daily|a day|per day)/gi;
  const times = answer.match(timePattern) || [];
  for (const time of times) {
    if (!observationText.includes(time.toLowerCase())) {
      flags.push(`Timing "${time}" not found in evidence`);
    }
  }

  // Check for percentage claims
  const percentPattern = /(\d+)%/g;
  const percents = answer.match(percentPattern) || [];
  for (const pct of percents) {
    if (!observationText.includes(pct)) {
      flags.push(`Statistic "${pct}" not found in evidence`);
    }
  }

  return {
    suspicious: flags.length > 0,
    flags,
  };
}
