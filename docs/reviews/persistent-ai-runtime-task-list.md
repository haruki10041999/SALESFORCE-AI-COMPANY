# Persistent AI Runtime — 改善タスク一覧

> 元レビュー: [persistent-ai-runtime-architecture-review.md](persistent-ai-runtime-architecture-review.md)
> 形式: タスク名 / 変更内容 / 実装方針 / 修正ファイル一覧 / メリット / デメリット
> 優先度凡例: **P0 = 即時 / P1 = 1-2Q / P2 = 2-3Q / P3 = 中長期**

---

## サマリ表 (一覧)

| ID | 優先度 | Phase | タスク名 | 工数 | リスク |
|---|---|---|---|---|---|
| TASK-01 | P0 | 1 | Cost Ledger の実装と Budget 強制 | 中 | 低 |
| TASK-02 | P0 | 1 | MCP Tool Surface の階層化 (113 → 20-30) | 中 | 中 |
| TASK-03 | P0 | 1 | Embedding Provider Multiplexer 化 | 低 | 低 |
| TASK-04 | P0 | 1 | Dead code 除去 (`prompt-engine/`, `memory/` 統合) | 低 | 低 |
| TASK-05 | P0 | 1 | OTel Sampling / PII Redactor 設定 | 低 | 低 |
| TASK-06 | P1 | 2 | Durable Workflow Engine (Temporal) POC | 高 | 高 |
| TASK-07 | P1 | 2 | Reflection / Critique Loop 構築 | 中 | 中 |
| TASK-08 | P1 | 2 | Eval Harness の CI 統合 | 中 | 低 |
| TASK-09 | P1 | 2 | scripts/ 棚卸し + 統合 CLI | 中 | 低 |
| TASK-10 | P1 | 2 | Tenant Quota / Rate Limit 強化 | 中 | 中 |
| TASK-11 | P2 | 3 | OPA / Cedar による Policy as Code | 高 | 中 |
| TASK-12 | P2 | 3 | Event Sourcing 層導入 | 高 | 高 |
| TASK-13 | P2 | 3 | Vector DB Pluggable (Qdrant/LanceDB adapter) | 中 | 中 |
| TASK-14 | P2 | 3 | Bounded Context 再配置 | 高 | 高 |
| TASK-15 | P2 | 3 | Replay Debugger UI | 中 | 低 |
| TASK-16 | P3 | 4 | HA / Leader Election | 高 | 高 |
| TASK-17 | P3 | 4 | Knowledge Graph 推論強化 | 中 | 中 |
| TASK-18 | P3 | 4 | DR Automation / SIEM 連携 | 中 | 中 |
| TASK-19 | P3 | 4 | LearningOrchestrator (shadow→canary→promote 自動化) | 高 | 高 |
| TASK-20 | P3 | 4 | dashboard-as-code 化 | 低 | 低 |

## Phase1 残タスク状況 (2026-05-13)

| Task | 状況 | 備考 |
|---|---|---|
| TASK-01 Cost Ledger | 完了 | governance 実行経路へ cost 記録を統合済み |
| TASK-02 Tool Surface / smart_chat 統合 | 完了 | tool categorizer を smart_chat の優先度計算へ反映済み |
| TASK-03 Embedding Provider Multiplexer | 完了 | multiplexer 実装 + テスト通過 |
| TASK-04 Dead code 除去 / memory 統合 | 完了 | memory barrel の export 不整合を修正し回帰通過 |
| TASK-05 OTel Sampling / PII Redaction | 完了 | redaction と sampling 指標テスト通過 |

- Phase1 の残タスク: なし
- 最新検証: [tests/server-tools.integration.test.ts](tests/server-tools.integration.test.ts) 53 件成功 (2026-05-13)

## Phase2 残タスク状況 (2026-05-13)

| Task | 状況 | 備考 |
|---|---|---|
| TASK-06 Durable Workflow Engine (Temporal) POC | 完了 | `start/query/replay` port 追加、temporal adapter + client/worker 接続追加、activity 配線、fallback 縮小、retry policy 設定化、observability/CI 統合まで完了 |
| TASK-07 Reflection / Critique Loop | 完了 | Critic port + self_refine_response 連携 + critique JSONL 記録 + rubric 透過 + proposal 自動連携 + learning dashboard 集計 + judge/heuristic の品質閾値設定化まで完了 |
| TASK-08 Eval Harness CI 統合 | 完了 | `scripts/eval-suite.ts` + GitHub Actions `eval.yml` で baseline 比較を CI 化 |
| TASK-09 scripts/ 棚卸し + 統合 CLI | 完了 | `scripts/cli/*` にコマンド定義分離 + `sf-ai` bin 追加 + README/operations-guide 更新 |
| TASK-10 Tenant Quota / Rate Limit 強化 | 完了 | PostgresQuotaStore + tenant+tool quota table/migration + 429 応答/Prometheus quota gauge 追加 |

