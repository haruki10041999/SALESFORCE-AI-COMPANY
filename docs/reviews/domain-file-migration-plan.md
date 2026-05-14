# ドメイン別ファイル移動計画（完全振り分け版）

## 目的
- 「共通機能は Core」に統一し、ドメイン実装の未分類をゼロにする。
- `mcp/` は起動・合成・実行面のみを担当し、業務ロジックを持たない状態にする。

## 最終境界（To-Be）
- `domains/salesforce/`: Salesforce 固有ロジック（Apex / Flow / LWC / PermissionSet / Org metadata）
- `domains/development/`: 開発プロセス固有ロジック（差分レビュー、テスト提案、PR準備）
- `domains/core/`: 全体共通ロジック（メモリ、ガバナンス、履歴、提案、可観測性、ベクトル、オーケストレーション）
- `mcp/`: composition root と transport のみ（`server.ts`, `tool-registry.ts`, `bootstrap.ts`, `transport*.ts` など）

---

## 1. mcp/tools 完全振り分け

### 1.1 Salesforce へ移動
- `mcp/tools/apex-analyzer.ts` -> `domains/salesforce/tools/apex/`
- `mcp/tools/apex-changelog.ts` -> `domains/salesforce/tools/apex/`
- `mcp/tools/apex-dependency-graph-incremental.ts` -> `domains/salesforce/tools/apex/`
- `mcp/tools/flow-analyzer.ts` -> `domains/salesforce/tools/flow/`
- `mcp/tools/flow-condition-simulator.ts` -> `domains/salesforce/tools/flow/`
- `mcp/tools/lwc-analyzer.ts` -> `domains/salesforce/tools/lwc/`
- `mcp/tools/org-metadata-diff.ts` -> `domains/salesforce/tools/metadata/`
- `mcp/tools/permission-set-analyzer.ts` -> `domains/salesforce/tools/metadata/`
- `mcp/tools/permission-set-diff.ts` -> `domains/salesforce/tools/metadata/`
- `mcp/tools/permission-set-xml.ts` -> `domains/salesforce/tools/metadata/`
- `mcp/tools/recommend-permission-sets.ts` -> `domains/salesforce/tools/metadata/`

### 1.2 Development へ移動
- `mcp/tools/analyze-test-coverage-gap.ts` -> `domains/development/tools/testing/`
- `mcp/tools/branch-diff-summary.ts` -> `domains/development/tools/repository-analysis/`
- `mcp/tools/branch-diff-to-prompt.ts` -> `domains/development/tools/repository-analysis/`
- `mcp/tools/changed-tests-suggest.ts` -> `domains/development/tools/testing/`
- `mcp/tools/coverage-estimate.ts` -> `domains/development/tools/testing/`
- `mcp/tools/pr-readiness-check.ts` -> `domains/development/tools/quality/`
- `mcp/tools/test-scaffold-extractor.ts` -> `domains/development/tools/testing/`

### 1.3 Core へ移動（共通機能）
- `mcp/tools/agent-ab-test.ts` -> `domains/core/tools/quality/`
- `mcp/tools/agent-synergy-score.ts` -> `domains/core/tools/quality/`
- `mcp/tools/benchmark-suite.ts` -> `domains/core/tools/quality/`
- `mcp/tools/deploy-org.ts` -> `domains/core/tools/deployment/`
- `mcp/tools/deployment-impact-summary.ts` -> `domains/core/tools/deployment/`
- `mcp/tools/deployment-plan-generator.ts` -> `domains/core/tools/deployment/`
- `mcp/tools/git-diff-helpers.ts` -> `domains/core/utils/`
- `mcp/tools/metadata-dependency-graph.ts` -> `domains/core/tools/graph/`
- `mcp/tools/metrics-summary.ts` -> `domains/core/tools/metrics/`
- `mcp/tools/metrics.ts` -> `domains/core/tools/metrics/`
- `mcp/tools/recommend-skills-for-role.ts` -> `domains/core/tools/recommendation/`
- `mcp/tools/refactor-suggest.ts` -> `domains/core/tools/refactor/`
- `mcp/tools/repo-analyzer.ts` -> `domains/core/tools/analysis/`
- `mcp/tools/resource-dependency-graph.ts` -> `domains/core/tools/graph/`
- `mcp/tools/run-deployment-verification.ts` -> `domains/core/tools/deployment/`
- `mcp/tools/run-tests.ts` -> `domains/core/tools/quality/`
- `mcp/tools/security-delta-scan.ts` -> `domains/core/tools/security/`
- `mcp/tools/simulate-governance-change.ts` -> `domains/core/tools/governance/`
- `mcp/tools/suggest-cleanup-resources.ts` -> `domains/core/tools/governance/`
- `mcp/tools/suggest-flow-test-cases.ts` -> `domains/core/tools/quality/`
- `mcp/tools/tune-prompt-templates.ts` -> `domains/core/tools/prompt/`

