# Persistent AI Runtime 改善タスク一覧

> 出典: [persistent-ai-runtime-architecture-review.md](persistent-ai-runtime-architecture-review.md)
> 形式: 各タスク = タスク名 / 変更内容 / 実装方針 / 修正ファイル / メリット / デメリット
> 優先度凡例: **P0** = 即着手、**P1** = 直後、**P2** = 中期、**P3** = 長期
> 各タスクは独立 PR を想定。依存関係は「前提」に明記。

---

## 概要表

> **方針更新 (2026-05-14)**: T00（ドメイン分離）は**最後に実施**する方針に変更。理由は (1) 現状リポに `domains/core/` 中間状態と mojibake 破損があり、まず復旧と内部構造改善を進める方が安全、(2) T01〜T30 で Port / Catalog / Plugin 契約が固まってから物理移動した方が振り分け精度が高い、(3) T00 の差分が最大級のため最後に集中して実施する方が PR レビューが現実的。代わりに **T-1（復旧）** を最優先、**T01.5（Surface プロセス境界準備）** を追加。

| # | 優先度 | タスク名 | 想定規模 | 前提 |
|---|--------|----------|---------|------|
| **T-1** | **P0★** | **復旧フェーズ（mojibake 修復 + import 崩れ復旧 + typecheck 緑化）** | **中** | **-（最優先）** |
| T01 | P0 | `mcp/server.ts` 解体・bootstrap 分割 | 大 | T-1 |
| T01.5 | P0 | Surface プロセス境界準備（task-queue を capability 別に分割） | 小 | T01 |
| T02 | P0 | `LlmGateway` Port の二分割 | 中 | T01 推奨 |
| T03 | P0 | Vector backend 一本化（pgvector 既定 / Qdrant 任意 / LanceDB 撤去） | 中 | - |
| T04 | P0 | Tool Catalog v2（階層化・命名規約・deprecation） | 大 | T01 |
| T05 | P0 | `@langchain/community` 撤去 | 中 | T02 |
| T06 | P1 | `RequestContext` 全 Port 第一引数化 | 大 | T02 |
| T07 | P1 | `MemoryService` Port の多分割 | 中 | T06 |
| T08 | P1 | `mcp/contexts/*` 形骸化解消（移管 or 削除） | 中 | T01 |
| T09 | P1 | Workflow を Temporal 主導に統一 | 大 | T01 |
| T10 | P1 | Outbox パターン（pg-boss + event-store 統合） | 中 | T09 |
| T11 | P1 | Replay 決定論契約 + LLM cache port | 中 | T02, T09 |
| T12 | P1 | Vector lifecycle scheduler（hot→warm→cold 自動 demotion） | 中 | T03 |
| T13 | P1 | Schema registry + event versioning | 中 | T10 |
| T14 | P1 | dependency-cruiser に 4 層境界規約を強制 | 小 | T01, T02 |
| T15 | P1 | OPA 正規化（policy bundle 配信 + 署名） | 中 | - |
| T16 | P1 | OpenTelemetry Collector 経由化 | 小 | - |
| T17 | P2 | Saga / Compensation DSL on Temporal | 大 | T09, T10 |
| T18 | P2 | Self-Improvement promotion DAG（drift→snapshot→A/B→promote） | 大 | T11 |
| T19 | P2 | Agent Capability Schema + Governance binding | 中 | T04, T15 |
| T20 | P2 | Cost-aware model router の Port 化 | 中 | T02 |
| T21 | P2 | Knowledge Graph governance（provenance / confidence decay / 矛盾検知） | 中 | T07 |
| T22 | P2 | CI eval gating（メトリクス回帰自動ブロック） | 小 | T18 |
| T23 | P2 | Tracing tail-based sampling + 長期 cold backend | 中 | T16 |
| T24 | P3 | KMS 統合 + envelope encryption (per tenant) | 中 | T06 |
| T25 | P3 | OIDC / SAML actor identity 統合 | 中 | T06 |
| T26 | P3 | Audit / Event partition の自動運用 + cold export | 中 | T13 |
| T27 | P3 | Worker pool capability ごとの分離プロセス化 | 大 | T09, T01.5 |
| T28 | P3 | SBOM (Syft/Grype/cosign) の CI 強制 | 小 | - |
| T29 | P3 | scripts/ の `sf-ai` CLI 集約完了 | 小 | - |
| T30 | P3 | テスト e2e 強化（replay / chaos / multi-instance / governance violation） | 大 | T09, T10 |
| **T00** | **P3（最終）** | **3 軸ドメイン分離（core / development / salesforce）+ `domains/core/` 廃止** | **特大** | **T01〜T30 完了後** |

---

## 進捗ログ