- TASK-06 実装済み:
  - workflow engine port に `start/query/replay` を追加 (既存API互換維持)
  - `temporal` モード adapter を追加し、Temporal client 接続を統合 (失敗時 fallback 維持)
  - Temporal workflow worker 起動ヘルパーを追加 (`SF_AI_TEMPORAL_RUN_WORKER=true` で server 内起動)
  - `SF_AI_WORKFLOW_ENGINE=in-process|temporal` による runtime 切替を導入
  - `server` / `tool-registry` を factory 経由へ切替
  - `orchestrate_chat` 開始経路を `workflowEngine.start` 呼び出しへ切替（response に workflow handle を追加）
  - Temporal workflow に query/signal/state を実装し、worker activity 経由で queue/step 永続化を同期
  - Temporal 利用時は `query/signal/retry/markDequeued/completeStep/failStep` で fallback 依存を削減し、Temporal 失敗時のみ fallback へ退避
  - workflow start / activity retry policy を env で明示化 (`SF_AI_TEMPORAL_WORKFLOW_RETRY_MAX_ATTEMPTS`, `SF_AI_TEMPORAL_ACTIVITY_*`)
  - workflow profile 用 compose 追加と env/README の運用導線を追加
  - workflow engine focused tests 成功 (10 passed) + 実 Temporal 統合テストを CI に組み込み
  - Temporal fallback / signal 失敗を Prometheus で観測可能化 (`sfai_temporal_workflow_operations_total`, `sfai_temporal_workflow_fallback_total`)
  - `npm run typecheck` 通過
- TASK-06 残タスク:
  - なし (POC 範囲は完了。以降の拡張は TASK-07 以降または運用改善として扱う)

- TASK-07 実装済み:
  - `mcp/core/ports/critic.ts` を追加し、Critique の戻り値と next action を型定義
  - `mcp/core/learning/critic-loop.ts` で self-refine ループを包み、`learning/critic-runs.jsonl` に記録
  - `mcp/core/application/prompt/services/prompt-quality-operations.ts` から Critic ライフサイクルを経由するように変更
  - `mcp/core/learning/self-refine-loop.ts` の refine prompt に rubric label / description を反映
  - `mcp/core/learning/critic-loop.ts` から proposal queue へ low-score 連携を追加
  - `mcp/core/learning/learning-dashboard-generator.ts` で critique / proposal 実績を集計
  - `mcp/core/config/runtime-config.ts` で judge / heuristic / proposal / min-improvement 閾値を env から読めるように設定
  - `tests/self-refine-loop.test.ts` で critique 記録と rubric 透過を検証
- TASK-07 残タスク:
  - なし

---

## TASK-01: Cost Ledger の実装と Budget 強制

- **優先度**: P0
- **変更内容**: `composition-root.ts` で「placeholder」と明記された `costLedger` を実装。token / API call ごとに記録し、予算しきい値超過で `governanceGate` がツール呼び出しを拒否する。
- **実装方針**:
  1. `mcp/core/ports/cost-ledger-port.ts` の interface を `record(usage)` / `spend(window)` / `enforce(budget)` に整理
  2. `mcp/core/cost/postgres-cost-ledger.ts` を新設 (drizzle: 既存 `cost-ledger` table 使用)
  3. `LLMGateway` 実装に `CostLedgerDecorator` を挿入、chat/embed 後に自動 record
  4. `governanceGate.isToolEnabled` で日次予算超過チェック
  5. Prometheus に `ai_cost_total{model,tenant}` を export
- **修正ファイル**:
  - `mcp/composition-root.ts`
  - `mcp/core/ports/cost-ledger-port.ts`
  - `mcp/core/cost/postgres-cost-ledger.ts` (新規)
  - `mcp/core/llm/llm-gateway.ts` (decorator 追加)
  - `mcp/core/governance/governance-gate.ts`
  - `mcp/core/observability/prometheus-metrics.ts`
  - `db/schema/cost-ledger.ts` (必要なら column 追加)
  - `tests/cost-ledger/*` (新規)
- **メリット**:
  - LLM コスト暴走を確実に止められる (ROI 最大)
  - tenant 別課金/原価計算の基盤
  - Prometheus 連携で予算アラート可能
- **デメリット**:
  - 全 LLM 呼び出しに decorator 介入 → 1ms 程度の latency 増
  - 予算誤設定で正常リクエストが拒否されるリスク → soft-limit / hard-limit の二段階運用必須

---

## TASK-02: MCP Tool Surface の階層化 (113 → 20-30)

