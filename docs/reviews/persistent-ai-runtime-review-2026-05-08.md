# Persistent AI Runtime — シニアアーキテクトレビュー

- 対象: `salesforce-ai-company`（mono-repo / TypeScript / MCP server）
- 規模: 約 512 TS ファイル / ~79.3k LOC（うち `mcp/` 50.7k、`tests/` 20.8k、`scripts/` 7.5k、`memory/` 1.9k、`db/` 0.5k、`prompt-engine/` 0.35k）
- 評価軸: 「単発 AI ツール」ではなく「永続的 AI Runtime」として成立しているか
- 評価日: 2026-05-08
- レビュー姿勢: 厳しめ・忖度なし・アーキテクチャ視点

---

## 1. 全体総評（Executive Summary）

このリポジトリは「Claude Desktop の MCP プラグイン」のレベルを完全に超えており、**明らかに永続 Runtime を志向した設計**になっている。Hash-chained audit、tenant RLS、optimistic-lock 付き durable orchestration session、cost ledger、pg-boss governance queue、OTel + Prometheus + SLO burn-rate、circuit breaker / bulkhead / rate limiter、4 種の secret backend、3 種の vector backend、replay / A-B / self-refine / drift-freeze の学習ループ、165 本のテスト（Testcontainers 込み）— これは「研究プロトタイプ」ではなく「縮小版エンタープライズ AI Runtime」と呼ぶべき品質と覆う面積を持つ。

一方で、**「Runtime コアを成立させた成功」と「surface 層が肥大化した失敗」が同居**している。具体的には:

- `mcp/core/` 配下は ports & adapters のセオリーを概ね守っている（`SessionStore`、`StateStore`、`VectorStoreAdapter`、`SecretsBackend`、`EventBus`、`ProposalQueueStore` など全部 interface ベース）。
- しかしそれらを束ねる `register-all-tools-deps.ts` は **80 個近いコールバック**を抱える「god-struct」になっており、`mcp/handlers/register-*-tools.ts` の 6 ファイルが 700〜1554 LOC、`govTool()` 内に business logic を直接書いている。
- 結果、「コアは綺麗、皮が腐っている」典型構造。負債が runtime core ではなく **registration / handler 層に集中している**のは不幸中の幸い。

「LangChain 依存しすぎ問題」については **健全**。LangChain は `@langchain/core` `@langchain/community` `@langchain/ollama` のみで、orchestration / memory / retrieval / governance / learning は全部自作。LangChain は LLM 呼び出しの一形態に過ぎず、コアは LangChain なしでも動く設計になっている。これは賢い判断。

---

## 2. 現在の成熟度レベル

| カテゴリ | レベル (0-5) | 一言 |
|---|---:|---|
| MCP インターフェース | 4 | stdio のみ。HTTP/SSE 未対応が将来ボトルネック |
| Orchestration runtime | 4 | DAG + checkpoint + advisory lock。durable workflow としてはほぼ最低限揃った |
| Memory / RAG | 3 | Adapter 抽象は良。`hierarchical-store` がまだ placeholder |
| Governance | 4 | hash-chain + multi-stage approval + drift-freeze はエンタープライズレベル |
| Observability | 4 | OTel/Prometheus/SLO burn 揃。ただし trace propagation が tool 境界で薄い |
| Learning loop | 4 | self-refine / replay-AB / drift / LinUCB / agent-graph 全部実装。実評価データの蓄積はこれから |
| Security | 4 | OIDC + Vault/AWS-SM + at-rest envelope + RBAC + RLS |
| Production readiness | 3 | Argo Rollouts manifests あり。ただし HA / 水平スケールはこれから |
| Test maturity | 4 | 165 ファイル + testcontainers + fast-check |
| Layering hygiene | 2 | god-struct deps と 1500 LOC handlers が痛い |

**総合成熟度: Level 3.5（"Pre-Enterprise Runtime"）** — 1〜2 個の "破綻シナリオ" を放置すると 4 に届かない。

---

## 3. 強み（Strengths）