- 2026-05-14: T18 を完了（`core/learning/promotion-history.ts` を追加し、promotion DAG 履歴 (`promotion-history.jsonl`) と policy snapshot tag (`outputs/learning/policy-snapshots/*.json`) の永続化を実装。`register-learning-tools.ts` と `metrics-auto-update.ts` から `runLearningPromotionWorkflow` の `createPolicySnapshotTag` / `recordPromotionHistory` フックを接続。`observability-dashboard.ts` を実装更新して trace + system_event + governance + learning promotion 履歴を統合表示し、`format` / `write` 出力に対応。`core/observability/dashboard.ts` に learning promotion セクションを追加）。
- 2026-05-14: T18 を前進（`learning-promotion.workflow.ts` に DAG レポート (`drift-check` / `ab-evaluation` / `policy-snapshot` / `promotion`) を追加。promotion 成功時に `createPolicySnapshotTag` 連携を実装し、snapshot tag 失敗時は自動 rollback（`promotionRolledBack`）へフォールバック。`recordPromotionHistory` フックで履歴永続化可能な拡張点を追加。`tests/learning/learning-orchestrator.test.ts` に snapshot tag 成功/失敗時の回帰テストを追加）。
- 2026-05-14: T17 を完了前進（`clear_memory` / `remove_org` / `deploy_org` を Saga 実行経路へ統一。`clear_memory` は事前 snapshot から `addMemory` 復元補償を実装、`remove_org` は org catalog の pre-state を保存して補償復元可能化、`deploy_org` は command compile を Saga step 化。`tests/dangerous-tools-saga.test.ts` を追加し、危険操作ツールの Saga metadata 返却と基本挙動を回帰テスト化）。
- 2026-05-14: T17 を追加前進（`handlers/core-resource-apply/apply-resource-actions.ts` の危険操作バッチ (`delete` / `disable`) を Saga ランナー経由に変更。実行前 snapshot から補償アクション（`enable`/`create`）を生成し、失敗時に逆順 undo を実行する経路を追加。レスポンスに `saga.status` / `compensatedSteps` / `compensationFailures` を付与）。
- 2026-05-14: T17 を追加前進（`dangerous-actions.ts` に `requiresSaga` メタを導入し、不可逆操作 (`clear_memory` / `apply_resource_actions` / `remove_org` / `deploy_org`) を Saga 必須として明示。`policy-gate.ts` の blocked 応答に `proposalHint.executionMode="saga"` と `requiresSaga` を追加し、ガバナンスポリシーから Saga 実行要件を機械可読化。`tests/policy-gate.test.ts` を追加）。
- 2026-05-14: T17 を着手（`core/ports/saga.ts` に宣言 DSL 契約を追加し、`infrastructure/workflow/saga-runner.ts` で do/undo 実行と逆順補償を実装。`core/application/saga/define-saga.ts` は互換 shim 化。`tests/saga-runner.test.ts` で正常完了・失敗時補償・補償失敗時の継続挙動を検証）。
- 2026-05-14: T16 を前進（`infra/observability/otel-collector-config.yaml` を追加し、traces/metrics/logs の OTLP pipeline を定義。`docker-compose.yml` に `otel-collector` サービスを追加し、host の 4317/4318 を collector に割当、Jaeger は UI 公開のみに整理。`env.profiles/prod.overlay` と `env.example`、`docs/configuration.md` を collector endpoint 前提へ更新）。
- 2026-05-14: T14 を追加前進（`proposal-queue-tools-core.ts` の identity import を `contexts/identity/index.ts` 経由へ変更し、depcruise の info 違反も解消。`lint:depcruise:strict` で violation 0 を確認）。
- 2026-05-14: T13 を追加前進（`tests/event-store-event-type-inventory.test.ts` を追加し、`eventStore.append*` 呼び出し箇所を inventory として固定。現時点の event-store 永続化ポイントが `learning-orchestrator.ts` のみであることを回帰テスト化）。
- 2026-05-14: T15 を追加前進（`governed-tool-registrar.ts` で policy bundle フォールバック通知を受け、`policy_bundle_fallback` system event と `audit/tool-executions.jsonl` へ `toolName=__policy_engine` 監査記録を追加）。
- 2026-05-14: T15 を追加前進（`opa-policy-engine.ts` に policy bundle フォールバック理由の通知フック `onPolicyBundleFallback` を追加し、署名失敗/sha256 不一致時の理由を warning ログで可視化。`tests/opa-policy-engine.test.ts` にフォールバック理由検証を追加。`docs/configuration.md` に `SF_AI_POLICY_BUNDLE_PUBLIC_KEY_PATH`・署名生成・鍵ローテーション手順を追記）。
- 2026-05-14: T14 を追加前進（surface->core 直結 import を `core/application/*` ファサード経由へ移行し、`core/registration` の replay/learning 配線を `mcp/registration/*` へ分離。depcruise は **warning 0 / error 0 / info 1** まで改善し、層境界違反の実質ブロッカーを解消）。
- 2026-05-14: T14 を追加前進（違反削減を実施。`mcp/core/identity/*` 互換 shim を `contexts/identity/index.ts` 経由へ切替、`register-learning-tools.ts` の learning import を `contexts/learning/index.ts` 経由へ変更、`completion-port-from-agent-chat.ts` から application 依存型 import を除去。depcruise warning を 31 -> 23 へ削減）。
- 2026-05-14: T15 を追加前進（policy bundle 署名検証を追加。`opa-policy-engine.ts` が `SF_AI_POLICY_BUNDLE_PUBLIC_KEY_PATH` または options 指定時に `policy-bundle.sig` を Ed25519 で検証。`build-policy-bundle.ts` に `--signing-private-key` を追加し `.sig` を生成可能化。`tests/opa-policy-engine.test.ts` と `tests/build-policy-bundle.test.ts` に署名検証テストを追加）。
- 2026-05-14: T13 を追加前進（learning event type を `learning-event-types.ts` に集約し、`learning-orchestrator.ts` と `domain/events/index.ts` の event 名を定数参照へ統一。`tests/event-schema-registry.test.ts` に「全 learning event が registry 登録済みで schema validate 可能」を保証するカバレッジテストを追加し、event type 追加時の未登録漏れを自動検出化）。
- 2026-05-14: T15 を追加前進（`build-policy-bundle.ts` に `--policy-dir` 引数を追加して bundle 生成先を明示指定可能にし、`tests/build-policy-bundle.test.ts` を追加。bundle/sha256 生成の自動検証を導入し、`tests/opa-policy-engine.test.ts` と合わせて policy 配信経路の回帰を固定化）。
- 2026-05-14: T14 を追加前進（depcruise の運用を `lint:depcruise`（標準）と `lint:depcruise:strict`（同ルールの明示監視）に整理し、`ci` に `lint:depcruise` を組み込み。現設定では warning/info は可視化しつつ、error が無い限りパイプラインを停止しない方針へ統一）。
- 2026-05-14: T15 を着手（`opa-policy-engine.ts` が `config/policies/policy-bundle.json` を優先読み込みし、`policy-bundle.sha256` が存在する場合に整合性検証するよう拡張。bundle 不整合時は従来の policy set JSON へフォールバック。`scripts/build-policy-bundle.ts` と `npm run policy:bundle` を追加し、`tests/opa-policy-engine.test.ts` に bundle 読込/整合性不一致フォールバック検証を追加）。
- 2026-05-14: T13 を追加前進（`mcp/domain/events/system-events.ts` を追加し、`event-dispatcher.ts` の emit 経路に system event payload schema 正規化を導入。`event-bus.ts` の message envelope に `schemaVersion` を追加し、進化可能なイベント契約の下地を拡張）。
- 2026-05-14: T14 を前進（`.dependency-cruiser.cjs` に 4 層境界ルールを追加。`surface -> core(application/ports/config 等のみ)`、`application -> surface 禁止`、`domain -> application/infrastructure 禁止`、`infrastructure -> surface/application 禁止` を error で検出）。
- 2026-05-14: T13 を前進（`mcp/core/event/schema-registry.ts` と `mcp/domain/events/index.ts` を追加し、`PostgresEventStore` の append/read 経路で schema validate + read-time migration を適用。`tests/event-schema-registry.test.ts` を追加して version 付与/移行ロジックを検証）。
- 2026-05-14: T12 を追加前進（`bootstrap-vector-lifecycle.ts` を追加し、`mcp/server.ts` 起動/終了ライフサイクルに vector lifecycle scheduler を統合。`SF_AI_VECTOR_LIFECYCLE_ENABLED` / `SF_AI_VECTOR_LIFECYCLE_CRON` / `SF_AI_VECTOR_HOT_TO_WARM_DAYS` / `SF_AI_VECTOR_WARM_TO_COLD_DAYS` / `SF_AI_VECTOR_LIFECYCLE_RUN_ON_STARTUP` / `SF_AI_VECTOR_LIFECYCLE_STARTUP_LIMIT` で運用制御可能化）。
- 2026-05-14: T12 を前進（`mcp/core/memory/lifecycle-scheduler.ts` を新設し、`croner` ベースの日次実行に対応した vector tier demotion ロジックを追加。ワンショット実行スクリプト `scripts/vector-lifecycle-runner.ts` と単体テスト `tests/vector-lifecycle-scheduler.test.ts` を追加）。
- 2026-05-14: T11 を追加前進（replay strict 時の副作用抑止を実装。`mcp/server.ts` で `SF_AI_REPLAY_MODE=strict` の場合は outbox dispatcher を自動停止し、`scripts/audit-export-siem.ts` でも即時 dispatch を抑止して report に `dispatchSuppressed` を出力）。
- 2026-05-14: T11 を前進（`docs/replay-determinism-contract.md` を追加し、`LlmCacheStorePort` + Postgres adapter を実装。`LlmCompletionPort` に cache wrapper を導入し、`SF_AI_REPLAY_MODE` / `SF_AI_REPLAY_REQUIRE_LLM_CACHE_HIT` による strict replay 制御を追加。`replay-reader` / `replay-session` / HTTP replay API に replay フラグを伝播）。
- 2026-05-14: T10 完了（outbox dispatcher 常駐化、leader election 連携、pg-boss dispatch の idempotency-key 標準化、SIEM export の outbox enqueue モード追加を実装。`learning_orchestrator` と SIEM 系の高頻度副作用を outbox 経路で運用可能に統一）。
- 2026-05-14: T10 を追加前進（`mcp/surface/bootstrap/bootstrap-outbox-dispatcher.ts` を追加し、server 起動時に outbox dispatcher を常駐起動するよう統合。`SF_AI_OUTBOX_DISPATCH_ENABLED` / `SF_AI_OUTBOX_DISPATCH_INTERVAL_SECONDS` / `SF_AI_OUTBOX_DISPATCH_LIMIT` / `SF_AI_OUTBOX_QUEUE_PREFIX` で制御可能にし、leader election 連携で multi-instance 二重 dispatch を回避）。
- 2026-05-14: T10 を前進（`OutboxPort` を新設し `PgBossOutboxPort` adapter を追加。`PostgresEventStore.appendWithOutbox` を実装して event append と outbox enqueue の同一トランザクション化を導入。`learning_orchestrator` 経路を outbox 対応し、`replay-siem-dead-letter.ts` に outbox 再投入モードを追加）。
- 2026-05-14: T09 完了後検証（`npx tsc --noEmit --pretty false` と workflow 関連テスト `tests/workflow-engine.test.ts` / `tests/temporal-workflow.integration.test.ts` を実行。型エラーなし、単体テスト通過、Temporal integration は環境未起動のため skip）。
- 2026-05-14: T09 完了（dev/test 既定を Temporalite に統一し、in-process は test-only escape hatch 化。worker/activity 登録を `mcp/infrastructure/workflow/temporal-workflow-worker.ts` に集約。session-store/event-store は Temporal history 射影 read-path（get/restore/list）を実装して応答へ投影情報を返すように更新）。
- 2026-05-14: T09 を追加前進（`restore_orchestration_session` 応答にも `workflowEventProjection` を追加し、取得系/復元系で Temporal history 射影情報を同一フォーマットで返すように統一）。
- 2026-05-14: T09 を追加前進（workflow step history を `StoredEvent` へ射影する adapter を追加し、`get_orchestration_session` 応答に `workflowEventProjection` サマリを追加。event-store write 経路は維持しつつ、read-path で Temporal history を参照可能にした）。
- 2026-05-14: T09 を追加前進（session 取得経路に Temporal workflow state からの射影復元を追加。保存済み session が無い場合でも `workflowEngine.query` の step 状態から最小 `OrchestrationSession` を再構成し、queue を復元して session-store へ best-effort 逆同期する read-path を導入）。
- 2026-05-14: T09 を追加前進（`in-process` 実行を test-only に制限。`SF_AI_ALLOW_IN_PROCESS_WORKFLOW=true` を明示しない限り `in-process` を拒否し、Temporal adapter の fallback も同フラグで制御するように変更。`env.example` / `mcp/README.md` / `env-schema` を temporal-first 方針へ同期）。
- 2026-05-14: T09 を追加前進（Temporal 起動導線を強化。`docker:up:workflow` / `docker:up:dev-temporal` スクリプトを追加し、`env.profiles/dev.overlay` の workflow 設定を `temporal` + `SF_AI_TEMPORAL_RUN_WORKER=true` に更新。README と `mcp/README.md` を temporal-first 方針へ同期）。
- 2026-05-14: T09 を前進（workflow の実行モードを env mode 連動に変更し、prod 既定を temporal に切替。`SF_AI_ENV_MODE=prod` で `SF_AI_WORKFLOW_ENGINE=in-process` を環境検証エラー化。Temporal adapter に `allowFallbackToInProcess` を追加し、prod 経路で Temporal 不可時の in-process フォールバックを禁止）。
- 2026-05-14: T08 完了（`mcp/contexts/*` の scaffolded context を `application/domain/infrastructure` 構成へ拡張し、root barrel は各 layer barrel のみを公開する形へ整理。`contexts-manifest` の status/migratedFrom を実態に合わせて更新し、`lint-contexts` に「manifest 未登録 context」「登録済み context 欠落」「barrel/layer 欠落」の失敗判定を追加）。
- 2026-05-14: T07 完了（`MemoryService` を `MemoryReader`/`MemoryWriter` に分離し、`HierarchicalMemoryPort` と `KnowledgeGraphPort` を新設。`PgvectorHierarchicalStore` を新 Port に追従。`KnowledgeGraphAdapter` を追加して `knowledge-graph`/`kg-reasoner` を Port 経由で利用可能に統一）。
- 2026-05-14: T06 残タスクを完了（`withContext` 互換シムを追加し、`OutputsPort/CostLedger/Observability/MemoryService` 向け context-aware wrapper を実装。HTTP transport で request context 注入を追加。`eslint-rules/require-request-context.js` を新設し、`request-context/require-request-context` で Port 呼び出し時の ctx 渡し忘れ検知を有効化）。
- 2026-05-14: T06 wrapper 展開（analytics/governance/resource services、learning modules、proposal applier、proposal runtime、AB/coverage/permission/dependency/deployment/flow 各 tool の outputs 書き込み経路を `withContextOutputsPort` に統一）。
- 2026-05-14: T06 を追加前進（application/tool 層の主要 `OutputsPort` 呼び出しで `getRequestContext()` を使った `ctx` 明示渡しを導入。対象: governance UI / cleanup suggest / apply actions / knowledge dashboard / agent AB test）。
- 2026-05-14: T06 を前進（`CostLedgerPort`/`ObservabilityPort`/`OutputsPort`/`MemoryService` を `ctx先頭` 互換シグネチャへ拡張。`tool-registry`・`governed-tool-registrar`・outputs adapters（local/postgres/s3）・`bootstrap-governance` を追従）。
- 2026-05-14: T06 着手（`mcp/core/runtime/request-context.ts` を追加し、`governed-tool-registrar` の実行経路で `runWithRequestContext` による AsyncLocalStorage 伝播を開始）。
- 2026-05-14: T05 完了（`npm uninstall @langchain/community` を実施し依存を撤去。実コード参照ゼロを確認し、`npx tsc --noEmit` 成功）。
- 2026-05-14: T04 完了（`docs/tool-catalog.md` 自動生成を追加し、`docs:build` に統合。tool catalog 判定ロジックを `tool-catalog-metadata.ts` に集約し、`registerTool` 経路が `governed-tool-registrar` に一本化されていることを確認）。
- 2026-05-14: T04 をさらに前進（`SF_AI_TOOL_CATALOG_POLICY=off|warn|error` を導入し、category/capabilities/owner/since(+deprecated時のreplacedBy) の不足を warn/error 制御。deprecated ツール実行時はレスポンス本文にも警告を付与）。
- 2026-05-14: T04 を前進（`defineTool` で category/capability/owner/since の自動補完を追加し、deprecated ツール呼び出し時に `tool_deprecated_invoked` イベントを発火）。
- 2026-05-14: T04 着手（`mcp/surface/tool-catalog.ts` を新設し、`onToolDefined` で中央カタログへ集約する基盤を追加。`ToolDefinition` に catalog メタ項目を追加）。
- 2026-05-14: T03 完了（LanceDB 経路撤去 + `SF_AI_VECTOR_BACKEND` 整理 + qdrant 回帰テスト通過）。
- 2026-05-14: T03 を前進（LanceDB 実装を削除し、`SF_AI_VECTOR_BACKEND` の許容値から `lancedb` を除外。vector 既定値を pgvector 側に寄せ、README/runtime-profile テストを更新）。
- 2026-05-14: T02 の旧ポート撤去を完了（`mcp/core/ports/llm-gateway.ts` を削除し、`LlmGateway` 実コード参照をゼロ化）。
- 2026-05-14: T02 をさらに前進（`infrastructure/llm/completion-port-from-agent-chat.ts` を追加して completion 変換を独立、`HandlerContext` と `composition-root` から `llmGateway` フィールドを最終削除）。
- 2026-05-14: T02 を順次前進（`tool-registry.ts` から `LlmGateway` 依存を除去、`llm-gateway.ts` を互換ポートとして deprecated 明記）。
- 2026-05-14: T02 着手（`LlmCompletionPort` と `AgentChatService` を追加し、composition/tool-registry/handler-context を新抽象へ配線。`llmGateway` は互換エイリアスとして維持）。
- 2026-05-14: T01.5 を本配線（`mcp/server.ts` の起動経路を `startMcpSurfaceEntrypoint` 経由へ切替）。
- 2026-05-14: T01 完了（`bootstrap-{governance,orchestration,presets-history,leader-election,memory}` を追加し、`mcp/server.ts` の残初期化ブロックを置換。`npx tsc --noEmit` 成功）。
- 2026-05-14: T01 残タスクを完了（`bootstrap-governance.ts` / `bootstrap-orchestration.ts` / `bootstrap-presets-history.ts` / `bootstrap-leader-election.ts` / `bootstrap-memory.ts` を追加し、`mcp/server.ts` の対応初期化ブロックを置換、typecheck 成功）。
- 2026-05-14: T01 を追加前進（governance cleanup schedule の起動同期を `mcp/surface/bootstrap/bootstrap-governance-cleanup-sync.ts` へ抽出）。
- 2026-05-14: T01 を追加前進（history/preset 設定の初期化を `mcp/surface/bootstrap/bootstrap-history-preset.ts` へ抽出）。
- 2026-05-14: T01 を追加前進（observability 起動シーケンスを `mcp/surface/bootstrap/bootstrap-observability.ts` に抽出）。
- 2026-05-14: T01 を追加前進（metrics auto-update の起動/定期実行/停止を `mcp/surface/bootstrap/bootstrap-metrics-auto-update.ts` に抽出）。
- 2026-05-14: T01.5 の初期実装を追加（capability 別 task-queue 解決、`mcp/surface/entrypoints/` 雛形、Temporal queue を capability 指定で解決）。
- 2026-05-14: T01 の一部を着手（`mcp/server.ts` の Temporal worker 起動処理を `mcp/surface/bootstrap/bootstrap-workflow.ts` へ抽出）。
- 2026-05-14: T-1 は「都度検出で修正」に運用変更（ブロッカー扱いを解除）。