- **優先度**: P0
- **変更内容**: 現在 MCP に 113+ ツールを露出しているのを、Tier1 (20-30 個の coarse-grained capability) と Tier2 (内部 dispatch) に分割。LLM に見せるのは Tier1 のみ。
- **実装方針**:
  1. `mcp/surface/tool-tier.ts` を新設し、Tier1 capability を定義 (`chat`, `smart_chat`, `orchestrate`, `recall`, `propose`, `approve`, `analyze`, `report`, `health`, `replay` など)
  2. 既存 113 ツールを Tier2 として `internal-tool-registry.ts` に隔離
  3. Tier1 ツールが `subTool: string, args: object` を受け取り内部 dispatch
  4. `tool-registry.ts` を Tier1 のみ MCP に register するよう変更
  5. `MCP_TOOL_TIER=full|tiered` で旧動作 fallback を残す
- **修正ファイル**:
  - `mcp/surface/index.ts`
  - `mcp/tool-registry.ts`
  - `mcp/surface/tool-tier.ts` (新規)
  - `mcp/surface/internal-tool-registry.ts` (新規)
  - `mcp/handlers/register-*.ts` (Tier 振り分け追加)
  - `mcp/env-schema.ts`
  - `docs/architecture.md`, `mcp/README.md`
- **メリット**:
  - LLM の tool selection 精度が劇的に回復 (50+ で f1 30%劣化を回避)
  - system prompt の token 消費が ~22k → ~5k に削減 (cost↓)
  - 機能追加が surface 圧迫しない
- **デメリット**:
  - 既存 client (Claude Desktop / OpenCode preset) との互換破壊 → tiered 移行期間で fallback 必要
  - Tier1→Tier2 dispatch で 1-hop 増 → debug 難度↑
  - sub-tool パラメータの型安全が JSON schema で緩む

---

## TASK-03: Embedding Provider Multiplexer 化

- **優先度**: P0
- **変更内容**: 現在 Ollama デフォルト + n-gram fallback の 2 段だが、provider lock-in。OpenAI / Voyage / Bedrock / Cohere を追加し、`EmbeddingProvider` port 経由で切替可能にする。
- **実装方針**:
  1. `mcp/core/ports/embedding-provider.ts` を `embed(texts, opts) → number[][]` + `dimension` + `modelId` に整理
  2. `OpenAIEmbeddingProvider` `BedrockEmbeddingProvider` `VoyageEmbeddingProvider` を追加
  3. `EmbeddingProviderRouter` (model alias → provider) を新設
  4. dimension 整合は migration 0005 (`embedding-metadata`) を活用、provider 変更時に再embed 警告
  5. `EMBEDDING_PROVIDER=ollama|openai|voyage|bedrock|router` を env で受付
- **修正ファイル**:
  - `mcp/core/ports/embedding-provider.ts`
  - `mcp/core/llm/embedding-provider.ts`
  - `mcp/core/llm/providers/openai-embedding.ts` (新規)
  - `mcp/core/llm/providers/voyage-embedding.ts` (新規)
  - `mcp/core/llm/providers/bedrock-embedding.ts` (新規)
  - `mcp/core/llm/embedding-router.ts` (新規)
  - `memory/vector-store-adapter.ts` (provider 渡し)
  - `mcp/env-schema.ts`
  - `tests/embedding/*` (新規)
- **メリット**:
  - Ollama 障害でも本番運用継続可能
  - tenant 別 / 用途別に最適 embedding を選択可能 (cost vs quality)
  - 将来の provider 追加が adapter 1ファイルで済む
- **デメリット**:
  - dimension 不一致による再 embed コスト発生
  - provider 別 API キー管理が secrets backend を圧迫
  - test matrix が増加

---

## TASK-04: Dead code 除去 (`prompt-engine/`, `memory/` 統合)

- **優先度**: P0
- **変更内容**: `prompt-engine/` は `mcp/core/prompt/` への re-export のみ → 削除。`memory/` (top-level) と `mcp/core/memory/` の二重を統合。
- **実装方針**:
  1. `prompt-engine/` の import 元を `mcp/core/prompt/*` に書き換え
  2. `prompt-engine/` ディレクトリ削除
  3. `memory/` を `mcp/core/memory/` 配下に物理移動 (vector-store / hierarchical-store / chunker / KG)
  4. `tsconfig.json` paths / barrel export 更新
  5. CHANGELOG に breaking change 記録
- **修正ファイル**:
  - `prompt-engine/*` (削除)
  - `memory/*` (削除 → `mcp/core/memory/` へ移動)
  - `tsconfig.json`
  - `mcp/composition-root.ts`
  - `mcp/handlers/**/*.ts` (import path 更新)
  - `tests/memory/*`
  - `docs/CHANGELOG.md`
- **メリット**:
  - 層境界が明確化 (1 directory = 1 responsibility)
  - 新規参加者の混乱解消
  - `mcp/core/` 内に全 runtime コードが集約
- **デメリット**:
  - import path の widespread な変更 (PR 巨大化)
  - 外部 consumer がいる場合 breaking change

---

## TASK-05: OTel Sampling / PII Redactor 設定

