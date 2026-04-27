# ドキュメント索引

## まず読む 5 つ (最短経路)

1. [README.md](../README.md) — プロジェクト全体像と起動方法
2. [architecture.md](./architecture.md) — システム設計概要
3. 用途別エントリ:
   - 運用したい → [operations-guide.md](./operations-guide.md)
   - 開発したい → [developer-guide.md](./developer-guide.md)
4. [configuration.md](./configuration.md) — 環境変数・設定キー一覧
5. [feature-usage-guide.md](./feature-usage-guide.md) — 主要機能のユースケース集

> 上記 5 つを読めば日常作業はカバーできます。以下は必要に応じて参照してください。

## 詳細リファレンス

- 出力構成: [outputs-structure.md](./outputs-structure.md)
- 学習の仕組み: [learning-guide.md](./learning-guide.md)
- 指標評価: [metrics-evaluation.md](./metrics-evaluation.md)
- 検証手順: [verification-guide.md](./verification-guide.md)
- 全機能動作確認: [full-feature-verification.md](./full-feature-verification.md)
- リソース一覧: [resource-inventory.md](./resource-inventory.md)
- OpenCode セットアップ: [opencode-setup.md](./opencode-setup.md)
- 変更履歴: [CHANGELOG.md](./CHANGELOG.md)
- Declarative tool 例 (JSON):
  - compose-prompt 型: [examples/declarative-tool.compose-prompt.example.json](./examples/declarative-tool.compose-prompt.example.json)
  - static-text 型: [examples/declarative-tool.static-text.example.json](./examples/declarative-tool.static-text.example.json)

## 機能別仕様 (docs/features)

| # | ドキュメント |
|---|---|
| 01 | [静的解析](./features/01-static-analysis.md) |
| 02 | [リポジトリ解析](./features/02-repository-analysis.md) |
| 03 | [ブランチ差分/PR](./features/03-branch-diff-pr.md) |
| 04 | [デプロイ](./features/04-deployment.md) |
| 05 | [チャット生成](./features/05-chat-generation.md) |
| 06 | [オーケストレーション](./features/06-orchestration.md) |
| 07 | [ログ/履歴](./features/07-logging-history.md) |
| 08 | [定義/プリセット](./features/08-presets-definitions.md) |
| 09 | [リソースガバナンス](./features/09-resource-governance.md) |
| 10 | [イベント自動化](./features/10-event-automation.md) |
| 11 | [メトリクス/ベンチマーク](./features/11-metrics-benchmarks.md) |