---

## 詳細タスク

---

### T-1 [P0★] 復旧フェーズ（mojibake 修復 + import 崩れ復旧 + typecheck 緑化）

- **位置付け**: 全改善タスクの前提条件。**現状リポには文字化け（`from→rrom` / `function→runction` / `JSON.stringify→JSON.stringiry` / `config→conrig` / `infrastructure→inrrastructure` / `undefined→underined` / `Safe→Sare` / `sfai→srai` 等）と、ドメイン再編途中の import 崩れが残存**しており、この上に構造変更を積むと二次破損する。
- **変更内容**:
  - mojibake パターンを grep で網羅的に検出し、文字単位で復元（git history と diff で正解を確認）
  - `domains/core/*` の中途半端な import path を `@mcp/*` `@domains/*` 経由に統一
  - `tsc --noEmit` がエラー 0 になるまで修正
  - 構造変更（ファイル移動・rename）は**一切行わない**
- **実装方針**:
  1. mojibake 検出スクリプト `scripts/detect-mojibake.mjs` を整備し、変換テーブル（`rrom→from` 等）で一括置換 + 目視確認。
  2. 復元不能なファイル（壊れすぎ）は `git restore <path>` で HEAD に戻す。
  3. `pnpm typecheck` を CI に required check として追加し、mojibake 再発を防止。
  4. 完了後にスナップショット tag を切る（例: `v0.0.0-pre-refactor`）。後続タスクの基準点。
- **修正ファイル**:
  - 修復対象: `domains/**/*.ts`, `mcp/**/*.ts` のうち mojibake を含む全ファイル（約 144+ 検出済み）
  - 新規: `scripts/detect-mojibake.mjs`, `scripts/fix-mojibake.mjs`
  - 編集: `.github/workflows/ci.yml`（typecheck required 化）
- **メリット**:
  - 後続全タスクの作業基盤確立
  - mojibake 再発の構造的防止
  - スナップショット tag で revert 可能性確保
- **デメリット / リスク**:
  - 復旧自体は新機能を生まない（純粋なコスト）
  - mojibake 検出漏れがあると後続で再爆発

---

### T01.5 [P0] Surface プロセス境界準備（task-queue を capability 別に分割）