- **優先度**: P0
- **変更内容**: 現状 OTel SDK 採用済だが sampling policy 不在。trace explosion / PII 漏洩リスクあり。tail-based sampling と PII redactor を導入。
- **実装方針**:
  1. `mcp/core/observability/otel-tracer.ts` に `ParentBased` + `TraceIdRatioBased(0.1)` sampler を導入
  2. error span / slow span は always-sample
  3. `mcp/core/observability/pii-redactor.ts` 新設、span attributes に正規表現ベース redact 適用 (email/phone/PII keyword)
  4. `OTEL_TRACES_SAMPLER_ARG` を env で調整可能に
  5. log にも `mcp/core/logging/pii-masker.ts` を強化適用
- **修正ファイル**:
  - `mcp/core/observability/otel-tracer.ts`
  - `mcp/core/observability/pii-redactor.ts` (新規)
  - `mcp/core/logging/pii-masker.ts`
  - `mcp/env-schema.ts`
  - `infra/observability/prometheus.yml` (sampler metric)
  - `tests/observability/*`
- **メリット**:
  - OTel collector OOM の予防
  - GDPR / PII compliance 強化
  - 本番 trace 容量を 1/10 に削減可能
- **デメリット**:
  - sampling 率を誤ると debug 時に必要 trace が消える
  - redactor の regex chunk 漏れリスク → false negative
  - tail-based sampling は collector 側設定も必要

---

## TASK-06: Durable Workflow Engine (Temporal) POC

- **優先度**: P1
- **変更内容**: in-process workflow engine がプロセスクラッシュで in-flight job 喪失する問題に対し、Temporal を `WorkflowEngine` port の adapter として導入。既存 in-process と coexistence で段階移行。
- **実装方針**:
  1. `WorkflowEngine` port を `start / signal / query / replay` に整理
  2. `mcp/core/orchestration/temporal-workflow-engine.ts` を新設
  3. docker-compose.yml に Temporal server を `profile=workflow` で追加
  4. 最初の対象は `orchestrate_chat` の long-running multi-agent ワークフロー
  5. `WORKFLOW_ENGINE=in-process|temporal` で切替
  6. activity heartbeat / retry policy を default 設定
- **修正ファイル**:
  - `mcp/core/ports/workflow-engine.ts`
  - `mcp/core/orchestration/in-process-workflow-engine.ts`
  - `mcp/core/orchestration/temporal-workflow-engine.ts` (新規)
  - `mcp/core/orchestration/workflows/orchestrate-chat.workflow.ts` (新規)
  - `mcp/composition-root.ts`
  - `docker-compose.yml`
  - `package.json` (`@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`)
  - `mcp/env-schema.ts`
  - `tests/orchestration/temporal/*`
- **メリット**:
  - long-running workflow が durable に (プロセス再起動耐性)
  - retry / timeout / saga が標準化
  - replay debugging が Temporal UI で可能
- **デメリット**:
  - インフラ依存 (Temporal cluster 運用) が増える
  - 学習コスト 大 (workflow vs activity 区別、deterministic制約)
  - 既存 in-process との二重維持が一定期間必要

---

## TASK-07: Reflection / Critique Loop 構築

- **優先度**: P1
- **変更内容**: LLM 出力に対する self-critique を別ライフサイクルで実行し、品質を `ai_quality_score` として記録。低スコアは自動再生成 or proposal 化。
- **実装方針**:
  1. `mcp/core/ports/critic.ts` に `Critic.critique(input, output)` 定義
  2. `LlmAsJudgeCritic` 実装 (別 model / shadow)
  3. `self_refine_response` 既存 tool を critic 経由に再構成
  4. critique result を `quality-rubric.ts` に統合し score 永続化
  5. quality < threshold 時に proposal queue へ自動連携し、学習ダッシュボードへ集計
- **修正ファイル**:
  - `mcp/core/ports/critic.ts` (新規)
  - `mcp/core/llm/llm-as-judge-critic.ts` (新規)
  - `mcp/core/llm/quality-rubric.ts`
  - `mcp/handlers/register-self-refine-tools.ts`
  - `mcp/core/learning/reflection-loop.ts` (新規)
  - `mcp/core/learning/critic-loop.ts`
  - `mcp/core/learning/learning-dashboard-generator.ts`
  - `tests/learning/reflection/*`
  - `tests/self-refine-loop.test.ts`
- **メリット**:
  - self-improvement loop が「閉ループ」に近づく
  - 低品質出力の自動リトライで UX 向上
  - 学習データ (quality score) が蓄積
- **デメリット**:
  - LLM 呼び出しが 2x 化 → cost 増 (TASK-01 と組合せ必須)
  - judge model の bias が品質判断を歪める
  - latency 増 (sync critique は禁止、async 推奨)

---

## TASK-08: Eval Harness の CI 統合

