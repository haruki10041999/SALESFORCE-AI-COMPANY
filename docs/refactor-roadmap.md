# リファクタリング ロードマップ

`SALESFORCE-AI-COMPANY` の中核を、**自作モジュール中心** から **OSS フレームワーク（LangChain + PostgreSQL/pgvector + Drizzle + pg-boss + pino）中心** へ段階的に置き換える計画。

> 既存の MCP I/F（[mcp/server.ts](../mcp/server.ts)）と外部に公開しているツール契約は **壊さない**。
> 内部実装のみを差し替える「ストラングラー・パターン」で進め、各 Phase で `SF_AI_*` env による切替フラグを設けてロールバック可能にする。
> **LangGraph は採用しない**（既存 orchestration の複雑度では過剰。将来再評価）。

---

## 0. 前提：実行環境ポリシー

**Docker（Docker Desktop / Docker Engine + compose v2）の起動を必須とする。**

理由:
- pgvector 拡張のクロスプラットフォーム install が煩雑
- 開発者間の環境差異を排除
- CI と完全に同一イメージで再現性確保
- 観測性スタック（Jaeger/Prometheus/Grafana）も同一基盤で配布

### Docker で起動するサービス

| サービス | 役割 | 必須度 | profile |
|---|---|---|---|
| `postgres`（pgvector 同梱）| 状態・履歴・ベクタ永続化 | **必須** | 既定 |
| `ollama` | LLM / Embedding | 既定 必須 / GPU 派は任意 | 既定 |
| `jaeger` | トレース UI | 任意 | `observability` |
| `prometheus` | メトリクス収集 | 任意 | `observability` |
| `grafana` | メトリクス可視化 | 任意 | `observability` |

```powershell
# 開発標準
docker compose up -d postgres ollama

# 観測性も含めてフル起動
docker compose --profile observability up -d
```

### Docker で起動しないもの

- **MCP サーバ本体** はホストで `npm run mcp:dev`（tsx watch / ブレークポイント / IDE 統合のため）
- ホスト ↔ コンテナの接続は `localhost:5432`（Postgres）/ `localhost:11434`（Ollama）
- Prometheus → ホスト MCP は `host.docker.internal:9464`（既存設定踏襲）

### 永続化ポリシー

- Postgres データは Docker の named volume に保持する
- `docker compose stop` / `docker compose down` では DB データを残す前提とする
- `docker compose down -v` は DB データを削除する破壊操作として扱い、通常運用手順から外す
- compose 追加時は `postgres` コンテナのデータディレクトリを named volume に必ずマウントする

### CI

GitHub Actions の `services:` に `pgvector/pgvector:pg17` を指定し、開発と同イメージで実行。

---

## 1. ゴール

| 観点 | Before | After |
|---|---|---|
| 実行環境 | 任意（README 手順） | **Docker 必須**（`docker compose up -d` 一発）|
| 永続化 | ファイル (`outputs/*.json[l]`) + `node:sqlite` | **PostgreSQL（Docker）** + `outputs/` は生成物のみ |
| ベクタ検索 | TF-IDF 風自作 ([memory/adapters/jsonl-vector-store.ts](../memory/adapters/jsonl-vector-store.ts)) | **pgvector** + Ollama embedding |
| LLM 呼出 | 自作 [ollama-client.ts](../mcp/core/llm/ollama-client.ts) | **`@langchain/ollama`** |
| Orchestration | 自作 [dag-engine.ts](../mcp/core/orchestration/dag-engine.ts) + `session-registry` | 自作維持 + 永続化のみ Postgres |
| ジョブ/提案キュー | `outputs/tool-proposals/{pending,approved,rejected}/*.json` | **pg-boss** |
| ログ | 自作 `logger.ts` | **pino** + OTel |
| CLI | 自作 [scripts/ai.ts](../scripts/ai.ts) | **commander** ベース |
| 設定 | 自作 [env-loader.ts](../mcp/env-loader.ts) | **dotenv** + zod |
| マイグレーション | 手動スクリプト | **drizzle-kit** |
| Frontmatter パーサ | 自作正規表現 ([declarative/frontmatter.ts](../mcp/core/declarative/frontmatter.ts)) | **`gray-matter`** + **`yaml`** |
| Git 操作 | `execFileSync("git", ...)` ([git-diff-helpers.ts](../mcp/tools/git-diff-helpers.ts)) | **`simple-git`** |
| ファイル走査 | 自作 `fs.readdir` 再帰 | **`fast-glob`** |
| 並行・リトライ | 自作 backoff | **`p-retry`** / **`p-limit`** / **`p-timeout`** |
| TTL キャッシュ | 自作 `setInterval` ([disabled-tools-cache.ts](../mcp/core/governance/disabled-tools-cache.ts) 等) | **`lru-cache`** |
| JSON Schema 検証 | 自作チェック | **`ajv`** |
| スケジュール表現 | 自作判定 | **`croner`**（pg-boss と併用）|
| i18n / エラーメッセージ | 自作辞書 ([errors/messages.ts](../mcp/core/errors/messages.ts)) | **`i18next`** |
| CLI UX | console.log 直書き | **`ora`** / **`cli-progress`** / **`cli-table3`** / **`chalk`** |
| ダッシュボード HTML | 自作文字列連結 ([observability/dashboard*.ts](../mcp/core/observability/), `governance-ui.ts`) | **Grafana** に委譲（撤去）|

---

## 2. 全体フェーズ概要