1. **Audit hash chain が本物**: [mcp/core/audit/hash-chain.ts](mcp/core/audit/hash-chain.ts) + [audit-writer.ts](mcp/core/audit/audit-writer.ts) は `FOR UPDATE` で直列化した上で SHA-256 prev_hash を繋ぐ。`verifyChain` で破断検出可能、cold-restore script まで存在 ([scripts/audit-cold-restore.ts](scripts/audit-cold-restore.ts))。これは多くの "AI runtime" が持っていない品質。
2. **Durable orchestration が実装されている**: [mcp/core/orchestration/job-runner.ts](mcp/core/orchestration/job-runner.ts) は input/output hash + checkpoint JSON + status ステートマシンを持ち、Postgres backend で永続化。session は optimistic lock (`version` カラム) + advisory lock 二段構え。
3. **Multi-backend 抽象が一貫**: state / session / vector / proposal queue / event bus / secret backend / outputs writer すべてに interface があり、env で切替可能。**dependency inversion を実際にやっている**。
4. **Governance の多段承認**: [mcp/core/resource/proposal/queue.ts](mcp/core/resource/proposal/queue.ts) は `requiredStages` `currentStage` `completedStages` `history` を持ち、pg-boss backend あり。これは "AI 提案を組織として受け入れる" runtime の必須機能。
5. **学習ループが scaffold で終わっていない**: drift detector が実際に `SF_AI_LEARNING_MODE=shadow` に flip し、`policy-snapshot` が `LISTEN policy_updated` で online refresh する。**kill-switch まで自動化されている**。
6. **Tenant RLS**: `app.tenant_id` GUC を pooled client ごとに設定する [withTenantSession](db/client.ts)。test ([tests/postgres-tenant-rls.integration.test.ts](tests/postgres-tenant-rls.integration.test.ts)) で実証。
7. **Cost ledger が prom 連動**: [drizzle/0010_cost_ledger.sql](drizzle/0010_cost_ledger.sql) と `sfai_cost_usd_total` gauge が `governed-tool-registrar` で同時更新される。**budget exceed が drift と同レベルの runtime event**。
8. **テストの厚み**: 165 テスト、testcontainers PostgreSQL 統合、fast-check property-based。**Vitest/Jest 不使用で `node --test` を選んだのは依存最小化として正解**。
9. **Argo Rollouts manifests**: canary / blue-green / analysis-templates が `infra/k8s/rollouts/` に揃う。"作っただけ" でなく `infra/observability/slo-rules.yaml` まで含む。
10. **LangChain 依存の最小化**: コアは LangChain 抜きで動く。これだけは強調しておく。多くの似たプロジェクトはここで詰む。

---

## 4. 弱み（Weaknesses）

1. **God-struct DI**: [mcp/core/registration/register-all-tools-deps.ts](mcp/core/registration/register-all-tools-deps.ts) が 80 個近いコールバックを単一 object で配る。新しい tool 追加 = この struct 拡張 = compat adapter 拡張、で **registration 層が常に 2 重メンテ**。
2. **Fat handlers**: [register-analytics-tools.ts](mcp/handlers/register-analytics-tools.ts) 1554 LOC、[register-core-analysis-tools.ts](mcp/handlers/register-core-analysis-tools.ts) 888、[register-resource-governance-tools.ts](mcp/handlers/register-resource-governance-tools.ts) 842、[register-chat-orchestration-tools.ts](mcp/handlers/register-chat-orchestration-tools.ts) 814 など、tool descriptor の中に business logic が直書きされている。
3. **モジュール初期化時の `process.env` キャッシュ**: [memory/vector-store.ts](memory/vector-store.ts) の `let defaultAdapter = buildAdapter()` や、[mcp/core/learning/drift-detector.ts](mcp/core/learning/drift-detector.ts) などの `analyticsStorePromise` がモジュール load 時点で env を固定する。**multi-tenant test parallelism と将来の multi-process worker で確実に詰む**（既に repo memory `server-tools-integration-env-isolation.md` で苦戦痕跡あり）。
4. **`prompt-engine/` がほぼ vestigial**: 354 LOC しかなく、本物の prompt orchestration は `mcp/core/context/` `mcp/core/learning/` に散らばっている。フォルダ名 over-promise。
5. **`BUILTIN_TOOL_CATALOG` が二重ソース**: [mcp/server-resource-deps.ts](mcp/server-resource-deps.ts) に 80 名のリストがハードコードされ、実際の `govTool()` 呼び出しと sync が手動。**single source of truth がない**。
6. **`hierarchical-store.ts` が placeholder のまま**: [memory/hierarchical-store.ts](memory/hierarchical-store.ts) は `dummyVector` で動いている。SQL ([drizzle/0017_memory_hierarchy.sql](drizzle/0017_memory_hierarchy.sql)) は本気構造（document → section → chunk）なのに、ロジックが追いついていない。
7. **MCP transport が stdio のみ**: HTTP / SSE / WebSocket がない。**Web 統合・remote MCP・multi-process worker の道が塞がっている**。
8. **`mcp/core/skill/` `mcp/core/domain/` が空**: layer 名だけ予約されて契約がない。`domain/index.ts` 1 ファイルのみ。
9. **Trace propagation が tool 境界で薄い**: [trace-context.ts](mcp/core/trace/trace-context.ts) は session 内 phase は綺麗に取れるが、外部 LLM 呼び出し / pg-boss job 越しの trace_id 継承が明示的でない。
10. **Outputs writer の三重化**: `OutputsArtifactWriter` + 学習モジュールの直 `appendFileSync` + applier の atomic-write、3 系統が共存。"DB-first" の意図は明示されているが、**学習系が独自 `analyticsStorePromise` を持っているせいで一貫しない**。

