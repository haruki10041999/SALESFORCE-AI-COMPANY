# outputs ストレージ形式統一化計画

最終更新: 2026-04-28

## 目的

- outputs 配下の永続化形式を用途ごとに整理し、運用・復元・分析のコストを下げる。
- JSONL と JSON と SQLite が混在する現状で、保存責務と互換ポリシーを明確化する。
- 将来の E2E テスト拡張時に、保存先の仕様変更を安全に進められる基準を作る。

## 現状の課題

- 追記ログ系とスナップショット系が同階層に混在し、運用時の判断が難しい。
- 一部ドキュメントに過去実装(sql.js)の記述が残りやすく、実装との差分が出る。
- 履歴系は SQLite を主運用にしつつ、JSONL 互換出力もあるため、正本の定義が曖昧になりやすい。
- outputs 直下 allow-list はあるが、形式ごとの命名規則と移行手順が未統一。

## 統一方針

1. 正本と派生物を明確化する。
- 正本: 実行時に最初に書き込まれる一次データ。
- 派生物: レポート、再集計、互換エクスポート。

2. 形式の標準を用途別に固定する。
- イベントストリーム: JSONL
- 構成状態(単一オブジェクト): JSON
- 高頻度参照・更新を伴う履歴状態: SQLite
- 可視化/配布向け成果物: HTML/Markdown/JSON

3. 命名ルールを固定する。
- ログ: <domain>.jsonl
- 状態: <domain>.json
- SQLite: state.sqlite に集約
- 派生レポート: outputs/reports/<feature>/...

4. 互換レイヤを維持する。
- state:export-jsonl を残し、既存ツール連携を壊さない。
- 互換ファイルは派生物として扱い、正本ではないことを明示する。

## 対象分類と最終配置

### A. イベント/監査 (JSONL 正本)

- outputs/events/system-events.jsonl
- outputs/events/trace-log.jsonl
- outputs/events/metrics-samples.jsonl
- outputs/audit/*.jsonl
- outputs/execution-origins.jsonl

### B. 状態スナップショット (JSON 正本)

- outputs/resource-governance.json
- outputs/cleanup-schedule.json
- outputs/agent-trust-histories.json
- outputs/orgs/catalog.json

### C. 履歴ストア (SQLite 正本)

- outputs/state.sqlite
- 履歴/復元の正本は SQLite を優先。
- JSONL は移行入力または互換出力として扱う。

### D. 派生物 (非正本)

- outputs/reports/**
- outputs/dashboards/**
- outputs/history/archive/**
- outputs/exported-jsonl/**

## 実施フェーズ

### Phase 1: 仕様固定

- docs/outputs-structure.md に正本/派生の区分を追加。
- docs/configuration.md に形式ポリシーを追加。
- outputs/.schema.json の allow-list と命名ルールの整合確認。

完了条件:
- 仕様記述が 3 ドキュメントで矛盾しない。

### Phase 2: 実装整流

- 新規保存先追加時に、domain と形式を lint で検査できるよう scripts/lint-outputs.ts を拡張。
- SQLite 正本の経路に寄せられる処理を棚卸しし、二重書き込みを削減。

完了条件:
- 新規追加時に形式違反を CI で検出できる。

### Phase 3: 移行/互換運用

- state:migrate-sqlite と state:export-jsonl の運用手順を一本化。
- restore 手順で正本(SQLite)優先の復元順序を明文化。

完了条件:
- 運用手順のみで復元判断ができる(追加説明不要)。

### Phase 4: テスト強化

- 形式ポリシーに対する統合テストを追加。
- 代表ツールの出力先が意図した形式かを検証。

完了条件:
- CI で形式回帰を検知できる。

## 受け入れ基準

- 正本/派生の区分が docs で明示されている。
- outputs 直下の新規追加は命名規則に従う。
- SQLite 正本 + JSONL 互換の責務分離が運用手順に反映される。
- lint とテストで形式逸脱を検出できる。

## リスクと対策

- リスク: 既存連携が JSONL 正本前提で動作している。
- 対策: 互換出力を維持し、段階的に参照先を切替。

- リスク: ドキュメントのみ更新して実装が追随しない。
- 対策: Phase 2 で lint ルール化し、PR で自動検出。

- リスク: Windows で SQLite ファイルロックが残る。
- 対策: 停止/close 手順を operations-guide に固定記載。

## 次アクション

1. docs/outputs-structure.md に正本/派生の明示セクションを追加。
2. scripts/lint-outputs.ts に形式ポリシーの簡易検査を追加。
3. tests/outputs-schema-integration.test.ts に命名規則ケースを追加。