```
Phase 0: 準備     ── ブランチ・互換 interface・env スイッチ・compose 整備
Phase 1: 基盤     ── PostgreSQL(Docker) + Drizzle + StateStore 抽象
Phase 2: LLM      ── LangChain (@langchain/ollama) PoC
Phase 3: Vector   ── pgvector + LangChain VectorStore
Phase 4: Orch.    ── orchestration 永続化を Postgres へ（自作維持）
Phase 5: Queue    ── pg-boss で proposal キュー置換
Phase 6a: 運用基盤── pino / commander / dotenv / write-file-atomic
Phase 6b: ユーティリティ刷新 ── gray-matter / simple-git / fast-glob / p-* / lru-cache / ajv / croner / i18next / ora
Phase 7: 観測性   ── auto-instrumentation + Grafana ダッシュボード化 + (任意) LangSmith
Phase 8: 撤去     ── 旧自作モジュールを deprecated → 削除
Phase 9: 仕上げ   ── ドキュメント・CI・ベンチマーク

（将来検討）
Phase X1: Salesforce 連携 ── jsforce による Org 直接連携（必要時のみ）
Phase X2: LangGraph 再評価 ── self-refine 等で複雑ループが必要になった時
```

各 Phase は独立 PR 可能。Phase 0/1 のみ全体の前提となる。

---

## 3. Phase 詳細

### Phase 0: 準備（前提整備）

- [ ] `feature/refactor-postgres` ブランチを切る
- [ ] [docker-compose.yml](../docker-compose.yml) に `postgres`（`pgvector/pgvector:pg17`）追加 + `profiles` 整備
- [ ] `postgres` のデータディレクトリを named volume にマウントし、`down -v` の扱いを運用手順に明記する
- [ ] `infra/postgres/init/01-extensions.sql`（`CREATE EXTENSION IF NOT EXISTS vector;`）
- [ ] `.env.local.sample` に `DATABASE_URL=postgres://sfai:sfai@localhost:5432/sfai` 追記
- [ ] env スイッチ
  - `SF_AI_STATE_BACKEND=sqlite|postgres`（既定 `sqlite`、Phase 8 で `postgres` に反転）
  - `SF_AI_VECTOR_BACKEND=jsonl|pgvector`
  - `SF_AI_LLM_CLIENT=native|langchain`
- [ ] 抽象 interface 抽出
  - `StateStore`（[mcp/core/persistence/sqlite-store.ts](../mcp/core/persistence/sqlite-store.ts) 由来）
  - `VectorStoreAdapter`（[memory/vector-store-adapter.ts](../memory/vector-store-adapter.ts)）
  - `LlmClient` / `EmbeddingProvider`（既存 `mcp/core/llm/`）
- [ ] `npm run ai -- doctor` を **Docker 起動チェック** に対応（Postgres / Ollama 接続確認）
- [ ] [README.md](../README.md) 冒頭に「**Docker 必須**」と明記

**成果物**: 切替 env、interface 群、compose 拡張、起動ガイド更新。

---

### Phase 1: PostgreSQL 基盤

**目的**: Postgres コンテナ前提で、最小1テーブル（`governance_state`）を Postgres 化。

- [ ] 依存追加: `pg`, `drizzle-orm`, `pgvector`、dev: `drizzle-kit`, `@types/pg`, `@testcontainers/postgresql`
- [ ] `db/schema/` に Drizzle schema 配置
  - `governance_state`, `history_sessions`, `jsonl_records`, `system_events`, `trace_log`, `metrics_samples`, `org_catalog`, `org_timeline`, `proposals`, `presets`, `operations_log`, `agent_reputation`, `rewards`, `memory_records(embedding vector(768))` …
- [ ] `drizzle.config.ts` + npm scripts
  - `db:generate`（マイグレーション SQL 生成）
  - `db:migrate`（適用）
  - `db:push`（開発用即時反映）
- [ ] `mcp/core/persistence/postgres-store.ts`（`StateStore` 互換）
- [ ] `governance_state` のみ Postgres 切替（env 判定）
- [ ] testcontainers ベースの統合テスト 1 本
- [ ] CI に Postgres service を追加（pgvector イメージ）

**完了条件**: `SF_AI_STATE_BACKEND=postgres` で governance 系テストがグリーン。CI も Docker サービスで通る。

---

### Phase 2: LangChain による LLM 抽象（PoC）

- [ ] 依存追加: `@langchain/core`, `@langchain/ollama`
- [ ] `mcp/core/llm/langchain-llm.ts`（`LlmClient` 互換、`ChatOllama` ラッパ）
- [ ] `mcp/core/llm/langchain-embedding.ts`（`EmbeddingProvider` 互換、`OllamaEmbeddings`）
- [ ] `smart_chat` の 1 ルートを `SF_AI_LLM_CLIENT=langchain` で切替
- [ ] [tests/ollama-client.test.ts](../tests/ollama-client.test.ts) 等の互換テストを並走

**完了条件**: 既存テスト全グリーン、LangChain 経由でも `chat` が応答する。

---

### Phase 3: pgvector + LangChain VectorStore

- [ ] 依存追加: `@langchain/community`
- [ ] `db/schema/memory.ts` で `embedding vector(768)` 列・HNSW or IVFFLAT インデックス定義
- [ ] `memory/adapters/pgvector-vector-store.ts`（`VectorStoreAdapter` 互換、Embedding は Phase 2 を流用）
- [ ] [memory/vector-store.ts](../memory/vector-store.ts) の Public API は不変
- [ ] `SF_AI_VECTOR_BACKEND=pgvector` で切替
- [ ] `scripts/migrate-vector-to-pgvector.ts`（既存 JSONL → pgvector）
- [ ] [tests/vector-store-large-load.test.ts](../tests/vector-store-large-load.test.ts) を pgvector でも実行

