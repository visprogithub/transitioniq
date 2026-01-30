/**
 * LLM JSON Parsing Utilities
 *
 * Handles common issues when parsing JSON from LLM responses:
 * - Qwen3 models wrap output in <think>...</think> tags
 * - Smaller models sometimes add trailing commas
 * - Some models include markdown code fences around JSON
 */

/**
 * Strip LLM thinking tokens and markdown fences from response text.
 * Qwen3 models use <think>...</think> for chain-of-thought reasoning.
 */
export function stripLLMWrapper(text: string): string {
  let result = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")  // Qwen3 closed thinking tokens
    .replace(/```json\s*/g, "")                 // Markdown code fences
    .replace(/```\s*/g, "");

  // Handle unclosed <think> block (model hit token limit during thinking)
  // Only strip if there's no JSON-like content after the <think> tag
  const unclosedThinkIdx = result.indexOf("<think>");
  if (unclosedThinkIdx !== -1) {
    const afterThink = result.slice(unclosedThinkIdx);
    // If the remaining text has JSON content ([{), keep the part after <think>
    const jsonStart = afterThink.search(/[\[{]/);
    if (jsonStart !== -1) {
      result = result.slice(0, unclosedThinkIdx) + afterThink.slice(jsonStart);
    } else {
      // Pure thinking, no JSON — strip entirely
      result = result.slice(0, unclosedThinkIdx);
    }
  }

  return result.trim();
}

/**
 * Extract and parse a JSON object ({...}) from LLM response text.
 * Handles thinking tokens, code fences, and trailing commas.
 */
export function extractJsonObject<T = Record<string, unknown>>(text: string): T {
  const cleaned = stripLLMWrapper(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object found in LLM response: " + cleaned.slice(0, 300));
  }
  return parseWithFixup<T>(match[0]);
}

/**
 * Extract and parse a JSON array ([...]) from LLM response text.
 * Handles thinking tokens, code fences, and trailing commas.
 */
export function extractJsonArray<T = unknown[]>(text: string): T {
  const cleaned = stripLLMWrapper(text);
  let match = cleaned.match(/\[[\s\S]*\]/);
  if (!match) {
    // Try to recover truncated arrays (LLM hit token limit before closing ])
    const bracketStart = cleaned.indexOf("[");
    if (bracketStart !== -1) {
      let truncated = cleaned.slice(bracketStart);
      // Trim after the last complete object (ending with })
      const lastBrace = truncated.lastIndexOf("}");
      if (lastBrace !== -1) {
        truncated = truncated.slice(0, lastBrace + 1) + "]";
        match = truncated.match(/\[[\s\S]*\]/);
      }
    }
    if (!match) {
      throw new Error("No JSON array found in LLM response: " + cleaned.slice(0, 300));
    }
  }
  return parseWithFixup<T>(match[0]);
}

/**
 * Parse JSON with fixup for common LLM formatting issues:
 * - Trailing commas before ] or }
 * - Truncated output (incomplete objects/arrays at the end)
 */
function parseWithFixup<T>(jsonStr: string): T {
  // First attempt: parse as-is
  try {
    return JSON.parse(jsonStr) as T;
  } catch {
    // noop — try fixes below
  }

  // Second attempt: fix trailing commas
  const fixed = jsonStr
    .replace(/,\s*\]/g, "]")
    .replace(/,\s*\}/g, "}");
  try {
    return JSON.parse(fixed) as T;
  } catch {
    // noop — try truncation recovery below
  }

  // Third attempt: recover truncated JSON by closing open brackets/braces
  // Find the last successfully parseable prefix
  return recoverTruncatedJson<T>(jsonStr);
}

/**
 * Recover truncated JSON by trimming back to the last complete element
 * and closing any open brackets/braces.
 */
function recoverTruncatedJson<T>(jsonStr: string): T {
  // Strategy: find the last `},` or `}` that completes a valid element,
  // then close any remaining open brackets/braces
  const isArray = jsonStr.trimStart().startsWith("[");

  // Find positions of all closing braces that might end a complete object
  let lastGoodPos = -1;
  for (let i = jsonStr.length - 1; i >= 0; i--) {
    if (jsonStr[i] === "}") {
      // Try to parse from start to here + closing brackets
      const slice = jsonStr.slice(0, i + 1);
      const closers = isArray ? "]" : "}";
      const candidate = (slice + closers)
        .replace(/,\s*\]/g, "]")
        .replace(/,\s*\}/g, "}");
      try {
        const result = JSON.parse(candidate) as T;
        // Validate: for arrays, ensure we got at least one element
        if (Array.isArray(result) && result.length === 0) continue;
        return result;
      } catch {
        lastGoodPos = i;
        continue;
      }
    }
  }

  // If we couldn't recover, throw with context
  throw new Error(
    `Failed to parse JSON (truncated at position ${lastGoodPos}): ${jsonStr.slice(0, 200)}...`
  );
}