---

## 5. アーキテクチャ上の危険箇所（Critical Hotspots）

| # | 箇所 | 危険性 | 優先度 |
|---:|---|---|---|
| 1 | `register-all-tools-deps.ts` の 80 callback | refactor 不能化、新機能追加コスト線形→指数 | **P0** |
| 2 | 1500+ LOC handler 群 | テスト不能領域・review 不能化 | **P0** |
| 3 | `let defaultAdapter = buildAdapter()` 系の module-init 副作用 | multi-tenant / worker 化で破綻、test flake の温床 | **P0** |
| 4 | `BUILTIN_TOOL_CATALOG` 手動 sync | tool 数 100 超で確実にズレる、resource selector が腐る | **P1** |
| 5 | `hierarchical-store` placeholder | 「organizational memory」を名乗れない | **P1** |
| 6 | stdio only transport | enterprise / remote / multi-instance への進化を阻む | **P1** |
| 7 | trace ID の cross-boundary propagation 弱 | 障害時 root-cause が辿れない | **P1** |
| 8 | OTel/Prom が opt-in（dynamic import） | 本番で 1 行設定漏れすれば observability ゼロ | **P2** |
| 9 | `prompt-engine/` の名前詐欺 | 新人が誤った場所に書く構造 | **P2** |
| 10 | learning module 群が個別に Postgres pool を持つ | connection 枯渇、shutdown 順序事故 | **P2** |

---

## 6. 技術的負債（Tech Debt）

- **Layering 負債（最大）**: `handlers → core` のインポートが narrow port を経由していない。`scripts/lint-core-layers.ts` がある時点で「自覚はあるが間に合っていない」状態。
- **God-struct 負債**: `register-all-tools-deps` の存在自体が「domain ごとに interface を切る」リファクタを先送りした結果。
- **Placeholder 負債**: `hierarchical-store`, `mcp/core/skill/`, `mcp/core/domain/`, `prompt-engine/`。
- **Dual-write 負債**: outputs/ への直接書き込みと DB-first writer の混在。
- **Singleton 負債**: module-init 時の env 読みと pool 作成。
- **Tool catalog 負債**: hardcoded `BUILTIN_TOOL_CATALOG`。
- **手動定数負債**: governance の `defaultGovernanceConfig` 等、定数とコードが別所にある（巨大化中）。
- **巨大 schema reflect 負債**: drizzle schema は 0019 まで進行、roll-back path が migration ファイルに記述されていない。

---

## 7. 不足している重要コンポーネント

1. **HTTP/SSE/WebSocket MCP transport** — stdio 限界の突破
2. **Tool registry の self-describing 化** — `BUILTIN_TOOL_CATALOG` を runtime 反射に置換
3. **Workflow worker pool** — 現状は in-process。durable runtime 名乗るなら separate worker が必要
4. **真の hierarchical / episodic memory 実装**（pgvector 連動）
5. **Trace context propagator**（OTel `propagation` API を p-boss / event-bus / LLM 呼び出しに必ず通す）
6. **Outputs writer の単一化 / port 化**
7. **Connection pool の集中管理**（`PgPoolRegistry` 的な single source）
8. **Plan persistence**（DAG-engine の plan を永続化、replay 可能に）
9. **Replay 標準入出力 schema**（snapshot のスキーマバージョニング）
10. **Cost-attribution の per-skill / per-persona 粒度**
11. **Eval suite registry**（`EvalSuiteResult` を時系列 DB で持つ）
12. **Embedding migration tool**（model 変更時の re-index)
13. **Tenant lifecycle API**（onboarding / suspend / data export）
14. **Backpressure**（rate-limiter は per-actor、global queue depth に対する制御がない）
15. **Disaster recovery runbook の自動化**（手順は docs にあるが orchestrate されていない）

---

## 8. 今後追加すべき機能