**完了条件**: メモリ検索系テストが両バックエンドでグリーン。

---

### Phase 4: Orchestration 永続化を Postgres 化

> LangGraph は採用しない。自作 [dag-engine.ts](../mcp/core/orchestration/dag-engine.ts) / [chat-tool-runner.ts](../mcp/core/orchestration/chat-tool-runner.ts) / [pseudo-hooks.ts](../mcp/core/orchestration/pseudo-hooks.ts) はそのまま維持し、**永続化レイヤだけ Postgres** に寄せる。

- [ ] `db/schema/orchestration.ts`
  - `orchestration_sessions(id, topic, agents jsonb, queue jsonb, state jsonb, updated_at)`
  - `orchestration_messages(id, session_id, agent, role, content, ts)`
- [ ] `mcp/core/orchestration/session-store-postgres.ts`（[session-registry.ts](../mcp/core/orchestration/session-registry.ts) のドロップイン代替）
- [ ] MCP ツール契約は不変（`save_orchestration_session` / `restore_orchestration_session` / `orchestrate_chat` 等）
- [ ] [tests/dag-engine.test.ts](../tests/dag-engine.test.ts) 等のセッション系テストを Postgres バックエンドで実行

**完了条件**: orchestration セッションが Postgres に永続化され、再起動後も復元可能。

---

### Phase 5: pg-boss で提案キュー置換

- [ ] 依存追加: `pg-boss`
- [ ] `mcp/core/resource/proposal/queue-pgboss.ts`（[queue.ts](../mcp/core/resource/proposal/queue.ts) と同一 I/F）
- [ ] `enqueue_proposal` / `approve_proposal` / `reject_proposal` / `auto_apply_pending_proposals` を切替
- [ ] スケジュール系（`auto_apply` / `governance_auto_cleanup`）を pg-boss スケジューラ化
- [ ] [tests/proposal-queue.test.ts](../tests/proposal-queue.test.ts) を両モードで実行

---

### Phase 6a: 運用基盤の刷新コア

- [ ] **pino** 導入（[logger.ts](../mcp/core/logging/logger.ts) を薄いラッパに）
- [ ] **dotenv** 導入（[env-loader.ts](../mcp/env-loader.ts) を簡素化）
- [ ] **commander** で [scripts/ai.ts](../scripts/ai.ts) のサブコマンド再構成
- [ ] **write-file-atomic** で [atomic-write.ts](../mcp/core/io/atomic-write.ts) を置換

---

### Phase 6b: ユーティリティライブラリへの置換

複数の自作ユーティリティを標準 OSS へ一括差し替え。各代替は独立 PR 可能だが、テスト保護のため同一 Phase にまとめる。

- [ ] **`gray-matter`** + **`yaml`** → [declarative/frontmatter.ts](../mcp/core/declarative/frontmatter.ts) を置換、zod スキーマは保持
- [ ] **`simple-git`** → [git-diff-helpers.ts](../mcp/tools/git-diff-helpers.ts) / `branch-diff-*` の `execFileSync` を置換
- [ ] **`fast-glob`** → [scripts/cleanup-outputs.ts](../scripts/cleanup-outputs.ts) 他の `outputs/` 走査スクリプトを簡潔化
- [ ] **`p-retry`** / **`p-limit`** / **`p-timeout`** → LLM クライアントや並行処理のリトライ / 同時実行数制御を標準化
- [ ] **`lru-cache`** → [disabled-tools-cache.ts](../mcp/core/governance/disabled-tools-cache.ts) 他の自作 TTL キャッシュを統一
- [ ] **`ajv`** → [outputs/.schema.json](../outputs/.schema.json) 他の JSON Schema 検証を標準化
- [ ] **`croner`** → [cleanup-scheduler.ts](../mcp/core/resource/cleanup-scheduler.ts) の cron 表現を pg-boss と併用で標準化
- [ ] **`i18next`** → [errors/messages.ts](../mcp/core/errors/messages.ts) と [i18n/locale.ts](../mcp/core/i18n/locale.ts) を i18next リソースに集約
- [ ] **`ora`** / **`cli-progress`** / **`cli-table3`** / **`chalk`** → [scripts/](../scripts) 配下の CLI UX を改善
- [ ] **`diff`** → [signature-diff.ts](../mcp/core/dependency/signature-diff.ts) の diff 表現を代替可能な範囲で置換

**完了条件**: 上記置換後も [tests/](../tests) 全グリーン、`npm run lint` / `npm run typecheck` クリーン。

---

### Phase 7: 観測性強化

- [ ] `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/instrumentation-pg` 追加
- [ ] LangChain callback handler を OTel に接続
- [ ] **Grafana ダッシュボード化**: [observability/dashboard*.ts](../mcp/core/observability/) / [governance-ui.ts](../mcp/core/governance/governance-ui.ts) の自作 HTML 生成を撤廃し、Grafana に委譲
- [ ] Grafana ダッシュボード雛形を `infra/observability/grafana-dashboards/` に配置
- [ ] (任意) `langsmith` を `LANGCHAIN_TRACING_V2=true` で opt-in
- [ ] `docker compose --profile observability up -d` が標準フローに

---

### Phase 8: 旧コード撤去

