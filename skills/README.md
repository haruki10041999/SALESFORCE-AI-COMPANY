# Skills

Salesforce AI 開発支援用スキルセット。各スキルは特定分野の知識・判断基準をまとめたプロンプト集です。

## スキル概要

**スキル** = 知識ドメイン + 判断基準 + ベストプラクティス

エージェントがタスク実行時に参照する外部知識源として機能します。

## スキル分類（13カテゴリ）

### 1. **Apex** (`apex/`)
Apex 言語・フレームワーク・パフォーマンス最適化。

| スキル例 | 用途 |
|---|---|
| `apex-best-practices` | コーディング規約・アンチパターン |
| `apex-async-patterns` | Batch / Future / Queueable |
| `apex-testing` | テストケース設計・カバレッジ戦略 |

### 2. **Architecture** (`architecture/`)
システム設計・パターン・スケーラビリティ。

| スキル例 | 用途 |
|---|---|
| `scalable-design` | 大規模導入向け設計 |
| `multi-cloud` | マルチクラウド対応 |

### 3. **Data Model** (`data-model/`)
Salesforce データモデル・スキーマ設計。

| スキル例 | 用途 |
|---|---|
| `object-relationship-design` | オブジェクト・関連リスト設計 |
| `custom-field-strategies` | カスタム項目選択基準 |

### 4. **Debug** (`debug/`)
デバッグ・トラブルシューティング・ログ分析。

### 5. **DevOps** (`devops/`)
CI/CD・デプロイ・インフラ運用。

| スキル例 | 用途 |
|---|---|
| `deployment-strategy` | デプロイ戦略・段階的展開 |
| `salesforce-cli-patterns` | sf CLI ベストプラクティス |

### 6. **Documentation** (`documentation/`)
技術文書・API 仕様・変更管理。

### 7. **Integration** (`integration/`)
API・連携・外部システム・データ同期。

| スキル例 | 用途 |
|---|---|
| `rest-api-design` | REST API 設計・セキュリティ |
| `data-sync-patterns` | マスタ同期・排他制御 |

### 8. **LWC** (`lwc/`)
Lightning Web Component・UI/UX。

| スキル例 | 用途 |
|---|---|
| `component-patterns` | コンポーネント設計パターン |
| `performance-optimization` | LWC パフォーマンス |

### 9. **Performance** (`performance/`)
パフォーマンス測定・チューニング・最適化。

### 10. **Refactor** (`refactor/`)
コード改善・リファクタリング・技術負債削減。

### 11. **Salesforce Platform** (`salesforce-platform/`)
Salesforce プラットフォーム全体・管理・ガバナンス。

### 12. **Security** (`security/`)
セキュリティ・監査・コンプライアンス・脆弱性対策。

| スキル例 | 用途 |
|---|---|
| `field-level-security` | FLS・OLS 設計 |
| `api-security` | API キー管理・認証 |

### 13. **Testing** (`testing/`)
テスト戦略・品質保証・不具合検証。

| スキル例 | 用途 |
|---|---|
| `test-matrix` | テストマトリクス設計 |
| `regression-testing` | リグレッション検証 |

## ファイル構成

```
skills/
├── apex/                  # Apex スキル
│   ├── apex-best-practices.md
│   ├── apex-async-patterns.md
│   └── ...
├── architecture/
├── data-model/
├── debug/
├── devops/
├── documentation/
├── integration/
├── lwc/
├── performance/
├── refactor/
├── salesforce-platform/
├── security/
└── testing/
```

## スキル構成フォーマット

各スキル Markdown の先頭には YAML frontmatter：

```yaml
---
name: apex-best-practices
category: apex
description: Apex コーディング規約・ベストプラクティス
tags:
  - apex
  - quality
  - performance
authors:
  - apex-developer
  - security-engineer
---

# Apex Best Practices

## ガイドライン

### 1. 命名規約
...

### 2. アンチパターン
...
```

## スキル利用

### エージェント実行時の自動参照

```bash
npm run ai -- --agent apex-developer --input "src/classes/MyClass.cls"
```

→ エージェント実行時に関連スキル（`apex-best-practices`, `apex-testing` 等）が自動参照されます。

### 手動スキル指定

```bash
npm run ai -- \
  --agent qa-engineer \
  --skills "test-matrix,regression-testing" \
  --input "requirements.md"
```

## スキル追加・更新

### 新規スキル作成

```bash
npm run scaffold -- skill \
  --category apex \
  --name "my-skill" \
  --description "..."
```

### スキル分類の自動学習

```bash
npm run skills:classify
```

→ 既存スキル Markdown から キーワード・タグを自動抽出し、相関関係を学習。

## スキル検索

```bash
npm run ai -- --search "apex testing patterns"
```

→ 関連スキルを検索し、スコア順に表示。

## 参考

- [エージェント一覧](../agents/README.md)（スキルを使用するエージェント）
- [ペルソナ一覧](../personas/README.md)（スキルと相性の良いペルソナ）
- [コンテキスト設定](../context/README.md)（スキル注入メカニズム）