結果: `mcp/tools/` は空にする（最終削除対象）。

---

## 2. mcp/handlers サブフォルダ完全振り分け

### 2.1 Salesforce へ移動
- `mcp/handlers/core-apex-advanced/` -> `domains/salesforce/handlers/apex/`
- `mcp/handlers/core-flow/` -> `domains/salesforce/handlers/flow/`
- `mcp/handlers/core-metadata-diff/` -> `domains/salesforce/handlers/metadata/`
- `mcp/handlers/branch-review/scan-security-rules.ts` -> `domains/salesforce/handlers/security/`

### 2.2 Development へ移動
- `mcp/handlers/branch-review/branch-diff-summary.ts` -> `domains/development/handlers/vcs/`
- `mcp/handlers/branch-review/branch-diff-to-prompt.ts` -> `domains/development/handlers/vcs/`
- `mcp/handlers/branch-review/changed-tests-suggest.ts` -> `domains/development/handlers/testing/`
- `mcp/handlers/branch-review/pr-readiness-check.ts` -> `domains/development/handlers/quality/`
- `mcp/handlers/core-review/` -> `domains/development/handlers/review/`

### 2.3 Core へ移動（共通機能）
- `mcp/handlers/analytics/` -> `domains/core/handlers/analytics/`
- `mcp/handlers/core-chat-basic/` -> `domains/core/handlers/chat-basic/`
- `mcp/handlers/core-chat-engine/` -> `domains/core/handlers/chat-engine/`
- `mcp/handlers/core-chat-session/` -> `domains/core/handlers/chat-session/`
- `mcp/handlers/core-deployment/` -> `domains/core/handlers/deployment/`
- `mcp/handlers/core-governance/` -> `domains/core/handlers/governance/`
- `mcp/handlers/core-handler-schedule/` -> `domains/core/handlers/schedule/`
- `mcp/handlers/core-proposals/` -> `domains/core/handlers/proposals/`
- `mcp/handlers/core-recommendations/` -> `domains/core/handlers/recommendation/`
- `mcp/handlers/core-resource-apply/` -> `domains/core/handlers/resource-apply/`
- `mcp/handlers/core-resource-cleanup/` -> `domains/core/handlers/resource-cleanup/`
- `mcp/handlers/core-resource-search/` -> `domains/core/handlers/resource-search/`
- `mcp/handlers/core-skill-rating/` -> `domains/core/handlers/skill-rating/`
- `mcp/handlers/governance/` -> `domains/core/handlers/governance-admin/`
- `mcp/handlers/history/` -> `domains/core/handlers/history/`
- `mcp/handlers/lightweight/` -> `domains/core/handlers/lightweight/`
- `mcp/handlers/logging/` -> `domains/core/handlers/logging/`
- `mcp/handlers/memory/` -> `domains/core/handlers/memory/`
- `mcp/handlers/org-catalog/` -> `domains/core/handlers/org-catalog/`
- `mcp/handlers/preset/` -> `domains/core/handlers/preset/`
- `mcp/handlers/proposal-queue/` -> `domains/core/handlers/proposal-queue/`
- `mcp/handlers/resource/` -> `domains/core/handlers/resource/`
- `mcp/handlers/resource-catalog/` -> `domains/core/handlers/resource-catalog/`
- `mcp/handlers/tenant/` -> `domains/core/handlers/tenant/`
- `mcp/handlers/vector-prompt/` -> `domains/core/handlers/vector-prompt/`