- [ ] 全テスト・本番動作で新バックエンド稼働を一定期間確認
- [ ] env 既定を反転（`SF_AI_STATE_BACKEND=postgres` 等）
- [ ] 削除対象
  - `mcp/core/persistence/sqlite-store.ts`（互換用に残置可）
  - [memory/adapters/jsonl-vector-store.ts](../memory/adapters/jsonl-vector-store.ts)
  - 旧 `mcp/core/llm/ollama-client.ts`（LangChain ラッパに集約）
  - JSONL 系永続化スクリプト（[scripts/migrate-jsonl-to-sqlite.ts](../scripts/migrate-jsonl-to-sqlite.ts) は完了後削除）
- [ ] [outputs/](../outputs) の役割を「生成物のみ」に縮小し [outputs/.schema.json](../outputs/.schema.json) を更新

---

### Phase 9: 仕上げ

- [ ] [docs/system-architecture-with-uml.md](system-architecture-with-uml.md) を新構成で更新
- [ ] [docs/configuration.md](configuration.md) に新 env を追記
- [ ] [README.md](../README.md) のセットアップ手順更新（**Docker 必須** + Postgres コンテナ前提）
- [ ] [docs/operations-guide.md](operations-guide.md) に compose プロファイル運用を追記
- [ ] CI に Postgres サービスを追加（`pgvector/pgvector:pg17`）
- [ ] ベンチマーク（[scripts/benchmark-suite.ts](../scripts/benchmark-suite.ts)）で旧/新比較

---

## 4. 依存追加サマリ（Phase 別）

```powershell
# Phase 1
npm i pg drizzle-orm pgvector
npm i -D drizzle-kit @types/pg @testcontainers/postgresql

# Phase 2
npm i @langchain/core @langchain/ollama

# Phase 3
npm i @langchain/community

# Phase 5
npm i pg-boss

# Phase 6a
npm i pino dotenv commander write-file-atomic
npm i -D pino-pretty

# Phase 6b
npm i gray-matter yaml simple-git fast-glob p-retry p-limit p-timeout lru-cache ajv croner i18next
npm i ora cli-progress cli-table3 chalk diff
npm i -D @types/diff

# Phase 7
npm i @opentelemetry/auto-instrumentations-node @opentelemetry/instrumentation-pg
# 任意
npm i langsmith

# Phase X1 (将来、Salesforce Org 直接連携を始める時のみ)
npm i jsforce
npm i -D @types/jsforce
```

> Phase 4 は新規依存なし（自作 + Drizzle で完結）。

---

## 4.2. 使うフレームワーク / ライブラリの概要

このリファクタで採用する主要ライブラリの **役割**、**このリポジトリでの使いどころ**、**採用理由** を整理する。

実装例は [docs/refactor-library-examples/README.md](../docs/refactor-library-examples/README.md) に索引を置き、各ライブラリごとのサンプルを分離して管理する。

### コア基盤

| ライブラリ | 役割 | このリポジトリでの使いどころ | 採用理由 |
|---|---|---|---|
| `@modelcontextprotocol/sdk` | MCP サーバ実装 | [mcp/server.ts](../mcp/server.ts), [mcp/bootstrap.ts](../mcp/bootstrap.ts), [mcp/transport.ts](../mcp/transport.ts) | 外部公開 I/F の中核。継続利用が前提 |
| `zod` | スキーマ定義 / 入力検証 | handler 入力、frontmatter、設定検証、tool schema | 型安全と実行時検証を両立できる |
| `typescript` / `tsx` | 型付き実装 / 開発実行 | 全体のビルド・開発起動 | 既存基盤。置換不要 |

### データベース / 永続化

| ライブラリ | 役割 | このリポジトリでの使いどころ | 採用理由 |
|---|---|---|---|
| `pg` | PostgreSQL ドライバ | DB 接続、query 実行、Drizzle の下層 | 標準的で安定 |
| `drizzle-orm` | 型安全 ORM / SQL ビルダ | state store、history、orchestration、proposal などの永続化 | 薄く扱え、既存ロジックを崩しにくい |
| `drizzle-kit` | マイグレーション生成 / 適用 | schema 管理、CI / ローカル migration | 手動 SQL 管理を減らせる |
| `pgvector` | ベクタ列 / 類似検索サポート | memory / failure memory / embedding 保存 | JSONL ベース検索から本格的なベクタ検索へ移行できる |
| `@testcontainers/postgresql` | Postgres 統合テスト | persistence 層・migration のテスト | Docker 前提と相性がよく再現性が高い |

### LLM / 検索

| ライブラリ | 役割 | このリポジトリでの使いどころ | 採用理由 |
|---|---|---|---|
| `@langchain/core` | LLM 抽象 / Runnable / message 型 | LLM クライアント抽象、prompt 実行基盤 | 自作ラッパ責務を減らせる |
| `@langchain/ollama` | Ollama 連携 | chat / embedding を Ollama に接続 | 既存 Ollama 利用を維持しつつ標準化できる |
| `@langchain/community` | Vector store 等の統合 | `PGVectorStore` で memory 検索を置換 | 自作 vector store を段階的に撤去しやすい |
| `js-tiktoken` | トークン数推定 | prompt 見積り、メトリクス計算 | 既に使っており、実務上十分 |

### キュー / スケジュール / 並行制御

