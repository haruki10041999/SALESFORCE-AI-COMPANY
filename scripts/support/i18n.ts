import i18next from "i18next";

const resources = {
  ja: {
    translation: {
      ai: {
        description: "Salesforce AI Company CLI",
        help: {
          commandsTitle: "Commands",
          helpCommand: "このヘルプを表示",
          examplesTitle: "Examples"
        },
        errors: {
          unknownCommand: "不明なコマンドです: {{commandName}}",
          unknownCommandHint: "使用方法は 'npm run ai -- help' を確認してください。",
          unknownCommandSuggestion: "候補: {{suggestion}}",
          extraArgs: "コマンド '{{commandName}}' は追加引数を受け取りません: {{args}}",
          spawnFailed: "npm プロセスの起動に失敗しました。",
          spawnFailedWithMessage: "npm プロセスの起動に失敗しました: {{message}}"
        }
      },
      lintOutputs: {
        spinner: {
          scan: "outputs を検証中..."
        },
        warn: {
          schemaMissing: "outputs/.schema.json not found; skip top-level schema validation.",
          staleDirectory: "stale schema entry (directory not present): {{name}}",
          staleFile: "stale schema entry (file not present): {{name}}"
        },
        ok: {
          skipped: "outputs schema validation skipped (.schema.json missing).",
          schemaMatches: "outputs/ matches schema ({{count}} entries).",
          fixed: "appended {{dirs}} dir(s), {{files}} file(s) to schema."
        },
        fail: {
          invalidSchema: "Invalid schema structure: {{details}}",
          invalidDeclarativeTools: "{{count}} invalid DeclarativeToolSpec file(s) under outputs/custom-tools/",
          unexpectedEntries: "{{count}} unexpected outputs/ entry(ies). Update '{{schemaPath}}' if intentional, or rerun with --fix to auto-append.",
          fatal: "lint-outputs failed"
        }
      }
    }
  }
} as const;

const i18n = i18next.createInstance();

void i18n.init({
  lng: "ja",
  fallbackLng: "ja",
  interpolation: { escapeValue: false },
  resources
});

export function t(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, options));
}