- **優先度**: P1
- **変更内容**: 現在 `scripts/` 内に存在する eval harness を CI に組込み、PR ごとに regression 検出。Promptfoo / Ragas 名義の adapter を経由し、baseline を repo 内で比較する。
- **実装方針**:
  1. `PromptfooAdapter` / `RagasAdapter` を実装
  2. `scripts/eval-suite.ts` を CI 用に整備
  3. GitHub Actions: `pull_request` で eval 実行、ベースラインと比較し閾値超過で fail
  4. eval baseline を `tests/evals/baselines/` に固定
- **修正ファイル**:
  - `mcp/core/learning/adapters/promptfoo-adapter.ts` (新規)
  - `mcp/core/learning/adapters/ragas-adapter.ts` (新規)
  - `scripts/eval-suite.ts`
  - `.github/workflows/eval.yml` (新規)
  - `package.json`
  - `tests/evals/baselines/agent-selection.json` (新規)
  - `tests/evals/baselines/prompt-templates.json` (新規)
- **メリット**:
  - regression を PR 単位で検出
  - baseline を repo で固定し、CI が毎回同じ比較条件で動く
  - existing eval harness を再利用して追加の外部依存を増やさない
- **デメリット**:
  - CI 実行時間が伸びる (LLM call 含む)
  - eval 用 LLM コスト
  - flaky tests の懸念 (LLM 出力非決定性) → seed/temperature 固定で緩和

---

## TASK-09: scripts/ 棚卸し + 統合 CLI

- **優先度**: P1
- **変更内容**: `scripts/` 40+ の用途分類が無く運用ガバナンス不在。`commander` ベースの統合 CLI (`sf-ai`) に再編。
- **実装方針**:
  1. `scripts/cli/` を作成し、コマンド階層を定義 (`sf-ai migrate`, `sf-ai analyze`, `sf-ai replay`, `sf-ai eval` など)
  2. 既存スクリプトをサブコマンドの実装にラップ
  3. `package.json` の `bin` に `sf-ai` 登録
  4. README / docs/operations-guide.md に CLI reference 追加
  5. 廃止候補スクリプトに deprecation 警告
- **修正ファイル**:
  - `scripts/cli/index.ts` (新規)
  - `scripts/cli/commands/*.ts` (新規)
  - `scripts/*` (一部 wrap, 一部廃止)
  - `package.json`
  - `docs/operations-guide.md`
- **メリット**:
  - 運用者が「どの script を使えばいいか」明確
  - 廃止スクリプトの整理機会
  - Help / autocomplete で DX 向上
- **デメリット**:
  - 既存 ops 手順書の更新が必要
  - 移行期間中は 2 系統並走

- **実装済み (2026-05-13)**:
  - `scripts/cli/index.ts` と `scripts/cli/commands/*.ts` を新設して CLI 定義を分離
  - `scripts/ai.ts` はコマンド実行器に整理し、help/examples を CLI レジストリから生成
  - `scripts/sf-ai.cjs` を追加し、`package.json` `bin.sf-ai` で公開
  - `README.md` / `docs/operations-guide.md` に `sf-ai` 導線と移行注意を追記

---

## TASK-10: Tenant Quota / Rate Limit 強化

- **優先度**: P1
- **変更内容**: 現 reliability 層は単機 rate limiter のみ。tenant 単位の quota を導入し騒がしい隣人問題を防ぐ。
- **実装方針**:
  1. `mcp/core/ports/rate-limiter.ts` 整理 (`allow(key, cost)`)
  2. `PostgresQuotaStore` (token bucket / sliding window) を実装
  3. `tenant + tool` キーで quota 管理、超過時 429 相当返却
  4. `config/budgets/` に tenant 別設定を追加
  5. Prometheus に `ai_quota_remaining{tenant}` export
- **修正ファイル**:
  - `mcp/core/ports/rate-limiter.ts`
  - `mcp/core/reliability/postgres-quota-store.ts` (新規)
  - `mcp/core/governance/governance-gate.ts`
  - `config/budgets/tenant-defaults.yaml` (新規)
  - `mcp/core/observability/prometheus-metrics.ts`
  - `db/schema/` (quota table 追加 → 新 migration)
  - `tests/reliability/quota/*`
- **メリット**:
  - SaaS 化への基盤
  - 1 tenant の暴走で全体停止を防ぐ
  - cost-ledger と組合せで billing 連携可能
- **デメリット**:
  - DB ラウンドトリップが増 (毎リクエスト) → cache 必要
  - quota 設計ミスで legitimate user が拒否される
  - clock skew で sliding window が誤動作するリスク

- **実装済み (2026-05-13)**:
  - `mcp/core/reliability/postgres-quota-store.ts` を追加し、tenant+tool 固定窓 quota を永続化
  - `mcp/core/reliability/rate-limiter.ts` を backend 切替対応 (`SF_AI_RATE_LIMIT_BACKEND=in-memory|postgres`)
  - `db/schema/quota.ts` と migration `drizzle/0022_tenant_quota_windows.sql` を追加
  - `mcp/core/governance/governed-tool-registrar.ts` で async rate-limit 判定と 429 応答を維持
  - `mcp/core/observability/prometheus-metrics.ts` に `sfai_ai_quota_remaining{tenant}` gauge を追加