- **位置付け**: T27（worker pool 分離）の前提整備。**プロセスは当面単一でも、`task-queue` を capability 別に最初から分けておく**ことで、後の物理分割が import 変更ゼロで済む。
- **変更内容**:
  - Temporal の `taskQueue` を以下に分割: `core-orchestration` / `llm-heavy` / `analysis-heavy` / `deploy-heavy` / `scheduler`
  - 各 workflow / activity の registration を `taskQueue` 別に整理
  - surface も `surface-mcp` / `surface-http` / `scheduler` の責務を明示分離（プロセス起動は単一でも entrypoint を分ける）
- **実装方針**:
  1. `mcp/infrastructure/workflow/task-queues.ts` に `TaskQueue` 列挙を集約。
  2. activity / workflow に `@TaskQueue('llm-heavy')` 相当のメタを付与。
  3. composition-root で `taskQueue` ごとに worker を起動（同一プロセス内で複数 worker 可）。
  4. `mcp/surface/entrypoints/{mcp.ts,http.ts,scheduler.ts}` を新設し、`server.ts` から呼ぶ。
- **修正ファイル**:
  - 新規: `mcp/infrastructure/workflow/task-queues.ts`, `mcp/surface/entrypoints/{mcp,http,scheduler}.ts`
  - 編集: [mcp/composition-root.ts](../../mcp/composition-root.ts), [mcp/server.ts](../../mcp/server.ts), [mcp/infrastructure/workflow/](../../mcp/infrastructure/workflow/) 配下
- **メリット**:
  - T27 を「物理移動だけ」で実施可能に
  - スケール / 障害分離の準備が早期に整う
  - capability ごとのリソース見積もりが可視化される
- **デメリット / リスク**:
  - taskQueue 分割の判定基準を最初に決める必要あり
  - 一時的に worker 設定が冗長になる

---

### T00 [P3 / 最終] 3 軸ドメイン分離（core / development / salesforce）+ `domains/core/` 廃止

- **位置付け**: **最終フェーズで実施**。T01〜T30 で Port / Catalog / Plugin 契約 / depcruise 規約が固まってから物理移動するため、振り分け精度が最大化される。当初は P0★ 最優先だったが、(1) 現状の `domains/core/` 中間状態を抱えたまま構造変更を進める方が安全、(2) 大規模差分は最後にまとめる方が PR レビューが現実的、との判断で最終化。
- **変更内容**: 現状 `mcp/core/` `mcp/tools/` `mcp/handlers/` `agents/` `skills/` `domains/core/` 等に混在しているコードを以下 **3 つのトップレベル境界**に分離する:
  - **`mcp/`（コア = AI Runtime）**: ドメイン非依存の AI Runtime プラットフォーム（orchestration / memory / governance / observability / learning / MCP surface / workflow / vector / LLM 抽象）
  - **`domains/development/`（開発汎用ドメイン）**: ソフトウェア開発全般で再利用可能な知識（リポ解析 / 依存グラフ / リファクタ / PR レビュー / テスト戦略 / ドキュメント生成 / 汎用 agents・skills）。プラットフォーム非依存。
  - **`domains/salesforce/`（Salesforce 特化ドメイン）**: Apex / LWC / Flow / PermissionSet / Metadata / Deploy / SF CLI 等、Salesforce 知識が必須のもの
  - **`domains/core/` は廃止**。現状のグレーゾーンを上記 3 軸に必ず振り分ける。
- **境界定義（3 軸振り分けルール）**:
  - 判定基準:
    - 「Salesforce を知らないと書けないか？」→ YES なら `domains/salesforce/`
    - 「コードや開発プロセスを扱うがプラットフォーム非依存か？」→ YES なら `domains/development/`
    - 「Agent / LLM / Memory / Workflow / Governance のメカニズムそのものか？」→ YES なら `mcp/`
  - **`mcp/` に残すもの（コア）**: `mcp/{surface,application,domain,core,infrastructure}` / 汎用ハンドラ (chat / orchestration / memory / governance / preset / history / proposal-queue / logging)
  - **`domains/development/` に移すもの**: `mcp/tools/{repo-analyzer,refactor-suggest,branch-diff-*,pr-readiness-check,changed-tests-suggest,test-scaffold-extractor,coverage-estimate,suggest-cleanup-resources,recommend-skills-for-role,resource-dependency-graph}` / 関連 handlers / `agents/{architect,product-manager,qa-engineer,debug-specialist,refactor-specialist,documentation-writer,performance-engineer,security-engineer,repository-analyst,ceo}` / `skills/{testing,refactor,debug,architecture,documentation,security(汎用),performance(汎用)}`
  - **`domains/salesforce/` に移すもの**: `mcp/core/apex/` / `mcp/tools/{apex-*,flow-*,lwc-*,permission-set-*,metadata-*,deploy-org,run-deployment-verification,deployment-*,security-delta-scan,security-rule-scan,recommend-permission-sets,suggest-flow-test-cases,run-tests}` / `mcp/handlers/{branch-review,core-apex-advanced,core-deployment,core-flow,core-metadata-diff,org-catalog}` / `agents/{apex-developer,lwc-developer,flow-specialist,integration-developer,data-modeler,release-manager}` / `skills/{apex,lwc,salesforce-platform,data-model,integration}` / `drizzle` 内の SF 固有テーブル / `scripts/sfdx-wrapper.js`
  - **`domains/core/` は完全廃止**。現状の中間ファイル群を上記 3 軸に必ず振り分け、`domains/core/` ディレクトリを削除
  - **依存方向**: `mcp → domains/* 禁止` / `domains/development → mcp/{ports,domain} のみ` / `domains/salesforce → mcp/{ports,domain} と domains/development（必要時）` / `domains/development → domains/salesforce 禁止`
- **実装方針**:
  1. **棚卸し PR (準備)**: `docs/reviews/domain-boundary-inventory.md` を作成し、ファイル単位で `mcp | development | salesforce` を分類（既存 `domains/core/*` も全件分類）。
  2. **Plugin インターフェース定義**: `mcp/core/ports/domain-plugin-port.ts` を新設し、`registerHandlers(registry, deps)` `registerAgents(loader)` `registerSkills(loader)` `registerMigrations?(runner)` + `dependsOn?: readonly string[]` を持つ `DomainPlugin` 契約を作る。
  3. **物理移動 PR（小刻みに分割、各 PR ≤ 200 ファイル）**:
     - PR-A: 開発汎用 tools → `domains/development/tools/`
     - PR-B: 開発汎用 handlers → `domains/development/handlers/`
     - PR-C: 開発汎用 agents/skills → `domains/development/{agents,skills}/`
     - PR-D: SF analysis (`mcp/core/apex/` 等) → `domains/salesforce/analysis/`
     - PR-E: SF tools → `domains/salesforce/tools/`
     - PR-F: SF handlers → `domains/salesforce/handlers/`
     - PR-G: SF agents/skills → `domains/salesforce/{agents,skills}/`
     - PR-H: `drizzle/` の SF 関連 → `domains/salesforce/db/migrations/`
     - PR-I: `domains/core/` 残存ファイルを 3 軸に振り分け、ディレクトリ削除
     - 各 PR は import path 書き換えのみ、ロジック変更なし。
  4. **Plugin 化**: `domains/development/index.ts` `domains/salesforce/index.ts` でそれぞれ `DevelopmentPlugin` / `SalesforcePlugin` を export し、`composition-root` で `[DevelopmentPlugin, SalesforcePlugin]` を `dependsOn` 順に注入。
  5. **デフォルトフラグ**: `SF_AI_ENABLE_DOMAIN_DEVELOPMENT=true` / `SF_AI_ENABLE_DOMAIN_SALESFORCE=true`（既定 on）で suite を一括 on/off 可能に。
  6. **package 名のリネーム**（任意・後続）: `salesforce-ai-company` → `mult-agent-ai-runtime` + `@mult-agent-ai/domain-{development,salesforce}` のモノレポ化（pnpm workspaces / turborepo）。今は単一 package のまま folder 分離のみで十分。
  7. **依存方向のロック（depcruise）**: `mcp → domains/* 禁止` / `domains/development → mcp/{ports,domain} のみ` / `domains/salesforce → mcp/{ports,domain} と domains/development` / `domains/development → domains/salesforce 禁止`。T14 で導入済みの規約に追記。
- **修正ファイル**:
  - 新規: `domains/development/{analysis,refactor,review,testing,documentation,tools,handlers,agents,skills,personas,index.ts}`, `domains/salesforce/{analysis,deployment,security,catalog,cli,tools,handlers,agents,skills,personas,policies,prompts,db,index.ts}`, `mcp/core/ports/domain-plugin-port.ts`, `docs/reviews/domain-boundary-inventory.md`, `docs/architecture-domain-split.md`
  - 移動 (git mv): 上記「3 軸振り分け」のファイル群（数百規模）+ `domains/core/*` 全件
  - 削除: `domains/core/` ディレクトリ
  - 編集: [mcp/composition-root.ts](../../mcp/composition-root.ts), [mcp/handlers/auto-init.ts](../../mcp/handlers/auto-init.ts), [mcp/handlers/index.ts](../../mcp/handlers/index.ts), [mcp/server.ts](../../mcp/server.ts), [tsconfig.json](../../tsconfig.json) (paths: `@domains/development/*` 追加), [.dependency-cruiser.cjs](../../.dependency-cruiser.cjs), [package.json](../../package.json), [scripts/lint-core-layers.ts](../../scripts/lint-core-layers.ts), [drizzle.config.ts](../../drizzle.config.ts)