| ライブラリ | 役割 | このリポジトリでの使いどころ | 採用理由 |
|---|---|---|---|
| `pg-boss` | Postgres ベース job queue | proposal queue、auto apply、cleanup scheduling | ファイルキューより信頼性が高い |
| `croner` | cron 式評価 | cleanup schedule、handler schedule | cron 判定の自作をやめられる |
| `p-retry` | リトライ制御 | Ollama 呼び出し、外部依存呼び出し | retry 方針を共通化できる |
| `p-limit` | 同時実行数制御 | analyzer / benchmark / scan 系処理 | 大規模入力時の暴走を防ぎやすい |
| `p-timeout` | timeout 制御 | LLM / health check / IO | timeout 実装を共通化できる |
| `lru-cache` | TTL / 容量制御キャッシュ | disabled-tools、prompt cache、graph cache | `setInterval` ベースの自作管理を減らせる |

### 運用 / ログ / 観測性

| ライブラリ | 役割 | このリポジトリでの使いどころ | 採用理由 |
|---|---|---|---|
| `pino` | 構造化ログ | logger 基盤の置換 | 高速で Node と相性が良い |
| `pino-pretty` | 開発用ログ整形 | ローカル開発時の可読性確保 | 本番 JSON と開発表示を分離できる |
| `@opentelemetry/api` | トレース API | trace の抽象レイヤ | 既存 observability 基盤を維持 |
| `@opentelemetry/sdk-node` | OTel SDK 起動 | runtime 初期化 | 自動計装と連携できる |
| `@opentelemetry/exporter-trace-otlp-http` | OTLP exporter | Jaeger 連携 | 現行 observability と整合 |
| `@opentelemetry/auto-instrumentations-node` | 自動計装 | http / fetch / pg などの追跡 | 手動計装量を減らせる |
| `@opentelemetry/instrumentation-pg` | PostgreSQL 計装 | DB クエリのトレース | DB 導入後の観測性を確保 |
| `prom-client` | Prometheus メトリクス | 既存 metrics 公開 | 既存運用と互換性が高い |
| `langsmith` | LLM トレース可視化 | LangChain 実行の追跡（任意） | LLM 系の解析をしやすい |

### CLI / 設定 / ファイル操作

| ライブラリ | 役割 | このリポジトリでの使いどころ | 採用理由 |
|---|---|---|---|
| `commander` | CLI 定義 | [scripts/ai.ts](../scripts/ai.ts) を中心とした CLI | コマンド定義と help を整理できる |
| `dotenv` | env 読み込み | `.env` / `.env.local.sample` ベース設定 | 自作 env-loader を簡素化できる |
| `write-file-atomic` | 原子的ファイル書き込み | atomic write、一部ファイル永続化 | 自作 tmp+rename 実装を縮小できる |
| `fast-glob` | 高速 glob 探索 | outputs 走査、doc 生成、lint scripts | 再帰探索コードを簡潔化できる |
| `gray-matter` | frontmatter 解析 | agent / persona / skill frontmatter | 自作正規表現パーサより堅牢 |
| `yaml` | YAML 解析 | frontmatter、設定拡張 | YAML の edge case 対応を任せられる |
| `simple-git` | Git ラッパ | branch diff、changed tests、changelog 生成 | `execFileSync` 直叩きより扱いやすい |
| `ajv` | JSON Schema 検証 | outputs schema、declarative tool schema | JSON Schema の標準検証器 |
| `diff` | diff 表示生成 | permission set / metadata / signature diff | 差分ロジックの自作を減らせる |

### UI / CLI 表示 / 国際化

| ライブラリ | 役割 | このリポジトリでの使いどころ | 採用理由 |
|---|---|---|---|
| `i18next` | 多言語メッセージ管理 | エラー文言、将来の locale 拡張 | 自作辞書より拡張しやすい |
| `ora` | spinner 表示 | doctor / benchmark / replay 等の進捗表示 | CLI の操作感を改善できる |
| `cli-progress` | progress bar | 長時間処理の進捗可視化 | 進行状況を明示できる |
| `cli-table3` | 表形式出力 | metrics / SLA / doctor 出力 | console 表示が整理される |
| `chalk` | 色付き出力 | CLI ステータス表示 | 可読性向上 |

### 継続利用 / 置換しない既存ライブラリ

| ライブラリ | 理由 |
|---|---|
| `@apexdevtools/apex-parser` | Apex 解析の中核で、代替優位が現時点で薄い |
| `fast-xml-parser` | Salesforce metadata / Flow XML 解析に十分実用的 |
| `eslint` / `prettier` / `@typescript-eslint/*` | 既存の品質基盤としてそのまま使う |
| `fast-check` | property-based test に既に使えている |

### 将来検討

| ライブラリ | 用途 | 採用条件 |
|---|---|---|
| `jsforce` | Salesforce Org 直接連携 | SFDX ラッパを越えて API 直結したくなった時 |
| `@langchain/langgraph` | 複雑なグラフ型 orchestration | self-refine 等で多段ループが必要になった時 |

---

## 4.5. ライブラリ別 影響ファイル一覧

各ライブラリ導入時に **触る／置換される可能性のある主なファイル** を整理。新規作成ファイルは「(新)」、既存削除候補は「(削)」で記す。

### Phase 1: PostgreSQL 基盤