---

## TASK-11: OPA / Cedar による Policy as Code

- **優先度**: P2
- **変更内容**: `mcp/core/governance/` に散在する if/else policy を `*.rego` (OPA) または `*.cedar` で外出し。監査人が policy を読める形に。
- **実装方針**:
  1. `mcp/core/ports/policy-engine.ts` に `evaluate(input, policySet) → Decision` 定義
  2. OPA WASM (`@open-policy-agent/opa-wasm`) を embed (sidecar 不要)
  3. policy bundle を `config/policies/` に配置 (`tool_access.rego`, `cost_limits.rego`, `data_residency.rego`)
  4. `governanceGate.isToolEnabled` を OPA evaluate に置換
  5. policy decision を audit log に記録
- **修正ファイル**:
  - `mcp/core/ports/policy-engine.ts` (新規)
  - `mcp/core/governance/opa-policy-engine.ts` (新規)
  - `mcp/core/governance/governance-gate.ts`
  - `config/policies/*.rego` (新規)
  - `package.json` (`@open-policy-agent/opa-wasm`)
  - `mcp/core/audit/audit-writer.ts`
  - `tests/governance/policy/*`
- **メリット**:
  - 監査・コンプライアンス対応 (SOC2/ISO27001)
  - policy 変更がコード PR と独立 (security team が編集可能)
  - 多 tenant policy variation が容易
- **デメリット**:
  - Rego 学習コスト
  - WASM ロード分の起動時間 増
  - policy debug が opa CLI 依存になる

---

## TASK-12: Event Sourcing 層導入

- **優先度**: P2
- **変更内容**: 現 audit hash chain は append-only log だが event store ではない。`EventStore` port を追加し、agent / proposal / governance の状態変更を event として永続化。replay/CQRS 基盤に。
- **実装方針**:
  1. `mcp/core/ports/event-store.ts` (`append/read/subscribe`) 定義
  2. `PostgresEventStore` (既存 `audit` table を base に拡張、`stream_id` `version` 追加 migration)
  3. domain aggregate の状態変更を event として emit
  4. read model (projection) を別 worker で構築 (CQRS lite)
  5. `replay(streamId)` を runtime API として公開
- **修正ファイル**:
  - `mcp/core/ports/event-store.ts` (新規)
  - `mcp/core/persistence/postgres-event-store.ts` (新規)
  - `mcp/core/audit/audit-writer.ts`
  - `db/schema/audit.ts` (event 拡張)
  - `drizzle/0022_event_store.sql` (新規 migration)
  - `mcp/core/orchestration/session-registry.ts` (event 化)
  - `mcp/core/governance/proposal-state-manager.ts` (event 化)
  - `tests/event-store/*`
- **メリット**:
  - true replayability (RCA / 事故再現)
  - read model 切り出しで scale 可能
  - audit trail と event store 統合
- **デメリット**:
  - 学習コスト 大 (eventual consistency)
  - DB 容量 増 (event は累積)
  - 既存コードの broad refactor

---

## TASK-13: Vector DB Pluggable (Qdrant/LanceDB adapter)

- **優先度**: P2
- **変更内容**: 現 pgvector / tfidf / memory のみ。Qdrant / LanceDB / Weaviate adapter を追加し、scale 時に切替可能化。
- **実装方針**:
  1. `mcp/core/ports/vector-store.ts` を `upsert/query/delete` + filter spec で整理
  2. `QdrantVectorStore` `LanceDBVectorStore` を実装
  3. docker-compose.yml に `profile=vector-qdrant` で qdrant 追加
  4. dimension / metric を provider 毎に正規化
  5. `VECTOR_BACKEND=pgvector|qdrant|lancedb|tfidf|memory`
- **修正ファイル**:
  - `mcp/core/ports/vector-store.ts`
  - `memory/vector-store-adapter.ts`
  - `mcp/core/memory/qdrant-vector-store.ts` (新規)
  - `mcp/core/memory/lancedb-vector-store.ts` (新規)
  - `docker-compose.yml`
  - `mcp/env-schema.ts`
  - `tests/memory/qdrant/*`
- **メリット**:
  - pgvector の限界 (数百万 chunks) を突破可能
  - tenant ごとに backend 選択可能
  - 検索 latency 改善
- **デメリット**:
  - 二重 backend 運用コスト
  - dimension migration 工数 (再 embed)
  - 監視対象が増える

---

## TASK-14: Bounded Context 再配置

