/**
 * A9: 拡張セキュリティスキャン
 *
 * security-delta-scan の延長として、ファイル本文 / 追加行に対して直接
 * 適用できるセキュリティ静的解析ルールを提供する。
 *
 * 対象拡張子: .cls / .trigger / .js / .ts / .lwc.html / .xml
 *
 * 設計:
 *  - 純粋関数 + ルール定義テーブル
 *  - 各ルールは {id, severity, pattern, languages?, message}
 *  - findIssues は line 単位で評価し、行番号を返す
 *  - 既存の security-delta-scan が補えない静的観点を補完
 */

export type SecuritySeverity = "high" | "medium" | "low";

export interface SecurityScanInput {
  filePath: string;
  source: string;
}

export interface SecurityScanIssue {
  rule: string;
  severity: SecuritySeverity;
  filePath: string;
  line: number;
  snippet: string;
  detail: string;
  /** CWE ID (例: "CWE-89") */
  cwe?: string;
  /** 修正提案 (短いガイダンス) */
  remediation?: string;
}

export interface SecurityScanResult {
  totalFiles: number;
  totalIssues: number;
  issuesBySeverity: { high: number; medium: number; low: number };
  issues: SecurityScanIssue[];
}

interface RuleDef {
  id: string;
  severity: SecuritySeverity;
  pattern: RegExp;
  message: string;
  /** ファイル拡張子の限定。指定がなければ全言語適用 */
  extensions?: string[];
  /** CWE ID (例: "CWE-89") */
  cwe?: string;
  /** 修正提案 */
  remediation?: string;
}

// 行内に複数マッチがあっても 1 つにまとめる
const RULES: RuleDef[] = [
  {
    id: "soql-injection-concat",
    severity: "high",
    pattern: /Database\.(?:query|countQuery)\s*\(\s*['"][^'"]*['"]\s*\+/i,
    message: "Database.query への文字列連結が検出されました。bind 変数を使用してください。",
    extensions: [".cls", ".trigger"],
    cwe: "CWE-89",
    remediation: "文字列連結をやめ、`Database.query(soql, new Map<String, Object>{ 'p' => value })` のように bind 変数または `String.escapeSingleQuotes()` を使用する。"
  },
  {
    id: "without-sharing",
    severity: "high",
    pattern: /\bwithout\s+sharing\b/i,
    message: "without sharing 宣言が含まれます。権限制御の意図を明示してください。",
    extensions: [".cls"],
    cwe: "CWE-862",
    remediation: "`with sharing` または `inherited sharing` を使い、`without sharing` が必要な場合はコメントで理由を明記する。"
  },
  {
    id: "hardcoded-credential",
    severity: "high",
    pattern: /(?:apiKey|api_key|password|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{12,}['"]/i,
    message: "ハードコードされた資格情報の可能性があります。",
    cwe: "CWE-798",
    remediation: "Named Credential / Custom Setting / 環境変数に退避し、ソースコードから削除する。"
  },
  {
    id: "open-redirect",
    severity: "medium",
    pattern: /(?:window\.location|location\.href)\s*=\s*[^;]*\b(?:request|input|param|searchParams)\b/i,
    message: "外部入力からのリダイレクトの可能性があります。許可ドメインを検証してください。",
    extensions: [".js", ".ts"],
    cwe: "CWE-601",
    remediation: "リダイレクト先を allow-list に照合して、URL ホスト部分を規則で検証する。"
  },
  {
    id: "dom-innerhtml",
    severity: "medium",
    pattern: /\.innerHTML\s*=/,
    message: "innerHTML 代入は XSS リスクがあります。textContent or template literal を検討してください。",
    extensions: [".js", ".ts"],
    cwe: "CWE-79",
    remediation: "`element.textContent = value` や LWC の template binding を使用し、任意 HTML 探入を避ける。"
  },
  {
    id: "eval-usage",
    severity: "high",
    pattern: /\b(?:eval|Function|setTimeout|setInterval)\s*\(\s*['"]/,
    message: "eval / new Function 等による文字列実行は安全ではありません。",
    extensions: [".js", ".ts"],
    cwe: "CWE-95",
    remediation: "関数参照を渡す (`setTimeout(fn, 1000)`) か、事前定義された handler ディスパッチテーブルを使用する。"
  },
  {
    id: "console-log-secret",
    severity: "low",
    pattern: /console\.(?:log|debug|info)\s*\([^)]*\b(?:token|password|secret|apiKey)\b/i,
    message: "ログ出力に秘密情報が含まれている可能性があります。",
    cwe: "CWE-532",
    remediation: "秘密情報はログしない。必要ならマスクして (`****`) 出力する。"
  },
  {
    id: "missing-crud-check",
    severity: "medium",
    pattern: /\b(?:insert|update|upsert|delete)\s+\w+\s*;/i,
    message: "DML が直接実行されています。CRUD/FLS チェックの追加を検討してください。",
    extensions: [".cls", ".trigger"],
    cwe: "CWE-285",
    remediation: "`Schema.sObjectType.X.isCreateable()` 等で CRUD/FLS をチェックしてから DML を実行する。"
  },
  {
    id: "permissive-cors",
    severity: "medium",
    pattern: /Access-Control-Allow-Origin['"]\s*,\s*['"]\*['"]/,
    message: "Access-Control-Allow-Origin: * は不必要に広い可能性があります。",
    extensions: [".js", ".ts"],
    cwe: "CWE-942",
    remediation: "許可オリジンを明示的に列挙するか、Origin ヘッダを検証して動的設定する。"
  },
  {
    id: "weak-crypto",
    severity: "medium",
    pattern: /Crypto\.generateDigest\s*\(\s*['"](?:MD5|SHA-?1)['"]/i,
    message: "MD5 / SHA-1 は脆弱です。SHA-256 以上を使用してください。",
    extensions: [".cls"],
    cwe: "CWE-327",
    remediation: "`Crypto.generateDigest('SHA-256', ...)` 以上のアルゴリズムを使用する。"
  }
];

function fileMatchesExtension(filePath: string, extensions?: string[]): boolean {
  if (!extensions || extensions.length === 0) return true;
  const lower = filePath.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function isCommentLine(line: string, ext: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  if (ext === ".cls" || ext === ".trigger" || ext === ".js" || ext === ".ts") {
    if (trimmed.startsWith("//")) return true;
    if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  }
  return false;
}

function detectExt(filePath: string): string {
  const idx = filePath.lastIndexOf(".");
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : "";
}

export function scanSecurityRules(inputs: SecurityScanInput[]): SecurityScanResult {
  const issues: SecurityScanIssue[] = [];
  for (const file of inputs) {
    const ext = detectExt(file.filePath);
    const lines = file.source.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (isCommentLine(line, ext)) continue;
      for (const rule of RULES) {
        if (!fileMatchesExtension(file.filePath, rule.extensions)) continue;
        if (rule.pattern.test(line)) {
          issues.push({
            rule: rule.id,
            severity: rule.severity,
            filePath: file.filePath,
            line: i + 1,
            snippet: line.trim().slice(0, 200),
            detail: rule.message,
            cwe: rule.cwe,
            remediation: rule.remediation
          });
        }
      }
    }
  }

  const issuesBySeverity = { high: 0, medium: 0, low: 0 };
  for (const issue of issues) issuesBySeverity[issue.severity] += 1;

  return {
    totalFiles: inputs.length,
    totalIssues: issues.length,
    issuesBySeverity,
    issues
  };
}

export const __testables = { RULES };