| ライブラリ | 主な対象ファイル |
|---|---|
| `pg` / `drizzle-orm` | (新) `db/schema/*.ts` 全般 / `db/client.ts` / `db/migrate.ts` |
| `drizzle-kit` | (新) `drizzle.config.ts` / [package.json](../package.json) scripts |
| `pgvector` | (新) `db/schema/memory.ts`（vector 列） |
| `@testcontainers/postgresql` | (新) [tests/_setup.ts](../tests/_setup.ts) 拡張 / 新規 `tests/postgres-store.test.ts` |
| 共通: 抽象 interface | (新) `mcp/core/persistence/state-store.ts`（interface） / (新) `mcp/core/persistence/postgres-store.ts` / 既存 [mcp/core/persistence/sqlite-store.ts](../mcp/core/persistence/sqlite-store.ts) は実装の 1 つに格下げ |
| 切替対象 | [mcp/core/governance/governance-state-manager.ts](../mcp/core/governance/governance-state-manager.ts) / [mcp/core/governance/governance-state.ts](../mcp/core/governance/governance-state.ts) |

### Phase 2: LangChain LLM

| ライブラリ | 主な対象ファイル |
|---|---|
| `@langchain/core` | (新) `mcp/core/llm/langchain-llm.ts` / (新) `mcp/core/llm/langchain-embedding.ts` |
| `@langchain/ollama` | 同上、[mcp/core/llm/ollama-client.ts](../mcp/core/llm/ollama-client.ts) と並走 |
| 切替対象 | [mcp/handlers/register-smart-chat-tools.ts](../mcp/handlers/register-smart-chat-tools.ts) / [mcp/core/llm/embedding-provider.ts](../mcp/core/llm/embedding-provider.ts) / [mcp/core/llm/quality-rubric.ts](../mcp/core/llm/quality-rubric.ts) |

### Phase 3: pgvector + LangChain VectorStore

| ライブラリ | 主な対象ファイル |
|---|---|
| `@langchain/community` (`PGVectorStore`) | (新) `memory/adapters/pgvector-vector-store.ts` |
| `pgvector` | `db/schema/memory.ts`（HNSW/IVFFLAT インデックス定義） |
| 切替対象 | [memory/vector-store.ts](../memory/vector-store.ts) / [memory/vector-store-adapter.ts](../memory/vector-store-adapter.ts) / [memory/adapters/jsonl-vector-store.ts](../memory/adapters/jsonl-vector-store.ts) (削) / [memory/project-memory.ts](../memory/project-memory.ts) / [memory/failure-memory.ts](../memory/failure-memory.ts) |
| 移行スクリプト | (新) `scripts/migrate-vector-to-pgvector.ts` |

### Phase 4: Orchestration 永続化

| ライブラリ | 主な対象ファイル |
|---|---|
| `drizzle-orm` のみ | (新) `db/schema/orchestration.ts` / (新) `mcp/core/orchestration/session-store-postgres.ts` |
| 切替対象 | [mcp/core/orchestration/session-registry.ts](../mcp/core/orchestration/session-registry.ts) / [mcp/core/context/orchestration-session-store.ts](../mcp/core/context/orchestration-session-store.ts) / [mcp/core/context/history-store.ts](../mcp/core/context/history-store.ts) / [mcp/handlers/register-history-tools.ts](../mcp/handlers/register-history-tools.ts) / [mcp/handlers/register-chat-orchestration-tools.ts](../mcp/handlers/register-chat-orchestration-tools.ts) |

### Phase 5: pg-boss

| ライブラリ | 主な対象ファイル |
|---|---|
| `pg-boss` | (新) `mcp/core/resource/proposal/queue-pgboss.ts` |
| 切替対象 | [mcp/core/resource/proposal/queue.ts](../mcp/core/resource/proposal/queue.ts) / [mcp/core/resource/proposal/applier.ts](../mcp/core/resource/proposal/applier.ts) / [mcp/handlers/register-proposal-queue-tools.ts](../mcp/handlers/register-proposal-queue-tools.ts) / [mcp/core/resource/cleanup-scheduler.ts](../mcp/core/resource/cleanup-scheduler.ts) / [mcp/core/governance/governance-event-automation.ts](../mcp/core/governance/governance-event-automation.ts) |

### Phase 6a: 運用基盤コア

| ライブラリ | 主な対象ファイル |
|---|---|
| `pino` / `pino-pretty` | [mcp/core/logging/logger.ts](../mcp/core/logging/logger.ts)（薄いラッパに） / 既存 logger 利用箇所は import 不変 |
| `dotenv` | [mcp/env-loader.ts](../mcp/env-loader.ts) / [scripts/init-config.js](../scripts/init-config.js) / [.env.local.sample](../.env.local.sample) |
| `commander` | [scripts/ai.ts](../scripts/ai.ts) / [scripts/help.js](../scripts/help.js) / [scripts/doctor.js](../scripts/doctor.js) / [scripts/scaffold.ts](../scripts/scaffold.ts) / [scripts/cleanup-outputs.ts](../scripts/cleanup-outputs.ts) 等の CLI 群 |
| `write-file-atomic` | [mcp/core/io/atomic-write.ts](../mcp/core/io/atomic-write.ts) / [mcp/core/persistence/atomic-file.ts](../mcp/core/persistence/atomic-file.ts) |

### Phase 6b: ユーティリティ刷新