- **優先度**: P2
- **変更内容**: `mcp/core/` 274 files を bounded context (`mcp/contexts/{orchestration,memory,governance,learning,observability,resource,cost,identity}/`) に再配置。各 BC 内に `application/domain/infrastructure`。
- **実装方針**:
  1. `mcp/contexts/` ディレクトリ作成、`layer-manifest.ts` に BC 制約追加
  2. 既存ファイルを feature flag 単位で段階移動 (1 BC ずつ PR)
  3. cross-context 通信は event-bus 経由のみ許可
  4. depcruise rules で禁止方向を CI ブロック
  5. import path 更新
- **修正ファイル**:
  - `mcp/contexts/**` (新規ディレクトリ群)
  - `mcp/core/**` → `mcp/contexts/**` 移動 (大規模)
  - `mcp/core/layer-manifest.ts`
  - `.dependency-cruiser.cjs`
  - `tsconfig.json` paths
  - `scripts/lint-core-layers.ts`
- **メリット**:
  - service 爆発の予防 (Anemic Service 化阻止)
  - 各 BC を独立 package 化する将来オプション
  - 新規参加者の onboarding 短縮
- **デメリット**:
  - 巨大 PR / merge conflict 不可避
  - 短期的 productivity 低下
  - 進行中 PR との競合

---

## TASK-15: Replay Debugger UI

- **優先度**: P2
- **変更内容**: TASK-12 の event store 上に、agent state diff / event timeline を可視化する web UI。
- **実装方針**:
  1. `infra/replay-ui/` (Next.js or Vite) を新設
  2. event store + audit から timeline 取得 API を MCP HTTP transport 経由で提供
  3. session ID で filter、agent ごとの state snapshot を diff 表示
  4. read-only、別ポート (3001 等)
- **修正ファイル**:
  - `infra/replay-ui/` (新規)
  - `mcp/handlers/register-replay-tools.ts` (新規 / `replay_timeline` tool)
  - `mcp/transport-http.ts` (read API 追加)
  - `docker-compose.yml`
- **メリット**:
  - enterprise 顧客向け debugging 体験
  - 事故調査時間の劇的短縮
  - learning loop の可視化
- **デメリット**:
  - フロント保守コスト
  - 認証 / RBAC を別途実装必要
  - event store 完成 (TASK-12) が前提

---

## TASK-16: HA / Leader Election

- **優先度**: P3
- **変更内容**: 現状 single Postgres / single Ollama / leader election 無し。pg-advisory-lock or etcd で leader election を導入し、scheduler / cron job の重複実行防止。
- **実装方針**:
  1. `mcp/core/reliability/leader-election.ts` 新設 (pg-advisory-lock ベース)
  2. cron / cleanup / drift-detector などの periodic job を leader でのみ実行
  3. Postgres は streaming replication + Patroni 推奨 (docs)
  4. Ollama は HAProxy + multi-instance 構成 (docs)
  5. K8s rollout に readinessProbe + PodDisruptionBudget 追加
- **修正ファイル**:
  - `mcp/core/reliability/leader-election.ts` (新規)
  - `mcp/core/governance/governance-auto-cleanup-schedule.ts`
  - `mcp/core/learning/drift-detector.ts`
  - `infra/k8s/rollouts/*.yaml`
  - `docs/dr-failover.md`
  - `docker-compose.yml` (multi-instance example)
- **メリット**:
  - SPOF 解消
  - 99.9% SLA に到達可能
  - DR 訓練可能
- **デメリット**:
  - 運用複雑度 大幅増
  - Postgres failover の自動化は別投資
  - 開発環境では over-engineering

---

## TASK-17: Knowledge Graph 推論強化

- **優先度**: P3
- **変更内容**: 現 `knowledge-graph.ts` は ingest のみ。推論 (transitive closure / similarity / community detection) を追加し、organizational memory として真に機能させる。
- **実装方針**:
  1. `mcp/core/memory/kg-reasoner.ts` 新設
  2. Cypher 風クエリ DSL (subset) を実装、または Apache AGE (Postgres extension) を導入検討
  3. embedding と graph の hybrid retrieval を `HierarchicalStore` に統合
  4. TTL / pruning policy を `MemoryTierPolicy` に追加
- **修正ファイル**:
  - `mcp/core/memory/kg-reasoner.ts` (新規)
  - `memory/knowledge-graph.ts`
  - `memory/hierarchical-store.ts`
  - `db/schema/knowledge-graph.ts` (index 追加)
  - `infra/postgres/init.sql` (AGE extension)
  - `tests/memory/kg/*`
- **メリット**:
  - failure memory / governance precedent retrieval が強化
  - retrieval quality 向上
  - organizational learning の質的向上
- **デメリット**:
  - graph query は遅い → cache 必須
  - AGE extension 依存で portability 低下
  - メモリ膨張リスク

---

## TASK-18: DR Automation / SIEM 連携

- **優先度**: P3
- **変更内容**: DR runbook が docs のみ → automation。audit log を SIEM (Splunk/Datadog) に export。
- **実装方針**:
  1. `scripts/dr/` に PITR 復元・smoke test 自動化スクリプト
  2. backup 検証 cron 追加
  3. audit log を OTel logs exporter or Fluent Bit で SIEM forward
  4. compliance report 自動生成 (SOC2 controls mapping)
