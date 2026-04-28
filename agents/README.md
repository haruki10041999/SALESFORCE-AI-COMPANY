# Agents

Salesforce AI Company に組み込まれたエージェント（役割別 AI） 一覧です。

## エージェント概要

各エージェントは専門分野を持つ AI ペルソナで、MCP ツール群を活用して Salesforce 開発支援を行います。

## エージェント一覧（17個）

| # | エージェント | 説明 |
|---|---|---|
| 1 | **apex-developer** | Apex コード開発・実装サポート |
| 2 | **architect** | システム設計・アーキテクチャ検討 |
| 3 | **ceo** | 経営判断・要件定義・優先度決定 |
| 4 | **data-modeler** | Salesforce データモデル設計 |
| 5 | **debug-specialist** | デバッグ・問題調査 |
| 6 | **devops-engineer** | CI/CD・デプロイ・運用自動化 |
| 7 | **documentation-writer** | ドキュメント作成・技術仕様書 |
| 8 | **flow-specialist** | Salesforce Flow 設計・実装 |
| 9 | **integration-developer** | API・連携・外部システム統合 |
| 10 | **lwc-developer** | Lightning Web Component 開発 |
| 11 | **performance-engineer** | パフォーマンス最適化・チューニング |
| 12 | **product-manager** | 機能企画・ロードマップ・ユーザー要件 |
| 13 | **qa-engineer** | テスト計画・品質保証・不具合検証 |
| 14 | **refactor-specialist** | コードリファクタリング・改善 |
| 15 | **release-manager** | リリース管理・go/no-go 判定 |
| 16 | **repository-analyst** | リポジトリ分析・メタデータ調査 |
| 17 | **security-engineer** | セキュリティ・監査・コンプライアンス |

## ファイル構成

```
agents/
├── apex-developer.md
├── architect.md
├── ...（17個のMarkdownファイル）
└── security-engineer.md
```

各ファイルは以下を含みます：

- **説明** — エージェントの役割・専門領域
- **得意領域** — 対応可能なタスク
- **利用ツール** — 参照するMCP ツール
- **プロンプト** — エージェント指示（YAML frontmatter）

## エージェント選択ガイド

### タスク別推奨エージェント

| タスク | 推奨エージェント |
|---|---|
| Apex コード開発 | apex-developer |
| Flow 設計 | flow-specialist |
| LWC 開発 | lwc-developer |
| API 連携 | integration-developer |
| テスト設計 | qa-engineer |
| パフォーマンス改善 | performance-engineer |
| セキュリティレビュー | security-engineer |
| システム設計 | architect |
| デプロイ計画 | devops-engineer, release-manager |
| データモデル設計 | data-modeler |
| デバッグ | debug-specialist |
| リファクタリング | refactor-specialist |
| ドキュメント作成 | documentation-writer |
| 経営判断 | ceo |
| リポジトリ調査 | repository-analyst |

## マルチエージェント実行

複数エージェントを順番に実行する場合、`preset` を活用：

```bash
npm run ai -- \
  --preset "Salesforce 開発レビュー" \
  --input "src/classes/MyClass.cls"
```

プリセットは `outputs/presets/` に保存でき、エージェント間の推奨順序・コンテキスト継承を管理できます。

## エージェント構成フォーマット

各エージェント Markdown ファイルの先頭には YAML frontmatter：

```yaml
---
name: apex-developer
description: Apex コード開発・実装サポート
tags:
  - development
  - apex
  - code-quality
expertise:
  - Apex language
  - best practices
  - performance optimization
tools:
  - apex:parse
  - apex:analyze
  - apex:test-coverage
---

# Apex Developer

説明文...
```

## 新規エージェント追加

1. `agents/my-agent.md` を作成
2. YAML frontmatter で name/description/tags を記載
3. `scripts/scaffold.ts` で自動生成可能：

```bash
npm run scaffold -- agent --name "my-agent" --description "..."
```

## 参考

- [ペルソナ一覧](../personas/README.md)（エージェントのペルソナ側面）
- [スキル一覧](../skills/README.md)（エージェントが使用するスキル）
- [コンテキスト設定](../context/README.md)（エージェント実行時のプロンプト注入）
