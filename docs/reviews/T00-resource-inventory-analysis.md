# T00 リソースインベントリ分析

> 出典: T00 ドメイン分離実装計画
> 作成日: 2026-05-14
> 対象: mcp/tools, skills, agents, personas の全リソース分類

---

## 概要

ファイル移動前に、全ツール・スキル・エージェント・ペルソナを分類。
最終的に以下の軸で整理：
- **🔵 Salesforce 特化**: Salesforce API/概念に依存 → `domains/salesforce/`
- **🟢 コア汎用**: 複数ドメイン可能 → `mcp/core/` 維持
- **🟡 開発汎用**（新提案）: コード開発全般（言語/フレームワーク非依存）→ `domains/development/`（検討中）

---

## 1. mcp/tools ツール詳細分類

### 📊 全体: 43 ツール

#### 🔵 Salesforce 特化ツール: 24 個

**分析系（6個）**:
- `apex-analyzer.ts` — Apex クラス・トリガー構文分析
- `flow-analyzer.ts` — Flow ビジュアルワークフロー分析
- `lwc-analyzer.ts` — LWC テンプレート・ロジック分析
- `permission-set-analyzer.ts` — Permission Set XML 解析
- `apex-compliance-report.ts` — Apex コンプライアンス検査
- `apex-perf-predict.ts` — Apex governor limit 予測

**依存関係グラフ系（5個）**:
- `apex-dependency-graph.ts` — Apex クラス間依存関係
- `apex-dependency-graph-incremental.ts` — インクリメンタル更新版
- `metadata-dependency-graph.ts` — メタデータ（CustomField等）依存関係
- `apex-changelog.ts` — Apex シグネチャ変更検出
- `permission-set-diff.ts` — Permission Set 差分

**デプロイ・検証系（5個）**:
- `deploy-org.ts` — SFDX `sf project deploy start` コマンド生成
- `deployment-impact-summary.ts` — デプロイ影響範囲サマリ
- `deployment-plan-generator.ts` — デプロイ計画生成
- `run-deployment-verification.ts` — デプロイ後検証実行
- `run-tests.ts` — SFDX `sf apex run test` 実行

**セキュリティ系（2個）**:
- `security-delta-scan.ts` — セキュリティ差分スキャン
- `security-rule-scan.ts` — セキュリティルール検査

**その他（6個）**:
- `org-metadata-diff.ts` — Org メタデータ差分
- `permission-set-xml.ts` — Permission Set XML 操作
- `recommend-permission-sets.ts` — Permission Set 推薦
- `suggest-flow-test-cases.ts` — Flow テストケース提案
- `recommend-skills-for-role.ts` — ロール別スキル推薦（Salesforce エージェント対応表ハードコード）

#### 🟢 コア汎用ツール: 19 個

**品質・テスト系（6個）**:
- `agent-ab-test.ts` — エージェント A/B テスト
- `agent-synergy-score.ts` — エージェント相乗効果スコア
- `analyze-test-coverage-gap.ts` — テストカバレッジギャップ分析
- `coverage-estimate.ts` — カバレッジ推定
- `changed-tests-suggest.ts` — 変更ファイル関連テスト提案
- `test-scaffold-extractor.ts` — テストスキャフォルド抽出

**リポジトリ分析系（6個）**:
- `branch-diff-summary.ts` — ブランチ差分サマリ
- `branch-diff-to-prompt.ts` — ブランチ差分 → プロンプト変換
- `git-diff-helpers.ts` — Git diff ユーティリティ
- `repo-analyzer.ts` — リポジトリ構造分析
- `metrics-summary.ts` — メトリクスサマリ
- `metrics.ts` — メトリクス計算

**開発支援系（4個）**:
- `benchmark-suite.ts` — ベンチマークスイート実行
- `refactor-suggest.ts` — リファクタリング提案
- `resource-dependency-graph.ts` — リソース依存グラフ
- `tune-prompt-templates.ts` — プロンプトテンプレート最適化

**ガバナンス系（2個）**:
- `pr-readiness-check.ts` — PR 準備度チェック（Git ベース）
- `simulate-governance-change.ts` — ガバナンス変更シミュレーション
- `suggest-cleanup-resources.ts` — 不要リソース提案

---

## 2. skills スキル詳細分類

### 📊 全体: 13 ディレクトリ

#### 🔵 Salesforce 特化スキル: 7 個