- **メリット**:
  - 「AI Runtime」と「Salesforce 製品」の境界が物理的に明確化 → 別ドメイン (例: ServiceNow / Workday) 追加時の参入コスト激減
  - コアの再利用性 (OSS 化 / 別製品流用) が現実的選択肢になる
  - レビュー対象が縮小 (PR がドメイン or コアのどちらかに閉じる)
  - depcruise / CODEOWNERS / リリースノートをドメイン別に分離可能
  - T19 (Capability schema) や T04 (Tool Catalog v2) のスコープ削減
  - LLM コアの将来差し替え (LangChain 撤去 = T05) が SF 側に影響しないことが保証される
- **デメリット / リスク**:
  - **特大 git history 改変**: ファイル移動が大量で blame / PR レビューが一時的に困難
  - 移行中は import path 修正が頻発、merge 衝突が起きやすい → **feature freeze 期間を取るか、機械的 codemod で一気に**
  - 「core / domain どちらに置くべきか曖昧」なファイル (例: governance, prompt-engine) の判定にコスト
  - tests 配下も同期再編が必要 (約 197 ファイル中 SF 依存度の棚卸し要)
  - モノレポ化を急ぐと build / CI 整備が肥大化（**今回は単一 package 内 folder 分離に留める**ことでリスク抑制）
- **T00 を最後に置く理由**:
  - T00 は **「コードベース全体の横軸（ドメイン）」** の分割であり、T01〜T30 の縦軸（起動 / Port / 層 / Plugin 契約）と直交する。
  - T01〜T30 で **Port / Catalog v2 / DomainPlugin 契約 / depcruise 4 層規約 / RequestContext** が固まってから物理移動する方が、振り分けルールが明確で機械的に進められる。
  - 大規模 git mv を最終に集約することで、途中の merge 衝突を最小化できる。
  - 当面は **`domains/core/` を中間状態として許容**し、新規追加コードは「core / development / salesforce のどこに属するか」を意識して配置する（T00 着手時の振り分けコストを下げる）。
  - **T-1 → T01 → T01.5 → T02 → ... → T30 → T00** の順で完走すると、T00 が「import path 書き換え + git mv のみ」の機械的タスクに退化し、最も安全に実施できる。

---

### T01 [P0] `mcp/server.ts` 解体・bootstrap 分割

- **変更内容**: 892 行の起動神オブジェクトを責務別 bootstrap モジュールに分割し、`server.ts` を 200 行以下のエントリポイントに縮める。
- **実装方針**:
  1. `mcp/surface/bootstrap/` を新設し、以下の bootstrap モジュールを作成:
     - `bootstrap-governance.ts`（governance / cost-ledger / dangerous-actions / disabled-tools）
     - `bootstrap-orchestration.ts`（chat-tool-runner / pseudo-hooks / queue / DAG）
     - `bootstrap-memory.ts`（memory / failure-memory / hierarchical / KG）
     - `bootstrap-workflow.ts`（in-process / Temporal worker / activities）
     - `bootstrap-observability.ts`（OTEL / Prom / health / SLO burn）
     - `bootstrap-presets-history.ts`（preset / history / session store）
     - `bootstrap-leader-election.ts`
  2. 各 bootstrap は `(handlerContext) => Disposable` を返す純粋関数化。
  3. `runWithLifecycle` は disposables を集約して shutdown する。
- **修正ファイル**:
  - 編集: [mcp/server.ts](../../mcp/server.ts), [mcp/surface/index.ts](../../mcp/surface/index.ts), [mcp/lifecycle.ts](../../mcp/lifecycle.ts)
  - 新規: `mcp/surface/bootstrap/*.ts`（7 ファイル）
- **メリット**:
  - 起動順依存の可視化と単体テスト容易化
  - 新機能追加時の影響範囲が局所化
  - 並行レビュー可能（PR 衝突減）
- **デメリット / リスク**:
  - 大規模差分で merge 衝突しやすい
  - 起動順の暗黙依存を抽出する作業が地味に重い
  - 一時的に重複コードが発生する可能性

---

### T02 [P0] `LlmGateway` Port の二分割

- **変更内容**: `LlmGateway.chat({ topic, agents, persona, skills, turns })` を **純粋な LLM 抽象** と **agent オーケストレーションサービス** に分離。
- **実装方針**:
  1. 新 Port `LlmCompletionPort` を `mcp/core/ports/llm-completion-port.ts` に定義（`complete(ctx, req)`、`stream?`）。
  2. 現行 `LlmGateway.chat(...)` の高位ロジックを `application/services/AgentChatService` に移管（core ではなく application 層を新設）。
  3. `composition-root` を更新し、`LlmCompletionPort` adapter を Ollama / OpenAI / Anthropic 別に登録。
  4. 既存の `langchain-llm.ts` は `LlmCompletionPort` adapter として薄く再実装。
- **修正ファイル**:
  - 新規: `mcp/core/ports/llm-completion-port.ts`, `mcp/application/services/agent-chat-service.ts`, `mcp/infrastructure/llm/ollama-adapter.ts`
  - 編集: [mcp/composition-root.ts](../../mcp/composition-root.ts), [mcp/core/llm/langchain-llm.ts](../../mcp/core/llm/langchain-llm.ts), `LlmGateway` を呼んでいる handler 群
  - 削除済み: 旧 `LlmGateway` Port（`mcp/core/ports/llm-gateway.ts`）
- **メリット**:
  - LLM 提供者の差し替えが本当に可能になる
  - replay / cache / cost 観測の挿入点が明確化
  - テスト時のモック粒度が適正化
- **デメリット / リスク**:
  - 既存 handler の呼び出し側を全面置換（中規模）
  - 移行期に新旧 2 系統が並走しやすい
  - application 層の新設で初学者の認知負荷が一時上昇

---

### T03 [P0] Vector backend 一本化（pgvector 既定 / Qdrant 任意 / LanceDB 撤去）

- **変更内容**: 3 系統同居を解消。pgvector を既定、Qdrant をスケール時のオプション、LanceDB を撤去（または明示的 dev-only ラベル）。
- **実装方針**:
  1. `VectorStorePort`（既存）を tenant-aware に再設計（T06 と協調）。
  2. composition-root で `SF_AI_VECTOR_BACKEND` により pgvector|qdrant のみ選択。
  3. [mcp/core/memory/lancedb-vector-store.ts](../../mcp/core/memory/lancedb-vector-store.ts) を削除し、依存（`@lancedb/*` があれば）削除。
  4. `vector-store-adapter.ts` を Port 実装としてのみ位置付け、上位コードは Port 経由に統一。
  5. ドキュメント・docker-compose プロファイル整理。
- **修正ファイル**:
  - 編集: [mcp/core/ports/vector-store.ts](../../mcp/core/ports/vector-store.ts), [mcp/composition-root.ts](../../mcp/composition-root.ts), [mcp/core/memory/vector-tier.ts](../../mcp/core/memory/vector-tier.ts), [mcp/core/memory/qdrant-vector-store.ts](../../mcp/core/memory/qdrant-vector-store.ts), [memory/vector-store.ts](../../memory/vector-store.ts), [memory/vector-store-adapter.ts](../../memory/vector-store-adapter.ts), [docker-compose.yml](../../docker-compose.yml), [package.json](../../package.json)
  - 削除: [mcp/core/memory/lancedb-vector-store.ts](../../mcp/core/memory/lancedb-vector-store.ts)
- **メリット**:
  - 整合性の単一点
  - 保守 budget の解放
  - 運用判断が runtime 内で完結
- **デメリット / リスク**:
  - LanceDB 利用ユーザがいる場合データ移行が必要
  - 既存設定/ドキュメント更新範囲が広い

---

### T04 [P0] Tool Catalog v2（階層化・命名規約・deprecation）

- **変更内容**: 100+ ある MCP tool 表面を `category > capability > tool` の 3 階層に再編し、命名規約と deprecation メカニズムを導入。
- **実装方針**:
  1. `mcp/surface/tool-catalog.ts` を新設し、tool meta（category, capability, owner, since, deprecatedAt, replacedBy）を中央管理。
  2. 既存 `register-*-tools.ts` を catalog driven に書き換え、register 経路を 1 本化。
  3. `governed-tool-registrar` と統合し、tool 登録時に policy binding を必須化（T15 / T19 の前提）。
  4. deprecation 警告を `ToolCallEvent` に乗せ、observability で可視化。
- **修正ファイル**:
  - 新規: `mcp/surface/tool-catalog.ts`, `docs/tool-catalog.md`
  - 編集: [mcp/handlers/auto-init.ts](../../mcp/handlers/auto-init.ts), [mcp/handlers/index.ts](../../mcp/handlers/index.ts), [mcp/handlers/register-*-tools.ts](../../mcp/handlers/), [mcp/core/registry/define-tool.ts](../../mcp/core/registry/define-tool.ts), [mcp/core/governance/governed-tool-registrar.ts](../../mcp/core/governance/governed-tool-registrar.ts), [mcp/tool-registry.ts](../../mcp/tool-registry.ts)
