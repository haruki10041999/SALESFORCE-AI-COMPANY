/**
 * TASK-F8: 中央集約エラーメッセージレジストリ。
 *
 * 設計方針:
 * - エラーはコード（例: `INVALID_PATH`）と `params` で識別する。
 * - 文言は `ja` / `en` 双方を保持し、`getLocale()` で切替。
 * - `AppError` クラスは `code`, `params`, `localized` を保持し、
 *   `instanceof AppError` でハンドリング側が分岐できるようにする。
 * - 既存の `throw new Error()` 箇所は段階的に置換可能。テストは
 *   文字列比較ではなく `error.code` で判定することを推奨する。
 */

import { getLocale, type Locale } from "../i18n/locale.js";

export type ErrorCode =
  | "INVALID_PATH"
  | "PATH_TRAVERSAL"
  | "DIRECTORY_NOT_FOUND"
  | "FILE_NOT_FOUND"
  | "AMBIGUOUS_NAME"
  | "TOOL_NOT_FOUND"
  | "INVALID_INPUT"
  | "MISSING_REQUIRED_FIELD"
  | "DUPLICATE_VERSION"
  | "UNKNOWN_MODEL"
  | "GIT_COMMAND_FAILED"
  | "INVALID_GIT_REF"
  | "NOT_A_GIT_REPO"
  | "RESOURCE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

type MessageTemplate = (params: Record<string, unknown>) => string;

type LocaleMessages = Record<ErrorCode, MessageTemplate>;

const JA: LocaleMessages = {
  INVALID_PATH: (p) => `パスが不正です: ${p.path ?? ""}${p.detail ? ` (${p.detail})` : ""}`,
  PATH_TRAVERSAL: (p) => `パストラバーサルは許可されていません: ${p.path ?? ""}`,
  DIRECTORY_NOT_FOUND: (p) => `ディレクトリが見つかりません: ${p.path ?? ""}`,
  FILE_NOT_FOUND: (p) => `ファイルが見つかりません: ${p.path ?? ""}`,
  AMBIGUOUS_NAME: (p) => `名前が曖昧です: ${p.name ?? ""}。候補: ${p.candidates ?? ""}`,
  TOOL_NOT_FOUND: (p) => `ツールが見つかりません: ${p.name ?? ""}`,
  INVALID_INPUT: (p) => `入力が不正です: ${p.field ?? ""}${p.detail ? ` - ${p.detail}` : ""}`,
  MISSING_REQUIRED_FIELD: (p) => `必須フィールドが指定されていません: ${p.field ?? ""}`,
  DUPLICATE_VERSION: (p) => `既に登録済みのバージョンです: ${p.name ?? ""}@${p.version ?? ""}`,
  UNKNOWN_MODEL: (p) => `未知のモデルです: ${p.name ?? ""}`,
  GIT_COMMAND_FAILED: (p) => `git コマンドが失敗しました (${p.command ?? ""}): ${p.detail ?? ""}`,
  INVALID_GIT_REF: (p) => `${p.field ?? "ref"} が不正です: ${p.value ?? ""}`,
  NOT_A_GIT_REPO: (p) => `git リポジトリではありません: ${p.path ?? ""}`,
  RESOURCE_LIMIT_EXCEEDED: (p) => `リソース上限を超過しました: ${p.resource ?? ""} (${p.detail ?? ""})`,
  INTERNAL_ERROR: (p) => `内部エラー: ${p.detail ?? ""}`
};

const EN: LocaleMessages = {
  INVALID_PATH: (p) => `Invalid path: ${p.path ?? ""}${p.detail ? ` (${p.detail})` : ""}`,
  PATH_TRAVERSAL: (p) => `Path traversal is not allowed: ${p.path ?? ""}`,
  DIRECTORY_NOT_FOUND: (p) => `Directory not found: ${p.path ?? ""}`,
  FILE_NOT_FOUND: (p) => `File not found: ${p.path ?? ""}`,
  AMBIGUOUS_NAME: (p) => `Ambiguous name: ${p.name ?? ""}. Candidates: ${p.candidates ?? ""}`,
  TOOL_NOT_FOUND: (p) => `Tool not found: ${p.name ?? ""}`,
  INVALID_INPUT: (p) => `Invalid input: ${p.field ?? ""}${p.detail ? ` - ${p.detail}` : ""}`,
  MISSING_REQUIRED_FIELD: (p) => `Missing required field: ${p.field ?? ""}`,
  DUPLICATE_VERSION: (p) => `Version already registered: ${p.name ?? ""}@${p.version ?? ""}`,
  UNKNOWN_MODEL: (p) => `Unknown model: ${p.name ?? ""}`,
  GIT_COMMAND_FAILED: (p) => `git command failed (${p.command ?? ""}): ${p.detail ?? ""}`,
  INVALID_GIT_REF: (p) => `Invalid ${p.field ?? "ref"}: ${p.value ?? ""}`,
  NOT_A_GIT_REPO: (p) => `Not a git repository: ${p.path ?? ""}`,
  RESOURCE_LIMIT_EXCEEDED: (p) => `Resource limit exceeded: ${p.resource ?? ""} (${p.detail ?? ""})`,
  INTERNAL_ERROR: (p) => `Internal error: ${p.detail ?? ""}`
};

const REGISTRY: Record<Locale, LocaleMessages> = { ja: JA, en: EN };

export function formatMessage(
  code: ErrorCode,
  params: Record<string, unknown> = {},
  locale: Locale = getLocale()
): string {
  const table = REGISTRY[locale] ?? JA;
  const tpl = table[code] ?? JA[code];
  return tpl(params);
}

/**
 * 例外発生位置に関する追加コンテキスト。
 * `AppError` に optional で付与し、root cause 追跡を容易にする。
 */
export interface AppErrorContext {
  /** 関連するソースファイルやデータファイルのパス */
  filePath?: string;
  /** ファイル内の行番号 (1-indexed) */
  line?: number;
  /** 失敗が発生した関数 / メソッド名 */
  functionName?: string;
}

/**
 * ローカライズされた `Error` サブクラス。
 * `error.code` で機械判定し、`error.message` は現在ロケールでの文言。
 * `error.context` で発生箇所のヒント (filePath/line/functionName) を保持できる。
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly params: Readonly<Record<string, unknown>>;
  public readonly locale: Locale;
  public readonly context?: Readonly<AppErrorContext>;

  constructor(
    code: ErrorCode,
    params: Record<string, unknown> = {},
    context?: AppErrorContext
  ) {
    const locale = getLocale();
    super(formatMessage(code, params, locale));
    this.name = "AppError";
    this.code = code;
    this.params = Object.freeze({ ...params });
    this.locale = locale;
    if (context && (context.filePath || context.line !== undefined || context.functionName)) {
      this.context = Object.freeze({ ...context });
    }
  }

  /** 別ロケールでメッセージを取得する。 */
  toLocale(locale: Locale): string {
    return formatMessage(this.code, { ...this.params }, locale);
  }

  /** 既存インスタンスにコンテキストを追加した新しい AppError を返す。 */
  withContext(context: AppErrorContext): AppError {
    const merged: AppErrorContext = { ...(this.context ?? {}), ...context };
    return new AppError(this.code, { ...this.params }, merged);
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
