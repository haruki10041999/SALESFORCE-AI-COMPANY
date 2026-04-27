/**
 * F-04: Prompt Injection Guard
 *
 * 外部から流入する文字列 (topic / file content / appendInstruction 等) に潜む
 * prompt injection 兆候を検出し、信頼境界マーカー `<untrusted>...</untrusted>`
 * で隔離する純粋関数群を提供する。
 *
 * 設計方針:
 * - パターン検出はヒューリスティック (正規表現) のみ。LLM 不要。
 * - severity = "info" (軽度) / "warn" (要警告) / "block" (危険)。
 * - 呼び出し側が `mode` を選択:
 *   - "wrap"     既定。検出有無に関わらず `<untrusted>` でラップしてサニタイズ
 *   - "sanitize" 制御文字・非可視文字のみ除去し、ラップしない
 *   - "block"    severity >= block の場合は throw
 * - i18n / governance 連携は呼び出し側に任せる。本モジュールは純粋関数のみ。
 */

export type InjectionSeverity = "info" | "warn" | "block";

export interface InjectionPattern {
  id: string;
  description: string;
  severity: InjectionSeverity;
  pattern: RegExp;
}

export interface InjectionFinding {
  patternId: string;
  description: string;
  severity: InjectionSeverity;
  /** 一致したテキストの 0..40 文字スニペット */
  snippet: string;
  /** 一致開始オフセット (sanitize 前) */
  index: number;
}

export interface InjectionScanResult {
  findings: InjectionFinding[];
  /** すべての findings の最大 severity ("info" がデフォルト) */
  maxSeverity: InjectionSeverity;
  /** 元テキスト長 (chars) */
  originalLength: number;
  /** sanitize 後テキスト長 */
  sanitizedLength: number;
}

export type GuardMode = "wrap" | "sanitize" | "block";

export interface GuardOptions {
  /** デフォルト "wrap" */
  mode?: GuardMode;
  /** ラップ時の境界タグ名。デフォルト "untrusted" */
  boundaryTag?: string;
  /** 検出時に呼ばれるコールバック (audit ログ等) */
  onDetect?: (findings: InjectionFinding[]) => void;
  /** 追加で検査したいパターン。組み込みパターンに連結される */
  extraPatterns?: InjectionPattern[];
}

export interface GuardResult {
  /** ラップ/サニタイズ後の文字列 */
  text: string;
  /** スキャン結果 */
  scan: InjectionScanResult;
  /** mode === "block" かつ block 検出時に true。block されると例外を投げるためここでは false 固定 */
  blocked: false;
}

/**
 * 組み込みパターン。
 * 一致箇所のスニペットを記録するだけで、文字列の自動書き換えは sanitize でのみ実施。
 */
export const DEFAULT_INJECTION_PATTERNS: ReadonlyArray<InjectionPattern> = Object.freeze([
  {
    id: "ignore-previous",
    description: "previous instructions の無効化要求",
    severity: "block",
    pattern: /\b(ignore|disregard|forget)\b[^\n]{0,40}\b(previous|prior|above|all|earlier)\b[^\n]{0,30}\b(instructions?|prompts?|rules?|messages?)\b/i
  },
  {
    id: "ignore-previous-ja",
    description: "「これまでの指示を無視」系日本語",
    severity: "block",
    pattern: /(これまで|以前|過去|上記)\s*の\s*(指示|命令|プロンプト|ルール|システムメッセージ)\s*(を|は)?\s*(無視|忘れ|破棄|リセット)/u
  },
  {
    id: "system-role-override",
    description: "system / assistant ロール乗っ取り試行",
    severity: "block",
    pattern: /^\s*(system|assistant|developer)\s*[:：]/im
  },
  {
    id: "tool-impersonation",
    description: "ツール呼び出しを偽装する <tool_call> / <function_call> タグ",
    severity: "warn",
    pattern: /<\/?(tool_call|function_call|tool_response|system_prompt)\b[^>]*>/i
  },
  {
    id: "prompt-leak-request",
    description: "system prompt 漏洩要求",
    severity: "warn",
    pattern: /\b(reveal|print|show|leak|output)\b[^\n]{0,40}\b(system|hidden|secret)\b[^\n]{0,30}\b(prompt|instructions?|message)\b/i
  },
  {
    id: "credential-pattern",
    description: "API キー/シークレットらしき文字列",
    severity: "warn",
    pattern: /\b(?:sk|pk|ghp|ghs|gho|xox[baprs])-[A-Za-z0-9_-]{20,}\b/
  },
  {
    id: "ansi-escape",
    description: "ANSI エスケープシーケンス (端末乗っ取り防止)",
    severity: "warn",
    pattern: /\u001B\[[0-9;]*[A-Za-z]/u
  },
  {
    id: "non-printable-flood",
    description: "制御文字 / 非可視文字の連続 (10 文字以上)",
    severity: "info",
    pattern: /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F]{10,}/u
  }
]);

