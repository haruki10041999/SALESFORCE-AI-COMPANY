import type { CliCommand } from "../types.js";

export const operationsCommands: Record<string, CliCommand> = {
  "metrics:report": {
    script: "metrics:report",
    description: "メトリクス集計レポートを出力"
  },
  "metrics:snapshot": {
    script: "metrics:snapshot",
    description: "メトリクス公開用スナップショットを生成"
  },
  "metrics:dashboard": {
    script: "metrics:dashboard",
    description: "メトリクス可視化 HTML を生成"
  },
  "observability:dashboard": {
    script: "observability:dashboard",
    description: "trace/event/governance 統合ダッシュボードを生成",
    passThroughArgs: true
  },
  "history:archive": {
    script: "history:archive",
    description: "日別チャット履歴をアーカイブし要約を生成",
    passThroughArgs: true
  },
  "dr:drill": {
    script: "dr:drill",
    description: "DR drill を実行（既定: dry-run）",
    passThroughArgs: true
  },
  "dr:restore": {
    script: "dr:restore",
    description: "outputs snapshot から DR 復元を実行",
    passThroughArgs: true
  },
  "dr:verify-backup": {
    script: "dr:verify-backup",
    description: "バックアップ snapshot の整合性を検証",
    passThroughArgs: true
  },
  "dr:compliance-report": {
    script: "dr:compliance-report",
    description: "SOC2 向け DR/SIEM コンプライアンスレポートを生成",
    passThroughArgs: true
  },
  "siem:export:audit": {
    script: "siem:export:audit",
    description: "audit log を SIEM (Splunk/Datadog/NDJSON) にエクスポート",
    passThroughArgs: true
  },
  "siem:replay-dead-letter": {
    script: "siem:replay-dead-letter",
    description: "dead-letter に退避した SIEM バッチを再送",
    passThroughArgs: true
  },
  "test:matrix": {
    script: "test:matrix",
    description: "ツールとテストの対応表を出力",
    passThroughArgs: true
  },
  "logs:remask": {
    script: "logs:remask",
    description: "既存ログのPIIを再マスク",
    passThroughArgs: true
  },
  "metrics:seed": {
    script: "metrics:seed",
    description: "サンプルメトリクスを投入"
  },
  "outputs:cleanup": {
    script: "outputs:cleanup",
    description: "outputs をクリーンアップ",
    passThroughArgs: true
  },
  "outputs:version": {
    script: "outputs:version",
    description: "outputs の世代バックアップ/復元",
    passThroughArgs: true
  },
  "learning:replay": {
    script: "learning:replay",
    description: "過去チャット履歴を再評価してレポート化",
    passThroughArgs: true
  },
  replay: {
    script: "replay:session",
    description: "記録済みツール実行を session 単位で再生/一覧表示",
    passThroughArgs: true
  },
  "evals:run": {
    script: "evals:run",
    description: "Eval Harness でオフラインベンチマークを実行 (--suite, --baseline, --ci)",
    passThroughArgs: true
  },
  "migrate:tenant-scope": {
    script: "migrate:tenant-scope",
    description: "既存データの tenant_id を一括付与 (--tenant, --dry-run)",
    passThroughArgs: true
  },
  scaffold: {
    script: "scaffold",
    description: "agent/skill/preset/tool の雛形を生成",
    passThroughArgs: true
  }
};