- **メリット**:
  - 発見性向上、命名衝突予防
  - governance gate の取りこぼし削減
  - 機能削除（負の追加）の運用が可能に
- **デメリット / リスク**:
  - 既存クライアント / ドキュメントとの後方互換維持コスト
  - register-\*.ts 22 系統の機械的書き換えが必要

---

### T05 [P0] `@langchain/community` 撤去

- **変更内容**: `@langchain/community` を依存から除外し、必要箇所は Ollama/HTTP の薄い直叩きに置き換える。
- **実装方針**:
  1. `grep_search` で `@langchain/community` の利用箇所を全列挙。
  2. embedding / loader / utility の用途別に置換実装を作成（多くは数十行で書ける想定）。
  3. `langchain-embedding.ts` `langchain-llm.ts` は `LlmCompletionPort` / `EmbeddingPort` adapter としてのみ残置 or 撤去。
  4. `package.json` / lockfile から削除。
- **修正ファイル**:
  - 編集: [package.json](../../package.json), [mcp/core/llm/langchain-embedding.ts](../../mcp/core/llm/langchain-embedding.ts), [mcp/core/llm/langchain-llm.ts](../../mcp/core/llm/langchain-llm.ts), 利用箇所
  - 新規: `mcp/infrastructure/llm/ollama-embedding.ts`（必要に応じて）
- **メリット**:
  - 推移依存が劇的に減少（ビルド・semver 安定）
  - lock-in 緩和
  - cold start / bundle size 改善
- **デメリット / リスク**:
  - community 由来の便利機能を一部自作する必要あり
  - 移行中に embedding 結果の互換性確認テスト必須

---

### T06 [P1] `RequestContext` 全 Port 第一引数化

- **変更内容**: `RequestContext { tenantId, actorId, sessionId?, traceId, reasonCode? }` を全 Port メソッドの第一引数に強制。
- **実装方針**:
  1. `mcp/core/runtime/request-context.ts` に型と AsyncLocalStorage 伝播を実装。
  2. 全 Port インターフェースを段階的に更新（`port.method(ctx, ...)` シグネチャ）。
  3. surface 層 (MCP transport / HTTP) で context を注入。
  4. 互換シム `withContext(legacyFn)` を一時的に提供しつつ移行。
  5. lint で「Port 呼び出しに ctx を渡し忘れ」を検出。
- **修正ファイル**:
  - 新規: `mcp/core/runtime/request-context.ts`, `eslint-rules/require-request-context.js`
  - 編集: [mcp/core/ports/](../../mcp/core/ports/) 全ファイル, 全 adapter, [mcp/composition-root.ts](../../mcp/composition-root.ts), [mcp/transport.ts](../../mcp/transport.ts), [mcp/transport-http.ts](../../mcp/transport-http.ts)
- **メリット**:
  - tenant 分離・監査・trace 紐付けが構造的に保証
  - 後付け改修コストの劇的削減
- **デメリット / リスク**:
  - 破壊的変更で全 handler に波及
  - 移行期間が長い（段階移行設計が必須）

---

### T07 [P1] `MemoryService` Port の多分割

- **変更内容**: 4 メソッドの薄い `MemoryService` を `MemoryReader` / `MemoryWriter` / `HierarchicalMemoryPort` / `KnowledgeGraphPort` に分割。
- **実装方針**:
  1. 既存 `HierarchicalStore` 型を `HierarchicalMemoryPort` として正式化。
  2. KG 用 Port を新設し `kg-reasoner` / `knowledge-graph` を adapter 化。
  3. `MemoryService` は薄い facade として残し、新規コードは細粒度 Port を使う規約。
  4. depcruise で「core/memory 直接 import」を禁止し Port 経由を強制。
- **修正ファイル**:
  - 編集: [mcp/core/ports/memory-service.ts](../../mcp/core/ports/memory-service.ts), [mcp/core/memory/index.ts](../../mcp/core/memory/index.ts), [mcp/core/memory/kg-reasoner.ts](../../mcp/core/memory/kg-reasoner.ts), [memory/](../../memory/) 配下
  - 新規: `mcp/core/ports/hierarchical-memory-port.ts`, `mcp/core/ports/knowledge-graph-port.ts`
- **メリット**:
  - Port が偽装でなくなり、抽象が機能する
  - retrieval 戦略の差し替えが可能
- **デメリット / リスク**:
  - 既存呼び出し箇所多数の修正
  - Port 数増加による初学者の学習コスト

---

### T08 [P1] `mcp/contexts/*` 形骸化解消

- **変更内容**: `index.ts` 1 ファイルだけのスケルトン context を「中身を埋める」か「削除する」かに二択で決着。
- **実装方針**:
  1. 推奨: 段階的に `core/*` → `contexts/<bounded-context>/{application,domain,infrastructure}` へ移管。
  2. 移管不能と判断したものは `contexts/` から完全削除。
  3. `contexts-manifest.ts` を真実の供給源とし、未登録 context をビルドエラー化。
- **修正ファイル**:
  - 編集: [mcp/contexts/contexts-manifest.ts](../../mcp/contexts/contexts-manifest.ts), [mcp/contexts/](../../mcp/contexts/) 各 `index.ts`, [scripts/lint-contexts.ts](../../scripts/lint-contexts.ts)
  - 削除 or 拡充: 各 context ディレクトリ
- **メリット**:
  - 「設計の嘘」解消
  - core 肥大の本質的解決
- **デメリット / リスク**:
  - 大規模なファイル移動で git history が読みにくくなる
  - 中途で止めると状況悪化

---

### T09 [P1] Workflow を Temporal 主導に統一

- **変更内容**: `in-process | temporal` の dual-mode を解消し、Temporal を主、テスト用に embedded mock を提供。
- **実装方針**:
  1. dev/test 用に `temporalite` または in-memory test server を docker compose に既定組み込み。
  2. `WorkflowEngine` の `in-process` adapter を test-only に格下げ（prod パスから削除）。
  3. workflow / activity の registration を [mcp/infrastructure/workflow/](../../mcp/infrastructure/workflow/) 配下で完結。
  4. session-store と event-store を Temporal の history に対する射影として再定義。
- **修正ファイル**:
  - 編集: [mcp/core/ports/workflow-engine.ts](../../mcp/core/ports/workflow-engine.ts), [mcp/infrastructure/workflow/](../../mcp/infrastructure/workflow/) 配下, [docker-compose.yml](../../docker-compose.yml), [.env.example](../../env.example)
  - 削除候補: in-process workflow adapter（test 用に縮小残置）
- **メリット**:
  - replay / retry セマンティクスの統一
  - dev/prod 差異起因の障害消失
- **デメリット / リスク**:
  - 開発者の起動コスト増（Temporal 必須）
  - 旧 in-process 依存の workflow を Temporal 互換に書き換える手間

---

### T10 [P1] Outbox パターン（pg-boss + event-store 統合）

- **変更内容**: 外部副作用（Salesforce deploy / SIEM export / MCP tool call 等）を outbox 経由のみに限定。
- **実装方針**:
  1. `OutboxPort` を新設、pg-boss を adapter とする。
  2. event-store への `append` と outbox への `enqueue` を `unit-of-work` 内で 1 トランザクション化。
  3. consumer 側を `at-least-once + idempotency-key` 前提に統一。
  4. dead-letter 経路は既存 `replay-siem-dead-letter.ts` を流用。
- **修正ファイル**:
  - 新規: `mcp/core/ports/outbox-port.ts`, `mcp/infrastructure/outbox/pgboss-outbox.ts`
  - 編集: [mcp/core/persistence/postgres-event-store.ts](../../mcp/core/persistence/postgres-event-store.ts), [mcp/core/persistence/unit-of-work.ts](../../mcp/core/persistence/unit-of-work.ts), [scripts/replay-siem-dead-letter.ts](../../scripts/replay-siem-dead-letter.ts)
- **メリット**:
  - 副作用と状態の一貫性保証
  - replay 安全性向上（T11 の前提）
- **デメリット / リスク**:
  - すべての副作用呼び出しを outbox 経由に書き換える必要
  - レイテンシが微増

---

### T11 [P1] Replay 決定論契約 + LLM cache port

- **変更内容**: replay の決定論的範囲を契約として定義し、LLM 出力を cache key で再現する Port を追加。
- **実装方針**:
  1. `docs/replay-determinism-contract.md` で「決定論的に再現する/しない」の境界を明文化。
  2. `LlmCacheStorePort` を追加し、`hash(prompt + params + adapter + version) -> output` で key 化。
  3. replay モード時は LLM 呼び出しを cache hit 必須にし、副作用 (T10) は outbox 抑止。
  4. `replay-reader.ts` に replay-mode フラグを伝播。
- **修正ファイル**:
  - 新規: `mcp/core/ports/llm-cache-port.ts`, `mcp/infrastructure/llm/llm-cache-postgres.ts`, `docs/replay-determinism-contract.md`
  - 編集: [mcp/core/persistence/replay-reader.ts](../../mcp/core/persistence/replay-reader.ts), [scripts/replay-session.ts](../../scripts/replay-session.ts)