const SEVERITY_RANK: Record<InjectionSeverity, number> = { info: 0, warn: 1, block: 2 };

function maxSeverity(values: InjectionSeverity[]): InjectionSeverity {
  let max: InjectionSeverity = "info";
  for (const v of values) {
    if (SEVERITY_RANK[v] > SEVERITY_RANK[max]) max = v;
  }
  return max;
}

function snippetOf(text: string, index: number, length: number): string {
  const end = Math.min(text.length, index + Math.max(length, 1));
  const slice = text.slice(index, Math.min(end, index + 40));
  return slice.replace(/[\r\n\t]+/g, " ");
}

/**
 * テキストを走査し injection パターンを検出する。書き換えはしない。
 */
export function scanForInjection(
  text: string,
  patterns: ReadonlyArray<InjectionPattern> = DEFAULT_INJECTION_PATTERNS
): InjectionScanResult {
  const findings: InjectionFinding[] = [];
  for (const p of patterns) {
    const re = new RegExp(p.pattern.source, p.pattern.flags.includes("g") ? p.pattern.flags : p.pattern.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      findings.push({
        patternId: p.id,
        description: p.description,
        severity: p.severity,
        snippet: snippetOf(text, m.index, m[0].length),
        index: m.index
      });
      if (m.index === re.lastIndex) re.lastIndex++; // empty-match guard
    }
  }
  return {
    findings,
    maxSeverity: maxSeverity(findings.map((f) => f.severity)),
    originalLength: text.length,
    sanitizedLength: text.length
  };
}

/**
 * 制御文字 / ANSI / 双方向制御文字 を除去する。可視テキストへ正規化。
 */
export function sanitizeUntrustedText(text: string): string {
  return text
    // ANSI エスケープ全削除
    .replace(/\u001B\[[0-9;]*[A-Za-z]/gu, "")
    // 制御文字 (TAB / LF / CR は保持)
    .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, "")
    // ゼロ幅 / BiDi 制御文字
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, "");
}

export class PromptInjectionBlockedError extends Error {
  readonly findings: InjectionFinding[];
  constructor(findings: InjectionFinding[]) {
    super(`prompt injection blocked: ${findings.map((f) => f.patternId).join(", ")}`);
    this.name = "PromptInjectionBlockedError";
    this.findings = findings;
  }
}

/**
 * 信頼境界マーカーでラップしつつサニタイズする。block モードでは block 検出時に throw。
 */
export function guardUntrustedText(text: string, options: GuardOptions = {}): GuardResult {
  const { mode = "wrap", boundaryTag = "untrusted", onDetect, extraPatterns } = options;
  const patterns = extraPatterns ? [...DEFAULT_INJECTION_PATTERNS, ...extraPatterns] : DEFAULT_INJECTION_PATTERNS;

  const sanitized = sanitizeUntrustedText(text);
  const scan = scanForInjection(sanitized, patterns);
  scan.sanitizedLength = sanitized.length;
  scan.originalLength = text.length;

  if (scan.findings.length > 0 && onDetect) {
    onDetect(scan.findings);
  }

  if (mode === "block" && SEVERITY_RANK[scan.maxSeverity] >= SEVERITY_RANK.block) {
    throw new PromptInjectionBlockedError(scan.findings);
  }

  let output: string;
  if (mode === "wrap") {
    const open = `<${boundaryTag}>`;
    const close = `</${boundaryTag}>`;
    output = `${open}\n${sanitized}\n${close}`;
  } else {
    output = sanitized;
  }

  return { text: output, scan, blocked: false };
}

/**
 * 複数フィールドを一括ガード。フィールドごとの finding を集約して返す。
 */
export function guardUntrustedFields<TKeys extends string>(
  fields: Record<TKeys, string | undefined | null>,
  options: GuardOptions = {}
): {
  text: Record<TKeys, string>;
  findings: Record<TKeys, InjectionFinding[]>;
  maxSeverity: InjectionSeverity;
} {
  const text = {} as Record<TKeys, string>;
  const findings = {} as Record<TKeys, InjectionFinding[]>;
  const allFindings: InjectionFinding[] = [];

  for (const [key, value] of Object.entries(fields) as [TKeys, string | undefined | null][]) {
    if (value === undefined || value === null || value === "") {
      text[key] = "";
      findings[key] = [];
      continue;
    }
    const result = guardUntrustedText(value, options);
    text[key] = result.text;
    findings[key] = result.scan.findings;
    allFindings.push(...result.scan.findings);
  }

  return {
    text,
    findings,
    maxSeverity: maxSeverity(allFindings.map((f) => f.severity))
  };
}