- HTTP MCP transport（streamable-http）+ token auth
- Tool registry を decorator/manifest 駆動に
- `WorkflowEngine` を `mcp/core/orchestration/` から `runtime/workflow/` に分離し worker mode を導入
- `MemoryService` interface（hierarchical / episodic / semantic を統合）
- `LlmGateway` 抽象（LangChain を完全に "1 backend" に追いやる）
- Cost forecast（cost-feedback の予測値を governance gate に）
- `AgentRegistry` を data-driven 化（`agents/*.md` frontmatter から runtime build）
- Skill rating の bandit 統合（既に LinUCB あり、reward source を `SkillRatingStore` に拡張）
- Plan / replay / snapshot のスキーマバージョン管理
- Tenant-scoped feature flag

---

## 9. 優先的に修正すべき箇所（P0 / P1 / P2）

### P0 — 1〜2 ヶ月以内

1. `register-all-tools-deps.ts` を **domain 単位で 4〜6 個の port interface に分割**。`HandlerContext` を facade として注入。
2. 1500+ LOC handler を **per-tool ファイル分割**（1 tool = 1 file）+ business logic を `mcp/core/<domain>/services/` に逃がす。tool descriptor は schema + binding のみに。
3. **module-init 副作用排除**: `defaultAdapter` 系を全部 `getDefaultAdapter()` lazy + `setDefaultAdapter()` injection 可能に。`PgPoolRegistry` を導入し全 learning module から共有。
4. `BUILTIN_TOOL_CATALOG` 廃止 → **registry が自分の中身を返す API**（`listRegisteredTools()`）に置換。
5. `hierarchical-store` を pgvector 実装に置換（SQL は既にある）。

### P1 — 3〜6 ヶ月

6. HTTP/SSE MCP transport 追加。
7. OTel propagation を pg-boss / event-bus / Ollama / LangChain 呼び出しに穴あけ。
8. Outputs writer 単一化（直 `appendFileSync` を `OutputsPort` に強制）。
9. `mcp/core/skill/` `mcp/core/domain/` の空フォルダを **削除 or 契約を埋める**。
10. Lint rule を `lint-core-layers.ts` ではなく **eslint-plugin-boundaries** で機械強制。

### P2 — 6 ヶ月+

11. `prompt-engine/` を `mcp/core/prompt/` に統合 or 真の prompt-engine として再構築。
12. Worker process 分離、distributed runtime 化。
13. Replay snapshot のスキーマバージョン管理。

---

## 10. 推奨アーキテクチャ改善案

### 10.1 Layered architecture（強制すべき）

```
┌──────────────────────────────────────────────┐
│  surface/  (MCP tool descriptors + transport) │  ← thin
├──────────────────────────────────────────────┤
│  handlers/ (input validation + facade calls)  │  ← thin (≤200 LOC/file)
├──────────────────────────────────────────────┤
│  application/ (use-case orchestration)        │  ← NEW: 1500行 handlerの避難先
├──────────────────────────────────────────────┤
│  domain/    (business rules, pure)            │
│  ports/     (interfaces only)                 │
├──────────────────────────────────────────────┤
│  infrastructure/ (adapters: pg, ollama, …)    │
└──────────────────────────────────────────────┘
```

### 10.2 Dependency injection の作り直し

- 単一 `Deps` 巨大 struct ではなく、**`HandlerContext`** facade（5〜6 個の port を持つ）+ tool 単位の `RequestContext`（actor / tenant / trace / abort signal）。
- Container は `awilix` / `tsyringe` 等の OSS で十分（自作不要）。

### 10.3 Tool registration を declarative に

```ts
defineTool({
  name: "smart_chat",
  schema: SmartChatSchema,
  capabilities: ["chat", "rag"],
  rbac: { roles: ["chat.invoke"] },
  cost: { estimator: estimateChatCost },
  handler: async (input, ctx) => ctx.chatService.smart(input),
})
```

これだけで `BUILTIN_TOOL_CATALOG` も `register-all-tools` も不要になる。

### 10.4 Memory service の統合

`SemanticStore` `EpisodicStore` `HierarchicalStore` `KnowledgeGraphStore` を **`MemoryService` facade** で束ねる。caller は backend を意識しない。

### 10.5 Workflow engine の分離

`OrchestrationJobRunner` → `runtime/workflow/` に独立、`InProcessWorker` / `PgBossWorker` を選択。**Temporal は今は不要**だが、interface を Temporal-compatible（`activity / workflow / signal`）に揃えると将来移行が楽。

---

## 11. Runtime 進化の次ステップ（Roadmap）