| ライブラリ | 主な対象ファイル |
|---|---|
| `gray-matter` + `yaml` | [mcp/core/declarative/frontmatter.ts](../mcp/core/declarative/frontmatter.ts) / [mcp/core/declarative/loader.ts](../mcp/core/declarative/loader.ts) / [mcp/core/context/markdown-catalog.ts](../mcp/core/context/markdown-catalog.ts) / [scripts/_tmp-agent-frontmatter.cjs](../scripts/_tmp-agent-frontmatter.cjs) |
| `simple-git` | [mcp/tools/git-diff-helpers.ts](../mcp/tools/git-diff-helpers.ts) / [mcp/tools/branch-diff-summary.ts](../mcp/tools/branch-diff-summary.ts) / [mcp/tools/branch-diff-to-prompt.ts](../mcp/tools/branch-diff-to-prompt.ts) / [mcp/tools/changed-tests-suggest.ts](../mcp/tools/changed-tests-suggest.ts) / [mcp/tools/apex-changelog.ts](../mcp/tools/apex-changelog.ts) / [scripts/check-tool-compatibility.ts](../scripts/check-tool-compatibility.ts) / [scripts/run-selective-tests.ts](../scripts/run-selective-tests.ts) / 各テストの git ヘルパ |
| `fast-glob` | [scripts/cleanup-outputs.ts](../scripts/cleanup-outputs.ts) / [scripts/lint-outputs.ts](../scripts/lint-outputs.ts) / [scripts/lint-core-layers.ts](../scripts/lint-core-layers.ts) / [scripts/archive-history.ts](../scripts/archive-history.ts) / [scripts/learning-replay.ts](../scripts/learning-replay.ts) / [scripts/extract-tool-names.ts](../scripts/extract-tool-names.ts) / [scripts/generate-tools-doc.ts](../scripts/generate-tools-doc.ts) / [scripts/generate-tool-manifest.ts](../scripts/generate-tool-manifest.ts) / [scripts/mask-existing-logs.ts](../scripts/mask-existing-logs.ts) / [scripts/observability-dashboard.ts](../scripts/observability-dashboard.ts) / [mcp/core/context/markdown-catalog.ts](../mcp/core/context/markdown-catalog.ts) |
| `p-retry` | [mcp/core/llm/ollama-client.ts](../mcp/core/llm/ollama-client.ts)（自作 backoff 撤去） / [mcp/core/llm/embedding-provider.ts](../mcp/core/llm/embedding-provider.ts) / [mcp/core/observability/runtime.ts](../mcp/core/observability/runtime.ts) |
| `p-limit` | [mcp/tools/repo-analyzer.ts](../mcp/tools/repo-analyzer.ts) / [mcp/tools/apex-analyzer.ts](../mcp/tools/apex-analyzer.ts) / [mcp/tools/apex-dependency-graph.ts](../mcp/tools/apex-dependency-graph.ts) / [mcp/tools/lwc-analyzer.ts](../mcp/tools/lwc-analyzer.ts) / [mcp/tools/flow-analyzer.ts](../mcp/tools/flow-analyzer.ts) / [mcp/tools/benchmark-suite.ts](../mcp/tools/benchmark-suite.ts) |
| `p-timeout` | [mcp/core/llm/ollama-client.ts](../mcp/core/llm/ollama-client.ts) / [mcp/core/llm/ollama-health.ts](../mcp/core/llm/ollama-health.ts) |
| `lru-cache` | [mcp/core/governance/disabled-tools-cache.ts](../mcp/core/governance/disabled-tools-cache.ts) / [mcp/core/context/chat-prompt-builder.ts](../mcp/core/context/chat-prompt-builder.ts)（promptCache） / [mcp/core/context/prompt-cache-persistence.ts](../mcp/core/context/prompt-cache-persistence.ts) / [mcp/core/prompt/token-counter.ts](../mcp/core/prompt/token-counter.ts)（ENCODING_CACHE） / [mcp/core/dependency/graph-cache.ts](../mcp/core/dependency/graph-cache.ts) / [mcp/core/context/markdown-catalog.ts](../mcp/core/context/markdown-catalog.ts) |
| `ajv` | [scripts/lint-outputs.ts](../scripts/lint-outputs.ts) / [outputs/.schema.json](../outputs/.schema.json) / [mcp/core/declarative/loader.ts](../mcp/core/declarative/loader.ts)（Declarative ToolSpec 検証） / [mcp/core/governance/governance-state-manager.ts](../mcp/core/governance/governance-state-manager.ts)（state JSON 検証） |
| `croner` | [mcp/core/resource/cleanup-scheduler.ts](../mcp/core/resource/cleanup-scheduler.ts) / [mcp/core/governance/handler-schedule.ts](../mcp/core/governance/handler-schedule.ts) / [mcp/core/governance/governance-event-automation.ts](../mcp/core/governance/governance-event-automation.ts) / [scripts/metrics-sla-archive.ts](../scripts/metrics-sla-archive.ts) |
| `i18next` | [mcp/core/errors/messages.ts](../mcp/core/errors/messages.ts) / [mcp/core/i18n/locale.ts](../mcp/core/i18n/locale.ts) / [mcp/core/errors/tool-error.ts](../mcp/core/errors/tool-error.ts) / (新) `mcp/core/i18n/resources/{ja,en}.json` / [scripts/generate-error-codes-doc.ts](../scripts/generate-error-codes-doc.ts) |
| `ora` / `cli-progress` | [mcp/core/progress/progress-formatter.ts](../mcp/core/progress/progress-formatter.ts) / [scripts/tail-progress.ts](../scripts/tail-progress.ts) / [scripts/benchmark-suite.ts](../scripts/benchmark-suite.ts) / [scripts/learning-replay.ts](../scripts/learning-replay.ts) |
| `cli-table3` / `chalk` | [scripts/metrics-dashboard.js](../scripts/metrics-dashboard.js) / [scripts/sla-dashboard.js](../scripts/sla-dashboard.js) / [scripts/metrics-report.js](../scripts/metrics-report.js) / [scripts/help.js](../scripts/help.js) / [scripts/doctor.js](../scripts/doctor.js) |
| `diff` (+ `@types/diff`) | [mcp/core/dependency/signature-diff.ts](../mcp/core/dependency/signature-diff.ts) / [mcp/tools/permission-set-diff.ts](../mcp/tools/permission-set-diff.ts) / [mcp/tools/org-metadata-diff.ts](../mcp/tools/org-metadata-diff.ts) / [mcp/tools/branch-diff-summary.ts](../mcp/tools/branch-diff-summary.ts) |

