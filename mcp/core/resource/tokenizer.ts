export interface TextTokenizer {
  readonly name: string;
  tokenize(text: string): string[];
}

export type TokenizerKind = "default" | "salesforce";

function unique(tokens: string[]): string[] {
  return [...new Set(tokens.filter((token) => token.length > 0))];
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[\s_\-\/\\.,;:!?()\[\]{}"'`]+/g, " ").trim();
}

function splitCamelCase(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
}

export class DefaultTextTokenizer implements TextTokenizer {
  readonly name = "default";

  tokenize(text: string): string[] {
    const normalized = normalizeWhitespace(text.toLowerCase());
    if (!normalized) return [];
    return normalized
      .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }
}

const SALESFORCE_SUFFIXES = ["__c", "__r", "__mdt", "__e", "__b", "__x"];

export class SalesforceTextTokenizer implements TextTokenizer {
  readonly name = "salesforce";

  tokenize(text: string): string[] {
    const expanded: string[] = [];
    const rawTokens = text
      .split(/[^A-Za-z0-9_.]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    for (const rawToken of rawTokens) {
      const lowerToken = rawToken.toLowerCase();
      expanded.push(lowerToken);

      const dotParts = rawToken.split(".").filter(Boolean);
      for (const dotPart of dotParts) {
        const withoutSuffix = SALESFORCE_SUFFIXES.find((suffix) => dotPart.toLowerCase().endsWith(suffix))
          ? dotPart.replace(/__(c|r|mdt|e|b|x)$/i, "")
          : dotPart;

        expanded.push(dotPart.toLowerCase());
        expanded.push(withoutSuffix.toLowerCase());
        expanded.push(...splitCamelCase(withoutSuffix).map((part) => part.toLowerCase()));
        expanded.push(...withoutSuffix.split("__").map((part) => part.trim().toLowerCase()).filter(Boolean));
      }
    }

    return unique(expanded);
  }
}

export function createTextTokenizer(kind: TokenizerKind = "default"): TextTokenizer {
  if (kind === "salesforce") {
    return new SalesforceTextTokenizer();
  }
  return new DefaultTextTokenizer();
}