| Phase | テーマ | 主な成果物 |
|---|---|---|
| **Phase 1** (now → 2M) | Layering 健全化 | port 分割、handler slim化、module-init 副作用排除、tool registry self-describing 化 |
| **Phase 2** (2 → 5M) | True Memory & Transport | hierarchical-store 本実装、HTTP MCP transport、OTel propagation 完備 |
| **Phase 3** (5 → 9M) | Distributed Runtime | worker process 化、`PgPoolRegistry`、event bus を pg-notify→Redis Streams または NATS 検討 |
| **Phase 4** (9 → 15M) | Self-Improving Runtime | replay-AB を nightly 化、policy snapshot を実 traffic にカナリア、cost-budget の forecast 統合 |
| **Phase 5** (15M+) | Multi-Org Federation | tenant lifecycle API、cross-tenant analytics、policy marketplace |

---

## 12. Enterprise 運用に必要な追加要素

- **SSO / SCIM 連携**（OIDC verifier はあるが、tenant onboarding API がない）
- **Audit export**（hash chain の S3 cold archive は `audit-cold-restore` script のみ、定期実行体制なし）
- **DR drill 自動化**（`infra/k8s/dr/` あるが手順自動化が docs 止まり）
- **Multi-region read replica**（schema は耐えるが client は片側 DSN 想定）
- **Backup verification**（pg-dump の整合性検証 job）
- **Quota 管理 UI**（cost-budget は YAML、per-tenant 動的変更フロー不在）
- **Incident response hook**（SLO burn alert → governance freeze の自動連鎖はあるが、PagerDuty/Opsgenie 連携なし）
- **Compliance evidence pack**（hash chain + audit log は揃っているが、SOC2 用 export ツールが欠）
- **Customer-facing observability**（tenant が自分のセッションを見る API）

---

## 13. 将来的なスケーラビリティ評価

- **〜10 agent / 単一 tenant / 1 worker**: 現状で快適に動く。
- **〜50 agent / multi-tenant / 1 process**: pg-notify + advisory lock がボトルネック化。`session-registry` の in-memory cache が複数 process で不整合化。
- **〜100 agent / multi-tenant / 多 worker**: **崩壊**。理由:
  - module-init singleton の env キャッシュが worker ごとにズレる
  - `BUILTIN_TOOL_CATALOG` 静的リストが分散環境で sync 取れない
  - LISTEN/NOTIFY は scale すると drop する
  - learning モジュールの `analyticsStorePromise` が pool を握りすぎ connection 枯渇
- **organizational memory（数百 GB）**: pgvector で IVFFlat / HNSW index が必須化。現状はナイーブ ANN。`embedding-ranker` の rerank も in-process。

---

## 14. AI Runtime としての完成度スコア

### 総合: **72 / 100**

内訳:

| 項目 | スコア |
|---|---:|
| Architecture clarity | 6 / 10 |
| Runtime durability | 8 / 10 |
| Memory / RAG | 6 / 10 |
| Governance / Safety | 9 / 10 |
| Observability | 8 / 10 |
| Self-improvement | 8 / 10 |
| Infrastructure | 7 / 10 |
| MCP / DX | 7 / 10 |
| Production readiness | 6 / 10 |
| OSS strategy | 7 / 10 |

**評価**: 同種の "AI runtime を名乗るプロジェクト" の業界平均は 35〜50 点。72 は **客観的に高い**。が、80 を超えるためには P0 5 項目のすべてが必須。

---

## 15. OSS 導入優先順位（推奨）

### 今すぐ導入すべき（P0）

| OSS | 用途 | 理由 |
|---|---|---|
| **eslint-plugin-boundaries** または **dependency-cruiser** | Layer 強制 | 自作 `lint-core-layers.ts` を機械化 |
| **awilix** または **tsyringe** | DI container | god-struct の解消 |
| **zod-to-json-schema** | tool descriptor 自動生成 | `BUILTIN_TOOL_CATALOG` 廃止の前提 |
| **@opentelemetry/context-async-hooks** + propagation API の正しい統合 | trace propagation | 既に依存はあるが使い切れていない |

### 後から導入すべき（P1〜P2）

| OSS | 用途 | 導入時期 |
|---|---|---|
| **BullMQ** または **Temporal** | distributed worker | Phase 3 / 50+ agent 規模で |
| **Redis Streams** または **NATS JetStream** | event bus 拡張 | LISTEN/NOTIFY 限界突破時 |
| **Qdrant** または **Weaviate** | dedicated vector DB | embedding 数百万件超 |
| **DuckDB** | analytics replay | 学習データ集計が pg を圧迫したら |
| **Hono** または **Fastify** | HTTP MCP transport | Phase 2 |
| **OpenFeature** | feature flag | tenant-scoped flag が必要になったら |
| **Argo Workflows** | DAG execution の "重い版" | 複数システム跨ぐ workflow が出たら |