### Phase 7: 観測性

| ライブラリ | 主な対象ファイル |
|---|---|
| `@opentelemetry/auto-instrumentations-node` | [mcp/core/observability/runtime.ts](../mcp/core/observability/runtime.ts) / [mcp/core/observability/otel-tracer.ts](../mcp/core/observability/otel-tracer.ts) / [mcp/bootstrap.ts](../mcp/bootstrap.ts) |
| `@opentelemetry/instrumentation-pg` | 同上 + `db/client.ts`（自動計装で自動的に接続） |
| `langsmith`（任意） | LangChain 経由の `mcp/core/llm/langchain-*.ts` 全般（callback handler 経由） |
| Grafana 化（撤去） | (削) [mcp/core/observability/dashboard.ts](../mcp/core/observability/dashboard.ts) / [mcp/core/observability/dashboard-agent-views.ts](../mcp/core/observability/dashboard-agent-views.ts) / [mcp/core/observability/dashboard-drill-down.ts](../mcp/core/observability/dashboard-drill-down.ts) / [mcp/core/governance/governance-ui.ts](../mcp/core/governance/governance-ui.ts) / [scripts/observability-dashboard.ts](../scripts/observability-dashboard.ts) → 代替 (新) `infra/observability/grafana-dashboards/*.json` |

### Phase X1（将来検討）: jsforce

| ライブラリ | 想定追加箇所 |
|---|---|
| `jsforce` | (新) `mcp/core/org/jsforce-client.ts` / [mcp/core/org/org-catalog-store.ts](../mcp/core/org/org-catalog-store.ts) 連携 / [mcp/handlers/register-org-catalog-tools.ts](../mcp/handlers/register-org-catalog-tools.ts) / [mcp/tools/deploy-org.ts](../mcp/tools/deploy-org.ts) / [mcp/tools/run-deployment-verification.ts](../mcp/tools/run-deployment-verification.ts) / [mcp/tools/run-tests.ts](../mcp/tools/run-tests.ts) / [scripts/sfdx-wrapper.js](../scripts/sfdx-wrapper.js) |

---

## 5. リスクと対策

| リスク | 対策 |
|---|---|
| Docker 未導入の開発者 | README 冒頭に必須要件として明記、`npm run ai -- doctor` で起動確認 |
| LangChain の breaking change | `~` 固定 + renovate で計画的更新 |
| 既存ツール契約の破壊 | MCP ツール出力 JSON のスナップショットテスト追加 |
| 移行期間中の二重永続化 | dual-write 期間を最小化、新を read source-of-truth に切替後に旧を停止 |
| pgvector のインデックス性能 | `ivfflat` / `hnsw` を Phase 3 後半でチューニング、ベンチで確認 |
| GPU 利用者の Ollama | ホスト install を許容、`OLLAMA_BASE_URL` で切替可能に |
| compose ポート競合 | README に `docker compose down` の手順、`COMPOSE_PROJECT_NAME` 設定を案内 |
| LLM 呼出 callback の重複 trace | OTel と LangSmith を二重起動しない（env で排他） |

---

## 6. マイルストーン目安

| マイルストーン | 含む Phase | 目安スプリント |
|---|---|---|
| **M1: 基盤稼働** | 0, 1 | 1〜2 |
| **M2: LLM/Vector 刷新** | 2, 3 | 1〜2 |
| **M3: Orchestration 永続化** | 4 | 1 |
| **M4: 周辺刷新** | 5, 6a, 6b | 1〜2 |
| **M5: 仕上げ** | 7, 8, 9 | 1〜2 |

---

## 7. 完了条件（DoD）

- [ ] `docker compose up -d postgres ollama` のみで開発環境が成立
- [ ] `npm run ci` グリーン（旧/新バックエンド両モード、CI も Docker サービス使用）
- [ ] MCP ツール契約に **Breaking change なし**（スナップショット差分ゼロ）
- [ ] [outputs/](../outputs) は「ドキュメント・ダッシュボード生成物」のみ（永続状態は Postgres）
- [ ] [docs/](.) 一式が新構成に追従
- [ ] OTel / Prometheus（任意で LangSmith）で主要パスが可視化されている

---

## 8. 次のアクション

最初の一歩として **Phase 0 + Phase 1 の最小 PoC**:

1. `feature/refactor-postgres` ブランチ作成
2. [docker-compose.yml](../docker-compose.yml) に `postgres` 追加 + `profiles` 整理
3. `infra/postgres/init/01-extensions.sql` 作成
4. `pg` / `drizzle-orm` / `drizzle-kit` を導入、`db/schema/governance.ts` 1 ファイル
5. `governance_state` だけ env 切替で Postgres 化
6. testcontainers 統合テスト 1 本追加 → CI に組込

ここが通れば、以降の Phase は並列着手可能。
