/**
 * TASK-F8: ロケール解決ユーティリティ。
 * 環境変数 SF_AI_LOCALE で `ja` / `en` を切り替える。
 * 未設定または不明な値の場合は `ja` をデフォルトとする。
 */

export type Locale = "ja" | "en";

const SUPPORTED: readonly Locale[] = ["ja", "en"];

let overrideLocale: Locale | undefined;

/**
 * 現在のロケールを取得する。優先順位:
 * 1. setLocaleOverride で設定された値（テスト用）
 * 2. 環境変数 SF_AI_LOCALE
 * 3. 既定値 `ja`
 */
export function getLocale(): Locale {
  if (overrideLocale) return overrideLocale;
  const raw = process.env.SF_AI_LOCALE?.toLowerCase().trim();
  if (raw && (SUPPORTED as readonly string[]).includes(raw)) {
    return raw as Locale;
  }
  return "ja";
}

/**
 * テスト/明示的切り替え用のオーバーライド。`undefined` でクリア。
 */
export function setLocaleOverride(locale: Locale | undefined): void {
  overrideLocale = locale;
}

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED as readonly string[]).includes(value);
}