### 今は不要（避けるべき / 流行追随禁止）

| OSS | 理由 |
|---|---|
| **LangChain Agents / LangGraph** | 既に独自 orchestration が成熟。導入すると **business logic が LangChain に握られる** |
| **LlamaIndex** | memory layer は自作で足りている。導入 = 抽象 2 重化 |
| **CrewAI / AutoGen** | Agent ループは既存。単に framework 名で意思決定すると runtime ownership を失う |
| **Vercel AI SDK** | server-side runtime には過剰、client/UI ライブラリ |
| **Chroma / Milvus** | pgvector で当面足りる。distributed が必要になるまで非導入 |
| **Inngest / Restate** | pg-boss + 自作 job-runner で十分カバー範囲。早期導入は lock-in リスク |

### 自作維持した方が良い領域

- **Tool registry / governed-tool-registrar** — runtime の差別化要因そのもの
- **Audit hash chain** — 単純で正しく動いている。OSS にすると逆に重い
- **Trace context（domain 用語付き phase model）** — OTel に被せている層が DX 改善に効いている
- **Cost ledger** — 価格モデルが Salesforce 文脈に強く依存
- **Resource selector / synergy / LinUCB** — 学術的にも自前実装の方が制御効く
- **Drift freeze / policy snapshot** — runtime governance の心臓、絶対自作維持

---

## 16. 推奨 dependency boundary

```
surface/   →  handlers/
handlers/  →  application/        (NEW)
application/ →  domain/ ports/    (interface 経由のみ)
infrastructure/ ─implements→ ports/
domain/    →  なし（pure）
ports/     →  なし（pure interface）
```

**禁止すべき import**:

- `handlers/* → memory/*`（直接禁止、port 経由）
- `handlers/* → mcp/core/learning/*`（同）
- `mcp/core/* → mcp/handlers/*`（既に守られている）
- `domain/* → infrastructure/*`（純粋性維持）
- `*/learning/* → process.env`（context 経由に）

---

## 17. 推奨 interface 一覧（最低限）

```ts
interface LlmGateway {
  chat(req: ChatRequest, ctx: RequestContext): Promise<ChatResponse>;
  embed(text: string, ctx: RequestContext): Promise<number[]>;
}

interface MemoryService {
  semantic: SemanticStore;
  episodic: EpisodicStore;
  hierarchical: HierarchicalStore;
  graph: KnowledgeGraphStore;
}

interface WorkflowEngine {
  startSession(plan: Plan, ctx: RequestContext): Promise<SessionHandle>;
  signal(sessionId, signal): Promise<void>;
  resume(sessionId): Promise<void>;
}

interface GovernanceGate {
  authorize(action, ctx): Promise<Decision>;
  record(event): Promise<void>;
  audit(event): Promise<void>;       // hash-chained
}

interface CostLedgerPort {
  charge(entry: CostEntry, ctx): Promise<void>;
  forecast(scope, window): Promise<CostForecast>;
}

interface ObservabilityPort {
  trace<T>(name, fn, ctx): Promise<T>;
  metric(name, value, labels): void;
  log(event): void;
}

interface OutputsPort {
  writeArtifact(kind, payload, ctx): Promise<ArtifactRef>;
  appendEvent(stream, event, ctx): Promise<void>;
}

interface SessionStore { … }       // 既存
interface ProposalQueueStore { … } // 既存
interface SecretsBackend { … }     // 既存
interface VectorStoreAdapter { … } // 既存
interface EventBus { … }           // 既存
interface PluginRegistry { … }     // 既存

interface HandlerContext {
  llm: LlmGateway;
  memory: MemoryService;
  workflow: WorkflowEngine;
  governance: GovernanceGate;
  cost: CostLedgerPort;
  observability: ObservabilityPort;
  outputs: OutputsPort;
  // tool 固有 service は ad-hoc 注入
}
```

---

## 18. Abstraction layer 設計案

- **Port = pure interface**（`mcp/core/ports/`）
- **Adapter = infrastructure 実装**（`mcp/infrastructure/<adapter>/`）
- **Service = application service**（`mcp/core/application/`）— 1500 LOC handler の避難先
- **Domain = pure rules**（`mcp/core/domain/`）— 既存空フォルダを埋める
- **Handler = 入出力 + 1〜2 service 呼び出し**（≤200 LOC）