結果: `mcp/handlers/` は最終的にレジストラー入口のみ残し、実装サブフォルダは空にする。

---

## 3. register-*.ts（レジストラー）の振り分け

### 3.1 ドメイン内レジストラーへ分解
- `mcp/handlers/register-core-analysis-tools.ts`
  - Salesforce 分: `domains/salesforce/registration/register-salesforce-analysis-tools.ts`
  - Development 分: `domains/development/registration/register-development-tools.ts`
  - Core 分: `domains/core/registration/register-core-tools.ts`
- `mcp/handlers/register-branch-review-tools.ts`
  - Salesforce 分: `domains/salesforce/registration/register-salesforce-review-tools.ts`
  - Development 分: `domains/development/registration/register-development-review-tools.ts`
  - Core 分: `domains/core/registration/register-core-review-tools.ts`

### 3.2 Core へ移動
以下は共通機能として Core に集約:
- `register-analytics-tools.ts`
- `register-batch-tools.ts`
- `register-chat-orchestration-tools.ts`
- `register-context-tools.ts`
- `register-export-tools.ts`
- `register-history-tools.ts`
- `register-learning-tools.ts`
- `register-logging-tools.ts`
- `register-memory-tools.ts`
- `register-org-catalog-tools.ts`
- `register-preset-tools.ts`
- `register-proposal-queue-tools.ts`
- `register-replay-tools.ts`
- `register-resource-action-tools.ts`
- `register-resource-catalog-tools.ts`
- `register-resource-governance-tools.ts`
- `register-resource-search-tools.ts`
- `register-smart-chat-tools.ts`
- `register-vector-prompt-tools.ts`

移動先: `domains/core/registration/`

---

## 4. tests の完全振り分け

- `tests/salesforce-*` 系 -> `domains/salesforce/tests/**`
- `tests/development-*` 系 -> `domains/development/tests/**`
- `tests/core-*` と共通機能テスト -> `domains/core/tests/**`
- `tests/` 直下に残るのは composition/entry 連携テストのみ

---

## 5. mcp 配下に残すもの（最小）

### 残す
- `mcp/server.ts`
- `mcp/bootstrap.ts`
- `mcp/tool-registry.ts`
- `mcp/transport.ts`, `mcp/transport-http.ts`
- `mcp/composition-root.ts`
- `mcp/core/ports/`（契約定義）
- `mcp/core/application/`（最小のオーケストレーション）

### 残さない
- `mcp/tools/**`（全移動）
- `mcp/handlers/**` の実装サブフォルダ（全移動）

---

## 6. 実行順（完全振り分け向け）

1. Salesforce 残タスクを移動して bridge 対象を拡張
2. Development 一式を移動して register 分割
3. 共通機能を Core に移動（handlers サブフォルダ含む）
4. `tool-registry.ts` を「ドメイン単位レジストラー呼び出し」に置換
5. `mcp/tools`, `mcp/handlers` 実装サブフォルダを削除
6. typecheck + 全テスト + ドキュメント更新

---

## 7. 受け入れ条件

- `mcp/tools/` が空であること
- `mcp/handlers/` に実装本体が存在しないこと
- 全ツールが `domains/{salesforce|development|core}/**` から登録されること
- `ENABLE_DOMAIN_PLUGIN_HANDLER_BRIDGE=true/false` の両モードで重複登録が起きないこと
- `npm run typecheck` と `node scripts/test.mjs` が成功すること