- **修正ファイル**:
  - `scripts/dr/restore.ts` (新規)
  - `scripts/dr/verify-backup.ts` (新規)
  - `infra/observability/fluent-bit.conf` (新規)
  - `mcp/core/audit/siem-exporter.ts` (新規)
  - `docs/dr-failover.md`
  - `docs/compliance/*` (新規)
- **メリット**:
  - DR 訓練が定常運用化
  - enterprise 監査要件を満たす
  - インシデント時 MTTR 短縮
- **デメリット**:
  - SIEM ライセンスコスト
  - 復元演習の運用負荷
  - 機密データ流出リスク (SIEM 経由)

---

## TASK-19: LearningOrchestrator (shadow→canary→promote 自動化)

- **優先度**: P3
- **変更内容**: 現 `model-registry` は手動 promote。eval 結果を自動的に shadow→canary→promote する Temporal workflow を構築。
- **実装方針**:
  1. `mcp/core/learning/learning-orchestrator.ts` を Temporal workflow として実装 (TASK-06 前提)
  2. shadow 実行 → eval (TASK-08) → canary (5% traffic) → promote / rollback
  3. drift-detector の alert を入力に
  4. promote 履歴を event store (TASK-12) に記録
  5. 手動 override は governance proposal queue 経由
- **修正ファイル**:
  - `mcp/core/learning/learning-orchestrator.ts` (新規)
  - `mcp/core/learning/model-registry.ts`
  - `mcp/core/orchestration/workflows/learning-promotion.workflow.ts` (新規)
  - `mcp/handlers/register-learning-tools.ts`
  - `tests/learning/orchestrator/*`
- **メリット**:
  - 真の self-improving runtime
  - 24/7 で改善が走る
  - 人間判断のボトルネック解消
- **デメリット**:
  - 自動 promote の暴走リスク → safety gate 必須
  - rollback strategy が complex
  - TASK-06 / TASK-08 / TASK-12 完成が前提

---

## TASK-20: dashboard-as-code 化

- **優先度**: P3
- **変更内容**: 現状 dashboard は HTML/Markdown ハードコード + Grafana JSON 数十枚。Grafonnet / jsonnet で code 化。
- **実装方針**:
  1. `infra/observability/grafana-dashboards/` を jsonnet ベースに移行
  2. CI で render → JSON commit
  3. dashboard catalog を docs に自動生成
- **修正ファイル**:
  - `infra/observability/grafana-dashboards/*.jsonnet` (新規)
  - `scripts/render-dashboards.ts` (新規)
  - `.github/workflows/dashboards.yml` (新規)
  - `docs/observability-cleanup-playbook.md`
- **メリット**:
  - dashboard の re-use / DRY
  - 変更履歴が git で追える
  - tenant 別 dashboard 自動生成可能
- **デメリット**:
  - jsonnet 学習コスト
  - 既存 JSON 移行工数
  - Grafana version upgrade 時に build 失敗リスク

---

## 実装推奨順序 (依存関係)

```
Phase 1 (即時, 並行可能):
  TASK-04 (dead code) ──┐
  TASK-05 (sampling) ──┤
  TASK-03 (embedding) ─┤
  TASK-01 (cost ledger) ─┐
  TASK-02 (tool tier) ───┴── (cost-ledger と相乗)

Phase 2 (Phase 1 完了後):
  TASK-06 (Temporal POC) ──┬── TASK-19 (LearningOrchestrator)
  TASK-07 (Reflection) ─────┤
  TASK-08 (Eval CI) ────────┤
  TASK-09 (CLI 統合)
  TASK-10 (Quota)

Phase 3 (Phase 2 完了後):
  TASK-11 (OPA)
  TASK-12 (Event Sourcing) ── TASK-15 (Replay UI) ── TASK-19
  TASK-13 (Vector DB)
  TASK-14 (Bounded Context)  # 早期実施可能だが影響範囲大

Phase 4 (長期):
  TASK-16 (HA)
  TASK-17 (KG 推論)
  TASK-18 (DR/SIEM)
  TASK-20 (dashboard-as-code)
```

---

## 工数見積もり (engineer-week 概算, 1 person 換算)

| Phase | 合計工数 |
|---|---|
| Phase 1 (TASK 01-05) | 6-9 weeks |
| Phase 2 (TASK 06-10) | 12-18 weeks |
| Phase 3 (TASK 11-15) | 14-22 weeks |
| Phase 4 (TASK 16-20) | 10-16 weeks |
| **合計** | **42-65 weeks** |

> 並行作業可能なため、3-4 名チームで 4-6 ヶ月で Phase 1-2、12 ヶ月で Phase 3 完了が現実的。

---

*Generated from: persistent-ai-runtime-architecture-review.md*