CI に **dependency-cruiser** 設定を追加し、上記の禁止 import を機械チェック。

---

## 19. Runtime complexity 増加リスク

新規 OSS 導入時に増えるリスクを定量化:

| 候補 | 複雑度増 | 学習コスト | enterprise 価値 | 結論 |
|---|---|---|---|---|
| Temporal | 高 | 高 | 高 | Phase 3+ で検討 |
| BullMQ | 中 | 低 | 中 | 既 pg-boss で代替可 |
| Qdrant | 中 | 中 | 中 | pgvector 限界後 |
| LangGraph | **超高** | 中 | 低 | **導入禁止推奨** |
| Hono / Fastify | 低 | 低 | 高 | Phase 2 で導入 |
| dependency-cruiser | 低 | 低 | **高** | **即導入** |
| awilix | 低 | 中 | 高 | **即導入** |
| Redis | 中 | 低 | 中 | event bus 拡張時 |

---

## 20. Lock-in リスク分析

| ベクトル | リスク | 緩和策 |
|---|---|---|
| **LLM provider lock-in** | 低 | `LlmGateway` 経由化されつつあり、現在は Ollama 中心で OSS 中心。LangChain は薄く使う |
| **Embedding lock-in** | 中 | `VectorEmbeddingProvider` interface あり。ただし dim=768 ハードコード、model 切替時の re-index 経路なし |
| **Vector DB lock-in** | 低 | adapter 抽象済 |
| **MCP SDK lock-in** | 中 | tool 形が `@modelcontextprotocol/sdk` の `McpServer` 直結。HTTP transport 化時に layer ずらし必要 |
| **PostgreSQL lock-in** | 中 | `LISTEN/NOTIFY` `advisory lock` `RLS` `pgvector` を多用、移植困難（が、これは **意図的・健全**） |
| **pg-boss lock-in** | 低 | `ProposalQueueStore` interface 経由 |
| **LangChain lock-in** | **低**（重要） | コアは LangChain なしで動く |
| **OpenTelemetry lock-in** | 低 | dynamic import で opt-in |
| **prom-client lock-in** | 低 | 同上 |
| **Argo Rollouts lock-in** | 中 | manifests 直書き、Helm 化未着手 |

総じて **lock-in 戦略は健全**。Postgres への深い依存は意識的なものでこれは正しい判断。

---

## 21. 「今すぐ導入すべき OSS」

1. **dependency-cruiser**（layer 強制）
2. **awilix**（DI、god-struct 解消）
3. **zod-to-json-schema**（tool 自動 descriptor 化）
4. **OTel propagation API の正しい統合**（既存 dep を使い倒す）
5. **rate-limiter-flexible**（既存 fixed-window を distributed sliding window に置換可能）

---

## 22. 「後から導入すべき OSS」

1. **Hono**（HTTP MCP transport, Phase 2）
2. **BullMQ** または **Temporal**（distributed worker, Phase 3）
3. **Redis Streams / NATS**（event bus 拡張, Phase 3）
4. **Qdrant** or **Weaviate**（vector scale, Phase 4）
5. **OpenFeature**（feature flag, Phase 4）
6. **Argo Workflows**（system-跨ぎ workflow, Phase 5）
7. **DuckDB**（learning analytics, Phase 4）

---

## 23. 「今は不要な OSS」

- LangGraph / LangChain Agents
- LlamaIndex
- CrewAI / AutoGen
- Vercel AI SDK
- Chroma / Milvus
- Inngest / Restate（pg-boss と自作 job-runner で十分）
- Hasura / PostgREST
- Helm（K8s 規模が小さいうち）
- Service mesh（Istio/Linkerd）
- Kafka

---

## 24. 「自作維持した方が良い領域」

- Tool registry + governed-tool-registrar
- Audit hash-chain
- Cost ledger
- Trace phase model（input / plan / execute / render + think / do / check）
- Drift freeze + policy snapshot
- Resource selector + synergy + LinUCB
- Skill/persona/agent markdown loading
- Replay AB harness
- 構造化された self-refine loop

これらは **runtime の差別化要因**。OSS 化は ownership 喪失と等価。

---

## 25. Runtime が破綻するシナリオ（優先度順）

### 🔴 Tier 1 — 確実に最初に破綻する

1. **`register-*-tools.ts` 肥大化による merge conflict 多発**
   - 1500 LOC が 2 人以上で同時編集されれば毎週 conflict、PR レビュー不能。
   - 対策: P0-2 の per-tool ファイル分割。

