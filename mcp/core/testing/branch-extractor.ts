/**
 * TASK-A8: Apex ソースから try/catch/finally 分岐とテスト雛形を抽出する。
 *
 * ヒューリスティクス正規表現ベース実装。コメント・文字列を除去して走査する。
 * フル AST 解析は mcp/core/parsers/apex-ast.ts を参照。
 */

export type ApexBranchInfo = {
  /** 解析対象クラス名（fallback は引数 name）。 */
  className: string;
  /** if / else-if / switch-when / 三項演算子 の合計数。 */
  branchCount: number;
  /** catch ブロックの数。 */
  catchCount: number;
  /** throw new <Type>() で送出される例外型（重複排除済み）。 */
  throwTypes: string[];
  /** テスト雛形として推奨するメソッド名（重複排除済み）。 */
  suggestedTests: string[];
};

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/"([^"\\]|\\.)*"/g, '""');
}

/**
 * Apex ソース文字列から分岐・例外情報を抽出し、テスト雛形を提案する。
 *
 * @param apexSource - 対象の Apex クラス/トリガーのソース文字列
 * @param fallbackName - クラス名が特定できない場合のフォールバック名
 */
export function extractBranchInfo(apexSource: string, fallbackName: string): ApexBranchInfo {
  const stripped = stripCommentsAndStrings(apexSource);

  const classMatch = stripped.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
  const className = classMatch?.[1] ?? fallbackName;

  const ifCount = (stripped.match(/\bif\s*\(/g) ?? []).length;
  const elseIfCount = (stripped.match(/\belse\s+if\s*\(/g) ?? []).length;
  const whenCount = (stripped.match(/\bwhen\s+[A-Za-z_]/g) ?? []).length;
  const ternaryCount = (stripped.match(/\?[^?:]+:[^;]/g) ?? []).length;
  const branchCount = ifCount + elseIfCount + whenCount + ternaryCount;

  const catchCount = (stripped.match(/\bcatch\s*\(/g) ?? []).length;

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