- **メリット**:
  - インシデント再現性の劇的向上
  - eval / drift 検出の信頼性向上
- **デメリット / リスク**:
  - cache 容量増加
  - prompt 微変動でも cache miss となる脆さ

---

### T12 [P1] Vector lifecycle scheduler

- **変更内容**: `hot → warm → cold` の自動 demotion・TTL・re-embed をスケジューラ化。
- **実装方針**:
  1. `croner` で日次 demotion job を起動。
  2. アクセス頻度・age・relevance score を入力に tier を遷移。
  3. cold 層は pgvector → S3 cold export（または low-cost backend）。
  4. re-embed は embedding model バージョン変更時に発火。
- **修正ファイル**:
  - 編集: [mcp/core/memory/vector-tier.ts](../../mcp/core/memory/vector-tier.ts), [mcp/core/memory/memory-tier-policy.ts](../../mcp/core/memory/memory-tier-policy.ts), [mcp/core/learning/embedding-migration.ts](../../mcp/core/learning/embedding-migration.ts)
  - 新規: `mcp/core/memory/lifecycle-scheduler.ts`
- **メリット**:
  - vector 肥大化抑制
  - retrieval 品質維持
- **デメリット / リスク**:
  - 誤った demotion で重要記憶を失うリスク（要 audit）

---

### T13 [P1] Schema registry + event versioning

- **変更内容**: event-store payload の schema を中央管理し、versioning を導入。
- **実装方針**:
  1. zod schema を `mcp/domain/events/*` に集約し、`EventName -> SchemaVersion[]` の registry を作成。
  2. append 時に validate、read 時に migration 関数を適用。
  3. 互換チェックを CI に組込み。
- **修正ファイル**:
  - 新規: `mcp/domain/events/`, `mcp/core/event/schema-registry.ts`
  - 編集: [mcp/core/event/event-bus.ts](../../mcp/core/event/event-bus.ts), [mcp/core/event/event-dispatcher.ts](../../mcp/core/event/event-dispatcher.ts), [mcp/core/persistence/postgres-event-store.ts](../../mcp/core/persistence/postgres-event-store.ts)
- **メリット**:
  - 後方互換と replay 安全性
  - SIEM 連携の安定化
- **デメリット / リスク**:
  - 既存 event の schema 化コスト
  - migration コードの肥大化

---

### T14 [P1] dependency-cruiser に 4 層境界を強制

- **変更内容**: `surface → application → (domain | ports)`, `infrastructure → ports` の境界を depcruise rule で強制。
- **実装方針**:
  1. `.dependency-cruiser.cjs` を 4 層 + cross-cutting に書き換え。
  2. `domain` から `langchain|temporal|pg|otel` 等を import 禁止。
  3. CI の `lint:depcruise` を required check に。
- **修正ファイル**:
  - 編集: `.dependency-cruiser.cjs`, [scripts/lint-core-layers.ts](../../scripts/lint-core-layers.ts)
- **メリット**:
  - 抽象漏れの再発防止
- **デメリット / リスク**:
  - 既存違反の一括修正がボトルネック

---

### T15 [P1] OPA 正規化（policy bundle 配信 + 署名）

- **変更内容**: 自作 `opa-policy-engine.ts` を本物の OPA bundle 配信に置き換え、署名検証を導入。
- **実装方針**:
  1. policy を Rego で記述し `config/policies/` を bundle 化。
  2. OPA sidecar または embedded（`opa eval` 経由）で評価。
  3. bundle に cosign 署名（T28 と協調）。
  4. `Conftest` を CI で実行しポリシーを検証。
- **修正ファイル**:
  - 編集: [mcp/core/governance/opa-policy-engine.ts](../../mcp/core/governance/opa-policy-engine.ts), [mcp/core/governance/policy-gate.ts](../../mcp/core/governance/policy-gate.ts), [config/policies/](../../config/policies/), [docker-compose.yml](../../docker-compose.yml)
  - 新規: `infra/opa/` (bundle), `.github/workflows/policy-ci.yml`
- **メリット**:
  - 標準準拠 / 監査対応
  - policy のホットリロード可能
- **デメリット / リスク**:
  - Rego 学習コスト
  - sidecar 運用の複雑性

---

### T16 [P1] OpenTelemetry Collector 経由化

- **変更内容**: SDK から exporter 直結を廃し、OTel Collector を経由する。
- **実装方針**:
  1. `infra/observability/otel-collector-config.yaml` を追加し pipeline を定義（traces, metrics, logs）。
  2. `OTEL_EXPORTER_OTLP_ENDPOINT` を collector に向け直す。
  3. tail-based sampling（T23）の挿入点を確保。
- **修正ファイル**:
  - 編集: [docker-compose.yml](../../docker-compose.yml), [mcp/core/observability/otel-tracer.ts](../../mcp/core/observability/otel-tracer.ts), [mcp/core/observability/runtime.ts](../../mcp/core/observability/runtime.ts)
  - 新規: `infra/observability/otel-collector-config.yaml`
- **メリット**:
  - exporter 切替が runtime 無停止で可能
  - 長期 backend (Tempo/Loki/Mimir) への切替容易化
- **デメリット / リスク**:
  - 1 コンポーネント増加で運用負担微増

---

### T17 [P2] Saga / Compensation DSL on Temporal

- **変更内容**: 補償アクションを宣言的に書ける薄い DSL を Temporal 上に構築。
- **実装方針**:
  1. `defineSaga({ steps: [{do, undo}] })` のような型安全 DSL を実装。
  2. Temporal workflow にコンパイルし、失敗時に `undo` を逆順実行。
  3. governance との binding（dangerous-action は saga 必須）を policy で強制。
- **修正ファイル**:
  - 新規: `mcp/application/saga/`, `mcp/infrastructure/workflow/saga-runner.ts`
  - 編集: [mcp/core/governance/dangerous-actions.ts](../../mcp/core/governance/dangerous-actions.ts)
- **メリット**:
  - 障害時の自動 rollback
  - 業務ロジックの宣言性向上
- **デメリット / リスク**:
  - DSL の表現力と複雑性のトレードオフ
  - 既存 workflow の書き換え必要

---

### T18 [P2] Self-Improvement promotion DAG

- **変更内容**: drift 検知 → policy snapshot → A/B → promotion を 1 本の DAG で自動化。
- **実装方針**:
  1. Temporal workflow として `learning-promotion.workflow.ts` を拡張。
  2. 各ステージを node 化し、合格基準（eval-harness）を policy で定義。
  3. promote 失敗時は自動 rollback、成功時は `policy-snapshot` をタグ付け。
  4. dashboard に promotion 履歴を可視化。
- **修正ファイル**:
  - 編集: [mcp/core/orchestration/workflows/learning-promotion.workflow.ts](../../mcp/core/orchestration/workflows/learning-promotion.workflow.ts), [mcp/core/learning/](../../mcp/core/learning/) 配下, [mcp/core/observability/dashboard.ts](../../mcp/core/observability/dashboard.ts)
- **メリット**:
  - 真の self-improving runtime 化
  - 改善が止まらない
- **デメリット / リスク**:
  - 暴走時の影響範囲
  - 評価メトリクスの設計品質に強く依存

---

### T19 [P2] Agent Capability Schema + Governance binding

- **変更内容**: 各 agent の `capabilities`（使える tool / memory tier / LLM tier / budget）を型で閉じ、policy にバインド。
- **実装方針**:
  1. `agents/*.md` の frontmatter に capability 宣言を追加。
  2. ロード時に zod で検証し、`AgentCapability` ドメイン型に変換。
  3. tool 呼び出し時に `capability ⊇ requiredCapability` を policy gate で検証。
- **修正ファイル**:
  - 編集: [agents/](../../agents/) 各 md, [mcp/core/identity/](../../mcp/core/identity/), [mcp/core/governance/policy-gate.ts](../../mcp/core/governance/policy-gate.ts)
  - 新規: `mcp/domain/agent-capability.ts`
- **メリット**:
  - 権限漏れ防止
  - 100+ agent でも安全に拡張可能
- **デメリット / リスク**:
  - 既存 agent の capability 棚卸しコスト

---

### T20 [P2] Cost-aware model router の Port 化

- **変更内容**: `model-arbitration` を Port 化し、cost-ledger の実績を次の決定にフィードバック。
- **実装方針**:
  1. `ModelRouterPort.choose(ctx, request)` を定義。
  2. adapter は cost / latency / quality SLO を入力に bandit (LinUCB) で arm 選択。
  3. 結果を cost-ledger に記録、次選択にフィードバック。
- **修正ファイル**:
  - 編集: [mcp/core/learning/model-arbitration.ts](../../mcp/core/learning/model-arbitration.ts), [mcp/core/learning/model-registry.ts](../../mcp/core/learning/model-registry.ts), [mcp/core/llm/](../../mcp/core/llm/)
  - 新規: `mcp/core/ports/model-router-port.ts`
- **メリット**:
  - コスト最適化
  - SLO 遵守の自動化
- **デメリット / リスク**:
  - 選択ロジックのデバッグが難解