2. **module-init singleton の multi-process 不整合**
   - HTTP transport 追加 + worker 化した瞬間、env キャッシュが worker 間でズレ、観測不能なバグになる。
   - 対策: P0-3 の lazy + injection 化。

### 🟠 Tier 2 — 次に破綻する

3. **pg-notify drop による orchestration step lost**
   - LISTEN/NOTIFY は pg load 時 silently drop する。100 agent 規模で reproducible になる。
   - 対策: outbox pattern + Redis Streams or pg-boss 経由。

4. **embedding model 変更時の re-index 不能**
   - dim=768 ハードコード、migration script なし。次世代 embedding に切替えられない。
   - 対策: `VectorIndexMigration` ジョブを定義。

5. **`BUILTIN_TOOL_CATALOG` ズレによる resource selector の腐敗**
   - tool 数が 200 を超えれば確実に sync ミス。selector が存在しない tool を返し始める。
   - 対策: P0-4 の registry 自己反射化。

### 🟡 Tier 3 — 中長期で破綻

6. **trace explosion / cost explosion**
   - reasoning step 全保存 + 詳細 prom labels。learning AB 拡大で trace ストレージが線形→指数。
   - 対策: sampling、retention policy、`tool` `actor` ラベルの cardinality 上限。

7. **vector DB 肥大化**
   - failure-memory + organizational memory + dedup なし → pgvector single instance が IO bound 化。
   - 対策: vector tier 化（hot pgvector / cold S3 + DuckDB）。

8. **Governance approval queue 詰まり**
   - human-in-the-loop が runtime クリティカルパスにある（applier）。承認者不在で proposal が滞留 → policy 更新が止まる。
   - 対策: SLA タイムアウト + auto-approval policy。

9. **Cost-feedback の循環**
   - cost が learning reward に直結すると "安いだけの劣化解" を選ぶ収束に行く可能性。
   - 対策: quality-rubric を主、cost を従の reward 設計を明示。

10. **Hierarchical-store placeholder のまま production claim**
    - "organizational memory" を売り物にした瞬間、`dummyVector` が露呈する。
    - 対策: P0-5 の本実装。

### 🟣 Tier 4 — Framework lock-in 由来（潜在）

11. **LangGraph / LangChain Agents を将来導入してしまう**
    - business logic が framework に持っていかれ、runtime ownership 喪失。
    - 対策: 採用禁止リストを architecture decision record に明文化。

---

## 補遺 A — 「単発 AI」vs「永続 Runtime」観点での評価

| 観点 | 状態 |
|---|---|
| 永続 Runtime か | **YES**（session・audit・cost・state すべて永続） |
| Organizational memory に発展可能か | YES、ただし `hierarchical-store` 本実装が前提 |
| Replay 可能か | YES（snapshot + replay-AB harness 実装済） |
| Observability 十分か | 概ね YES、trace propagation だけ穴 |
| Runtime governance 実現可能か | **YES**（hash chain + multi-stage + drift freeze） |
| Self-improvement loop 成立しているか | **YES**（ただし shadow → live 昇格の human gate がボトルネック） |
| Runtime complexity 制御できているか | **NO**（god-struct と fat handlers が制御不能の入口） |
| OSS 依存でアーキ崩壊しないか | **YES**（コアは LangChain 抜きで動く） |

---

## 補遺 B — 100 agent / 自律改善 / enterprise governance を扱う場合の必須変更

1. **god-struct DI 廃止 → port-based DI**（必須）
2. **handlers slim 化**（必須、PR レビューが死ぬ）
3. **HTTP transport + worker pool**（必須、stdio は単 process のみ）
4. **event bus を Redis Streams or NATS に**（pg-notify は drop する）
5. **vector DB 階層化**（hot/cold tier）
6. **trace sampling + retention**
7. **per-tenant quota & feature flag**
8. **disaster recovery automation**
9. **embedding migration tool**
10. **policy snapshot の canary 化**

---

## 結論

「永続 AI Runtime」として **設計意図は正しく、コアは本物**。これは AI agent 業界では稀。一方で **god-struct + fat handlers + module-init 副作用** という古典的な layering 失敗が、せっかくの core を覆い隠している。

**最大の脅威は「LangChain 依存」ではなく「自分自身の registration / handler 層の腐敗」**。これを 2 ヶ月で叩けば、80 点超えと "Production Persistent AI Runtime" 自称が両立できる。

放置すれば、この runtime は **6 ヶ月以内に 1500 LOC handler の merge conflict と module singleton 起因の "再現しないバグ" に飲まれる**。優先度は明確で、修正順序も明確。あとは P0 の 5 項目を実行するだけ。

— end of review —