- **apex/** — Apex トリガー・クラス設計パターン（4 ファイル）
- **lwc/** — LWC テンプレート・ロジックベストプラクティス（3 ファイル）
- **salesforce-platform/** — Salesforce 基盤機能（オブジェクト・ワークフロー等）（5+ ファイル）
- **data-model/** — フィールド/オブジェクト設計（Salesforce メタデータ最適化）（2 ファイル）
- **integration/** — Named Credentials・REST API・Platform Event（2 ファイル）
- **performance/** — governor limits・SOQL 最適化・LDV（5 ファイル）
- **security/** — CRUD・FLS・SOQL injection・with sharing（5 ファイル）

#### 🟢 コア汎用スキル: 6 個

- **architecture/** — システムアーキテクチャ・設計パターン（汎用）
- **debug/** — デバッグ・トラブルシューティング手法（汎用）
- **devops/** — CI/CD・パイプライン・環境管理（汎用）
- **documentation/** — ドキュメンテーション標準・スタイルガイド（汎用）
- **refactor/** — リファクタリング原則・パターン（汎用）
- **testing/** — テスト戦略・テストケース設計（汎用）

---

## 3. agents エージェント詳細分類

### 📊 全体: 18 個

#### 🔵 Salesforce 特化エージェント: 6 個

- **apex-developer.md** — Apex コーディング・トリガー・テスト（Salesforce API依存）
- **lwc-developer.md** — LWC コンポーネント開発（Salesforce Lightning 依存）
- **flow-specialist.md** — Flow ビジュアルワークフロー設計（Salesforce Flow 依存）
- **integration-developer.md** — Salesforce ↔ 外部システム連携（Named Credentials・Callout・Platform Event）
- **performance-engineer.md** — Salesforce governor limits 最適化（SOQL・LDV・Apex 実行時間）
- **security-engineer.md** — Salesforce アクセス制御・セキュリティ（CRUD・FLS・with sharing）

#### 🟢 コア汎用エージェント: 11 個

**設計・方針系（4個）**:
- **architect.md** — システムアーキテクチャ設計
- **ceo.md** — ビジネス視点の最適化
- **data-modeler.md** — データモデル設計（汎用、Salesforce メタデータではなく論理モデル）
- **product-manager.md** — プロダクト要件・優先度

**開発支援系（3個）**:
- **documentation-writer.md** — ドキュメント作成
- **refactor-specialist.md** — リファクタリング・コード品質
- **qa-engineer.md** — テスト戦略・品質保証

**運用・保守系（3個）**:
- **debug-specialist.md** — デバッグ・トラブルシューティング
- **devops-engineer.md** — CI/CD・インフラ・環境管理
- **release-manager.md** — リリース計画・デプロイ戦略

**分析系（1個）**:
- **repository-analyst.md** — リポジトリ分析・メトリクス

---

## 4. personas ペルソナ詳細分類

### 📊 全体: 16 個 — すべて 🟢 コア汎用

ユースケース抽象層として、すべてコア汎用：

- archivist, captain, commander, detective, diplomat, doctor, engineer, gardener, hacker, historian, inventor, jedi, samurai, speed-demon, strategist

---

## 5. 新提案: 「開発汎用ドメイン」の可能性

### 背景

現在「コア汎用」19 ツール、6 スキル、11 エージェントは、単純に「非 Salesforce」というカテゴリです。
しかし、より細かく分類すると：

- **🔧 開発支援機能**: テスト・リファクタリング・デバッグ（言語・フレームワーク非依存）
- **📊 分析・メトリクス**: リポジトリ分析・テストカバレッジ・パフォーマンス計測
- **🏗 アーキテクチャ・設計**: システム設計・データモデル設計（汎用化可能）

### 候補リソース（開発汎用ドメインへの移動検討）

#### ツール（開発支援・汎用化可能: 12 個）

**テスト・品質系（6個）**:
- `analyze-test-coverage-gap.ts`
- `coverage-estimate.ts`
- `changed-tests-suggest.ts`
- `test-scaffold-extractor.ts`
- `benchmark-suite.ts`
- `agent-ab-test.ts`

**リファクタリング・コード品質（2個）**:
- `refactor-suggest.ts`
- `agent-synergy-score.ts`

**リポジトリ分析（3個）**:
- `repo-analyzer.ts`
- `metrics-summary.ts`
- `metrics.ts`

**ガバナンス・メンテナンス（1個）**:
- `suggest-cleanup-resources.ts`

**Git サポート（1個 - borderline）**:
- `git-diff-helpers.ts` または `branch-diff-summary.ts`

#### スキル（開発支援・汎用化可能: 5 個）

- **testing/** — テスト戦略・設計
- **refactor/** — リファクタリング原則
- **debug/** — デバッグ・トラブルシューティング
- **devops/** — CI/CD・環境管理
- **documentation/** — ドキュメンテーション

#### エージェント（開発支援・汎用化可能: 5-6 個）

- **qa-engineer.md** — テスト・品質
- **refactor-specialist.md** — コード品質
- **debug-specialist.md** — デバッグ
- **devops-engineer.md** — CI/CD・運用
- **documentation-writer.md** — ドキュメント

**境界型（検討必要）**:
- **data-modeler.md** — データモデル（汎用だが Salesforce では使用頻度低い）

### 新ドメイン構造案

```
domains/
  ├── salesforce/           （37 リソース）
  │   ├── agents/           （6 個）
  │   ├── skills/           （7 個）
  │   ├── tools/            （24 個）
  │   └── analysis/
  │
  ├── development/          （新）← 汎用開発支援
  │   ├── agents/           （5 個：qa, refactor, debug, devops, documentation）
  │   ├── skills/           （5 個：testing, refactor, debug, devops, documentation）
  │   ├── tools/            （12 個：テスト・品質・リポジトリ分析・ガバナンス）
  │   └── index.ts
  │
  └── core/                 （コア：汎用・抽象的）
      ├── agents/           （6 個：architect, ceo, data-modeler, product-manager, release-manager, repository-analyst）
      ├── skills/           （1 個：architecture/）
      ├── tools/            （7 個：branch-diff-*, pr-readiness-check, simulate-governance, tune-prompt-templates, etc.）
      └── personas/         （16 個）
```

### 分類軸の定義

| ドメイン | 対象 | 依存性 | 例 |
|---------|------|--------|-----|
| **salesforce** | Salesforce API・概念に直接依存 | 高 | Apex 分析、Permission Set、governor limits |
| **development** | コード開発・テスト・品質（言語非依存） | 中 | テスト設計、リファクタリング、デバッグ |
| **core** | 抽象的・汎用的な判断（全体ガバナンス・設計） | 低 | アーキテクチャ、メトリクス戦略、リソース管理 |

---

## 6. 推奨マイグレーション計画（改訂版）

### Phase 1: インフラ完成（PR-01/02）✅ 既実施

### Phase 2: ドメイン構造構築（PR-03）

#### PR-03a: Salesforce ドメイン用フォルダ作成
```
domains/salesforce/
  ├── agents/
  ├── skills/
  ├── tools/
  │   ├── analyzers/
  │   ├── deployment/
  │   ├── dependency-graph/
  │   ├── governance/
  │   ├── testing/
  │   └── org-management/
  ├── analysis/apex/
  └── index.ts
```

#### PR-03b: Development ドメイン用フォルダ作成
```
domains/development/
  ├── agents/
  ├── skills/
  ├── tools/
  │   ├── testing/
  │   ├── quality/
  │   ├── repository-analysis/
  │   └── governance/
  └── index.ts
```

#### PR-03c: SalesforcePlugin・DevelopmentPlugin 定義

### Phase 3: 段階的ファイル移動（PR-04+）

**Wave A（Salesforce, 低依存）**: Apex 分析ツール 3 個
**Wave B（Salesforce, 中依存）**: 依存グラフ・セキュリティ
**Wave C（Development, 低依存）**: テスト・品質ツール
**Wave D（Development, 中依存）**: リポジトリ分析
**Wave E（Salesforce/Development スキル・エージェント）**: ファイル移動

---

## 7. 最終集計（改訂版）

### リソース数（ドメイン別）

| リソース | Salesforce | Development | Core | 合計 |
|---------|-----------|-------------|------|------|
| **ツール** | 24 | 12 | 7 | 43 |
| **スキル** | 7 | 5 | 1 | 13 |
| **エージェント** | 6 | 5 | 6 | 18 |
| **ペルソナ** | 0 | 0 | 16 | 16 |
| **合計** | **37** | **22** | **30** | **89** |

### ファイル移動対象

- **Salesforce ドメイン**: ≈ 80+ ファイル
- **Development ドメイン**: ≈ 35+ ファイル
- **Core ドメイン**: ≈ 10+ ファイル + persona 全体

---

## 8. 実装チェックリスト

### Phase 2: ドメイン構造構築

- [ ] `domains/salesforce/` フォルダ構造作成
- [ ] `domains/development/` フォルダ構造作成
- [ ] `SalesforcePlugin` 実装（agents, skills, tools 登録）
- [ ] `DevelopmentPlugin` 実装（agents, skills, tools 登録）
- [ ] `mcp/composition-root.ts` に両プラグイン登録
- [ ] typecheck + depcruise 通過

### Phase 3: ファイル移動（Wave 毎に）

各 Wave ごと：
1. フォルダ作成
2. ファイルコピー
3. import 更新（参照元すべて）
4. 旧ファイル削除
5. typecheck + depcruise
6. テスト実行
7. commit

---

## 参考資料

- [T00 ドメイン分割実装計画書](./T00-domain-split-implementation-plan.md)
- [アーキテクチャレビュー](./persistent-ai-runtime-architecture-review.md)
