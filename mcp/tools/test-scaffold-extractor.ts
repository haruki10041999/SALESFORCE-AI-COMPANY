/**
 * TASK-A8: Apex ソースから分岐・例外スキャフォルドを抽出する。
 *
 * 単純な正規表現ベースで以下を数える:
 *  - `if` / `else if` / `case when`（Apex switch when）の出現数
 *  - `try { ... } catch (...)` ブロック数
 *  - `throw new ...`（送出される例外型を抽出）
 *
 * 完全な AST 解析ではなくヒューリスティクスなので、
 * 取りこぼし/誤検出を避けるためコメント・文字列を除去してから走査する。
 */

export type BranchExceptionScaffold = {
  className: string;
  branchCount: number;
  catchCount: number;
  throwTypes: string[];
  /** テスト雛形として推奨するテストメソッド名（重複排除済み）。 */
  suggestedTests: string[];
};

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/"([^"\\]|\\.)*"/g, '""');
}

function extractClassName(source: string, fallback: string): string {
  const match = source.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
  return match?.[1] ?? fallback;
}

export function scanBranchAndExceptionScaffold(
  apexSource: string,
  fallbackName: string
): BranchExceptionScaffold {
  const stripped = stripCommentsAndStrings(apexSource);
  const className = extractClassName(stripped, fallbackName);

  const ifMatches = stripped.match(/\bif\s*\(/g) ?? [];
  const elseIfMatches = stripped.match(/\belse\s+if\s*\(/g) ?? [];
  const whenMatches = stripped.match(/\bwhen\s+[A-Za-z_]/g) ?? [];
  const ternaryMatches = stripped.match(/\?[^?:]+:[^;]/g) ?? [];
  const branchCount = ifMatches.length + elseIfMatches.length + whenMatches.length + ternaryMatches.length;

  const catchMatches = stripped.match(/\bcatch\s*\(/g) ?? [];
  const catchCount = catchMatches.length;

  const throwTypes = new Set<string>();
  for (const match of stripped.matchAll(/\bthrow\s+new\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    const name = match[1];
    if (name) throwTypes.add(name);
  }

  const suggestedTests: string[] = [];
  if (branchCount > 0) {
    suggestedTests.push(`test${className}_AllBranches`);
    if (branchCount >= 3) suggestedTests.push(`test${className}_NegativeBranch`);
  }
  if (catchCount > 0) {
    suggestedTests.push(`test${className}_RecoversFromException`);
  }
  for (const t of throwTypes) {
    const safe = t.replace(/[^A-Za-z0-9_]/g, "_");
    suggestedTests.push(`test${className}_Throws${safe}`);
  }

  return {
    className,
    branchCount,
    catchCount,
    throwTypes: [...throwTypes].sort(),
    suggestedTests: Array.from(new Set(suggestedTests))
  };
}
