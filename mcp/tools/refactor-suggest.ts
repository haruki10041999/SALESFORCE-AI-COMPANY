/**
 * TASK-A7: Refactor 提案エンジン。
 *
 * Apex ソース（または任意のテキスト）を 4 つのヒューリスティックで走査し、
 * 構造的なリファクタ余地を `RefactorSuggestion[]` として返す。
 *
 * 検出ルール:
 *  - long-method:        単一メソッドの行数が `maxMethodLines` 超
 *  - deep-nesting:       任意行のインデント深度が `maxNestingDepth` 超
 *  - duplicate-literal:  同一文字列リテラルが `minLiteralOccurrences` 回以上
 *  - magic-number:       `0`/`1`/`-1` 以外の数値リテラルが `minMagicOccurrences` 回以上
 *
 * すべて正規表現ベースの軽量解析であり、AST 解析の精度は持たない代わりに
 * 高速で依存もない。ガバナンス通過後に重い静的解析へエスカレーションする
 * 「一次フィルタ」として位置づける。
 */

export type RefactorSuggestionKind =
  | "long-method"
  | "deep-nesting"
  | "duplicate-literal"
  | "magic-number";

export type RefactorSuggestion = {
  kind: RefactorSuggestionKind;
  severity: "low" | "medium" | "high";
  message: string;
  /** 1-based line number when applicable. */
  line?: number;
  /** Free-form metadata for UI/dashboards. */
  details?: Record<string, unknown>;
};

export type RefactorSuggestInput = {
  source: string;
  /** Optional file path used only for messages. */
  filePath?: string;
  maxMethodLines?: number;
  maxNestingDepth?: number;
  minLiteralOccurrences?: number;
  minMagicOccurrences?: number;
};

export type RefactorSuggestResult = {
  filePath?: string;
  totalSuggestions: number;
  suggestionsByKind: Record<RefactorSuggestionKind, number>;
  suggestions: RefactorSuggestion[];
};

const DEFAULTS = {
  maxMethodLines: 60,
  maxNestingDepth: 4,
  minLiteralOccurrences: 3,
  minMagicOccurrences: 3
};

const METHOD_HEADER_REGEX =
  /^\s*(?:public|private|protected|global)?\s*(?:static\s+|virtual\s+|override\s+|with\s+sharing\s+|without\s+sharing\s+|inherited\s+sharing\s+)*[\w<>,\s\[\]\.]+?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{?\s*$/;

function detectLongMethods(lines: string[], threshold: number): RefactorSuggestion[] {
  const out: RefactorSuggestion[] = [];
  let depth = 0;
  let methodStart = -1;
  let methodName = "";
  let methodOpenDepth = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (methodStart === -1) {
      const m = line.match(METHOD_HEADER_REGEX);
      if (m && /\{/.test(line)) {
        methodStart = i;
        methodName = m[1] ?? "<anon>";
        methodOpenDepth = depth;
      }
    }
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (methodStart !== -1 && depth === methodOpenDepth) {
      const length = i - methodStart + 1;
      if (length > threshold) {
        out.push({
          kind: "long-method",
          severity: length > threshold * 1.5 ? "high" : "medium",
          message: `Method '${methodName}' spans ${length} lines (threshold ${threshold}).`,
          line: methodStart + 1,
          details: { method: methodName, length, threshold }
        });
      }
      methodStart = -1;
      methodName = "";
    }
  }
  return out;
}

function detectDeepNesting(lines: string[], maxDepth: number): RefactorSuggestion[] {
  const out: RefactorSuggestion[] = [];
  let depth = 0;
  let reportedAtCurrentPeak = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    let prevDepth = depth;
    for (const ch of line) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (depth > maxDepth && depth > prevDepth && !reportedAtCurrentPeak) {
      out.push({
        kind: "deep-nesting",
        severity: depth > maxDepth + 1 ? "high" : "medium",
        message: `Nesting depth ${depth} exceeds threshold ${maxDepth}.`,
        line: i + 1,
        details: { depth, threshold: maxDepth }
      });
      reportedAtCurrentPeak = true;
    }
    if (depth <= maxDepth) reportedAtCurrentPeak = false;
  }
  return out;
}

function detectDuplicateLiterals(source: string, minOccurrences: number): RefactorSuggestion[] {
  const counts = new Map<string, number>();
  for (const match of source.matchAll(/'([^'\\]{2,}?(?:\\.[^'\\]*?)*)'/g)) {
    const literal = match[1];
    if (!literal) continue;
    if (literal.length < 3) continue;
    counts.set(literal, (counts.get(literal) ?? 0) + 1);
  }
  const out: RefactorSuggestion[] = [];
  for (const [literal, count] of counts) {
    if (count >= minOccurrences) {
      out.push({
        kind: "duplicate-literal",
        severity: count >= minOccurrences * 2 ? "high" : "medium",
        message: `String literal '${literal}' repeats ${count} times. Consider a constant.`,
        details: { literal, count, threshold: minOccurrences }
      });
    }
  }
  return out;
}

function detectMagicNumbers(source: string, minOccurrences: number): RefactorSuggestion[] {
  // Strip strings to avoid counting digits inside literals.
  const stripped = source.replace(/'([^'\\]|\\.)*'/g, "''").replace(/"([^"\\]|\\.)*"/g, '""');
  const counts = new Map<string, number>();
  for (const match of stripped.matchAll(/(?<![\w.])-?\d+(?:\.\d+)?\b/g)) {
    const value = match[0];
    if (value === "0" || value === "1" || value === "-1") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const out: RefactorSuggestion[] = [];
  for (const [value, count] of counts) {
    if (count >= minOccurrences) {
      out.push({
        kind: "magic-number",
        severity: "low",
        message: `Numeric literal ${value} appears ${count} times. Consider a named constant.`,
        details: { value, count, threshold: minOccurrences }
      });
    }
  }
  return out;
}

export function suggestRefactors(input: RefactorSuggestInput): RefactorSuggestResult {
  const maxMethodLines = input.maxMethodLines ?? DEFAULTS.maxMethodLines;
  const maxNestingDepth = input.maxNestingDepth ?? DEFAULTS.maxNestingDepth;
  const minLiteralOccurrences = input.minLiteralOccurrences ?? DEFAULTS.minLiteralOccurrences;
  const minMagicOccurrences = input.minMagicOccurrences ?? DEFAULTS.minMagicOccurrences;

  const lines = input.source.split(/\r?\n/);
  const suggestions: RefactorSuggestion[] = [
    ...detectLongMethods(lines, maxMethodLines),
    ...detectDeepNesting(lines, maxNestingDepth),
    ...detectDuplicateLiterals(input.source, minLiteralOccurrences),
    ...detectMagicNumbers(input.source, minMagicOccurrences)
  ];

  const counts: Record<RefactorSuggestionKind, number> = {
    "long-method": 0,
    "deep-nesting": 0,
    "duplicate-literal": 0,
    "magic-number": 0
  };
  for (const s of suggestions) counts[s.kind] += 1;

  return {
    filePath: input.filePath,
    totalSuggestions: suggestions.length,
    suggestionsByKind: counts,
    suggestions
  };
}