---

### T21 [P2] Knowledge Graph governance

- **変更内容**: provenance / confidence decay / 矛盾検知を KG に組み込む。
- **実装方針**:
  1. node / edge に `provenance: SourceRef[]`, `confidence: number`, `lastSeen: timestamp` を必須化。
  2. 矛盾 (`A is X` vs `A is ¬X`) を検出する rule engine を追加。
  3. アクセスがない fact の confidence を時間 decay。
- **修正ファイル**:
  - 編集: [mcp/core/memory/knowledge-graph.ts](../../mcp/core/memory/knowledge-graph.ts), [mcp/core/memory/kg-reasoner.ts](../../mcp/core/memory/kg-reasoner.ts), [memory/knowledge-graph.ts](../../memory/knowledge-graph.ts), [drizzle/0019_knowledge_graph.sql](../../drizzle/0019_knowledge_graph.sql)
- **メリット**:
  - ハルシネーション抑制
  - 組織記憶の信頼性向上
- **デメリット / リスク**:
  - 既存 KG データの schema 移行

---

### T22 [P2] CI eval gating

- **変更内容**: `eval:ci` のメトリクス回帰で PR を自動ブロック。
- **実装方針**:
  1. baseline と現在の差分閾値を `config/eval-thresholds.json` で定義。
  2. GitHub Actions / 任意 CI に必須 step として追加。
  3. drift-detector の signal も入力。
- **修正ファイル**:
  - 編集: [scripts/eval-suite.ts](../../scripts/eval-suite.ts), [.github/workflows/](../../.github/) (該当 workflow)
  - 新規: `config/eval-thresholds.json`
- **メリット**:
  - 品質回帰の早期検知
- **デメリット / リスク**:
  - 閾値設計の難しさ
  - false positive で開発が止まる

---

### T23 [P2] Tracing tail-based sampling + 長期 cold backend

- **変更内容**: collector で tail-based sampling を有効化し、長期は Tempo/S3 へ。
- **実装方針**:
  1. `otel-collector-config.yaml` に tail_sampling processor を追加。
  2. 失敗 trace / 高コスト trace / 重要 tenant を 100% 採取、それ以外は確率 sampling。
  3. 長期は Tempo + S3 (or 同等) に転送。
- **修正ファイル**:
  - 編集: `infra/observability/otel-collector-config.yaml`, [docker-compose.yml](../../docker-compose.yml)
- **メリット**:
  - trace explosion 防止
  - コスト管理
- **デメリット / リスク**:
  - サンプリング設計ミスでデバッグ性低下

---

### T24 [P3] KMS 統合 + envelope encryption (per tenant)

- **変更内容**: at-rest 暗号化を KMS-managed envelope key 化、tenant ごとにキー分離。
- **実装方針**:
  1. `SecretsPort` を `KmsPort` に拡張、AWS KMS / GCP KMS / Vault adapter を用意。
  2. memory / audit / event-store で tenant key を使い envelope 暗号化。
  3. キーローテーション手順を `dr-drill` に組込み。
- **修正ファイル**:
  - 編集: [mcp/core/security/at-rest-crypto.ts](../../mcp/core/security/at-rest-crypto.ts), [mcp/core/security/secrets.ts](../../mcp/core/security/secrets.ts), [mcp/core/security/secrets-backends/](../../mcp/core/security/secrets-backends/)
  - 新規: `mcp/core/ports/kms-port.ts`
- **メリット**:
  - enterprise / 規制対応
  - 鍵漏洩 blast radius 限定
- **デメリット / リスク**:
  - クラウド lock-in（adapter で緩和）
  - 性能オーバーヘッド

---

### T25 [P3] OIDC / SAML actor identity 統合

- **変更内容**: actor の発行を IdP と連携し、token から `RequestContext.actorId` を生成。
- **実装方針**:
  1. surface 層で OIDC introspection / SAML assertion を処理。
  2. actor identity を short-lived token として伝播。
  3. RBAC を IdP group に bind。
- **修正ファイル**:
  - 編集: [mcp/core/identity/](../../mcp/core/identity/), [db/schema/actors.ts](../../db/schema/actors.ts), [mcp/transport-http.ts](../../mcp/transport-http.ts)
- **メリット**:
  - SSO / 監査統合
- **デメリット / リスク**:
  - IdP 障害時の availability 設計

---

### T26 [P3] Audit / Event partition 自動運用 + cold export

- **変更内容**: 既存の audit partitioning (0016) を tenant×月で自動化、古いものを cold へ。
- **実装方針**:
  1. partition maintenance を pg-boss schedule で実行。
  2. 古い partition を S3 等に export し detach。
  3. SIEM への連携を保ちつつ DB 容量を抑制。
- **修正ファイル**:
  - 編集: [drizzle/0016_audit_partitioning.sql](../../drizzle/0016_audit_partitioning.sql), [mcp/core/governance/audit-archiver.ts](../../mcp/core/governance/audit-archiver.ts), [scripts/audit-export-siem.ts](../../scripts/audit-export-siem.ts)
- **メリット**:
  - DB 持続可能性
  - 監査リテンション遵守
- **デメリット / リスク**:
  - export pipeline 設計の手間

---

### T27 [P3] Worker pool capability ごとの分離プロセス化

- **変更内容**: Temporal worker を agent capability / heavy-tool 別にプロセス分離。
- **実装方針**:
  1. `task-queue` を capability 別に分割。
  2. docker compose / k8s で worker deployment を分割。
  3. resource limit / autoscale を capability 単位に。
- **修正ファイル**:
  - 編集: [mcp/infrastructure/workflow/](../../mcp/infrastructure/workflow/), [docker-compose.yml](../../docker-compose.yml), `infra/k8s/`
- **メリット**:
  - スケール / 障害分離
- **デメリット / リスク**:
  - 運用コンポーネント数増加

---

### T28 [P3] SBOM (Syft/Grype/cosign) の CI 強制

- **変更内容**: SBOM 生成・脆弱性スキャン・artifact 署名を CI 必須に。
- **実装方針**:
  1. `syft` で CycloneDX JSON 生成。
  2. `grype` で moderate 以上を fail。
  3. `cosign` で artifact / policy bundle 署名（T15 と協調）。
- **修正ファイル**:
  - 新規: `.github/workflows/supply-chain.yml`
  - 編集: [package.json](../../package.json) (`audit:deps` 強化)
- **メリット**:
  - サプライチェーン信頼性
- **デメリット / リスク**:
  - 脆弱性更新追従の運用負担

---

### T29 [P3] scripts/ の `sf-ai` CLI 集約完了

- **変更内容**: 50+ scripts を `sf-ai <command>` サブコマンドに統合。
- **実装方針**:
  1. `commander` ベースの CLI ツリーを定義。
  2. 既存 npm scripts は薄い wrapper に。
  3. `sf-ai help` で発見性を担保。
- **修正ファイル**:
  - 編集: [scripts/sf-ai.cjs](../../scripts/sf-ai.cjs), [scripts/](../../scripts/) 各種, [package.json](../../package.json)
- **メリット**:
  - DX 向上
  - 学習コスト削減
- **デメリット / リスク**:
  - CI ジョブ更新コスト

---

### T30 [P3] テスト e2e 強化

- **変更内容**: replay / chaos / multi-instance / governance violation の e2e テストを整備。
- **実装方針**:
  1. testcontainers で Postgres + Temporal + OPA + (Qdrant) を立ち上げ。
  2. シナリオ別 e2e suite を `tests/e2e/` に作成。
  3. chaos: pod kill / network partition / DB failover をシミュレート。
- **修正ファイル**:
  - 新規: `tests/e2e/`
  - 編集: [tests/](../../tests/) 構成, [package.json](../../package.json) (`test:e2e`)
- **メリット**:
  - 本番 readiness の客観評価
- **デメリット / リスク**:
  - テスト実行時間増加

---

## 推奨実装順（クリティカルパス）

```
T-1 (復旧) ► T01 ► T01.5 ► T14
               │
               ▼
           T02 ► T05
             │
             ▼
           T06 ► T07 ► T08
             │
             ▼
           T03 ► T04
             │
             ▼
           T15  T16
             │
             ▼
           T09 ► T10 ► T11 ► T17
                              │
                              ▼
                            T18 ► T22
                              │
                              ▼
                            T19, T20, T21
                              │
                              ▼
                            T23, T24, T25, T26, T27, T28, T29, T30
                              │
                              ▼
                            **T00 (最終 ドメイン分離)**
```

- **直近 1 サイクル (復旧 + 起動整理)**: **T-1 → T01 → T01.5**
- **次サイクル ("Beta Persistent Runtime" 到達)**: **T14 → T02 → T05 → T03 → T04**
- **その次 (抽象の真実化)**: **T06 → T07 → T08**
- **後 (durable loop)**: **T09 → T10 → T11**
- **続いて (governance / self-improvement)**: **T15, T16, T17, T18, T19, T20, T21**
- **続いて (enterprise + 運用堅牢化)**: **T22 以降**
- **最終**: **T00**（3 軸ドメイン分離・`domains/core/` 廃止を一気に実施）

---

_End of task list._
