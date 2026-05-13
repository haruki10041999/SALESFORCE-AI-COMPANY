# Persistent AI Runtime — シニアアーキテクト評価レビュー

> 対象: `salesforce-ai-company` リポジトリ
> 評価軸: 「単発AIツール」ではなく「**永続的AI Runtime (Persistent AI Runtime)**」
> スタンス: 甘い評価禁止 / 表面的褒め禁止 / アーキテクチャ視点で厳しく
> 評価日: 2026-05-13

---

## 0. エグゼクティブサマリ (TL;DR)

このリポジトリは「MCPツール群」ではなく **MCPの皮を被ったAI Runtime Kernel** を志向しており、Hexagonal/Ports & Adapters 構造、IoCコンテナ (awilix)、proposal queue、SLO burn、memory tier、agent synergy、replayable session など、エンタープライズAIランタイムに必要な要素は **概念レベルでは網羅** している。

しかし以下の根本的な懸念がある:

1. **「Runtime Core」自体は健全だが、`mcp/core/` 配下が肥大化 (~274 TS files) しており、kernel と application logic の境界が曖昧化** している。
2. **Workflow durability が in-process / pg-boss 二択で弱い**。100+ persistent agent / long-running workflow には非対応。
3. **Observability は計装は十分だが、replay-debugging を支える "事象-状態" モデルが未確立** (snapshot はあるがイベントソーシングではない)。
4. **Self-improvement loop は "メトリクス収集 + bandit" 止まり**。reflection / eval-harness / shadow promotion の閉ループは未完成。
5. **MCP tool が 113+ に膨張**しており、tool 設計の「LLM 視点での discoverability」と「人間視点での保守性」の両方が破綻寸前。
6. **Embedding / Vector / LLM が Ollama + pgvector + LangChain に強結合**。switch可能と謳いつつ adapter 層が薄い。
7. **governance は state-machine 化されているが "policy DSL" が無く、コードでpolicy判定が散在** → enterprise governance としては未成熟。

**現在の成熟度: Persistent AI Runtime としては Phase 1.5 / 4 (= "stateful prototype")**
- 単発AIツール (Phase 0) は完全に超えている
- 永続的・自己改善的 Runtime (Phase 4) には届いていない
- 「Stateful Multi-Agent MCP Server」(Phase 1.5) として高品質

---

## 1. 全体総評

### 良い点 (実態ベース)
- **Ports / Adapters / Composition Root** の三段構造が明確で、`mcp/composition-root.ts` の awilix 利用は健全。
- **persistence backend の差し替え** (sqlite / postgres / memory) が runtime profile で切替可能、テスト容易性が高い。
- **migration 管理** が `drizzle/` に整然と並んでおり (0000-0021)、schema evolution が追跡可能。
- **observability の計装は OSS 業界標準** (OTel + Prometheus + Jaeger + Grafana) を踏襲しており、見た目だけの自作ロガーではない。
- **governance の proposal queue (pg-boss)** で stage→approve→apply の workflow が実装されており、enterprise志向が見える。
- **vector tier / hot-warm-cold** という memory growth 対策が *最初から* 入っている点は珍しく、評価に値する。
- **layer-manifest.ts による layering 強制** は本気度が高い (lint で守る思想)。

### 厳しい指摘
- **`mcp/core/application/` が 30+ service files** で「Service層オブジェクト爆発」が始まっている。今のうちに `bounded context` 境界を打たないと、3年後に「Salesforce DX っぽいservice層」と化する。
- **`mcp/handlers/` の register-* 27本** は MCP tool 登録の責務だけだとしても、各register内で domain logic が滲み出ている懸念が高い。
- **prompt-engine が `mcp/core/prompt/` への re-export だけ** という設計は、歴史的経緯としては理解できるが、現時点では「プロンプト処理」を独立 package にする意思がないなら削除すべき (dead architecture)。
- **memory/ と mcp/core/memory/ の二重存在** が層境界を曖昧にしている (top-level memory/ は legacy?)。
- **Tool 数 113+ は LLM の tool selection 精度を急速に劣化させる**。GPT-4 系でも 30-50 tools が実用上限。tool grouping / namespacing が必須。

---

## 2. 現在の成熟度レベル

| 軸 | レベル (0-5) | コメント |
|---|---|---|
| Architecture (Hexagonal/DI) | **4** | port 7本 + DI / 境界明確 |
| Runtime durability | **2** | in-process workflow が主、pg-boss は proposal限定 |
| Memory / RAG | **3** | tier化は良いが retrieval quality 評価系が弱い |
| Governance | **3** | proposal queue 強い / policy DSL 無し |
| Observability | **3** | 計装○ / replay-debug が弱い |
| Self-Improvement | **2** | bandit / drift はあるが閉ループ無し |
| Infrastructure | **3** | docker-compose ◎ / k8s rollout は雛形のみ |
| MCP / DX | **3** | tool数過多 / 命名一貫性 △ |
| Production Readiness | **2.5** | scalability/HA story が薄い |
| OSS活用戦略 | **2** | LangChain浅い使用 / 自作多い |

**総合スコア (AI Runtime完成度): 58 / 100**
- Stateful MCP server としては 80点
- "永続的 AI Runtime" としては 50点台
- "self-improving organizational memory" としては 35点台

---

## 3. 強み (Strengths)

| # | 強み | 根拠 |
|---|---|---|
| S1 | Ports & Adapters の徹底 | `mcp/core/ports/` 7本 + `composition-root.ts` |
| S2 | Backend swap可能性 | state/vector/queue/event-bus/secret 全て env で切替 |
| S3 | Layer manifest で構造強制 | `scripts/lint-core-layers.ts` で CI ブロック可能 |
| S4 | Memory tiering を最初から設計 | `vector-tier.ts` / migration 0021 |
| S5 | Audit hash chain | tamper detection (migration 0002) — enterprise視点 |
| S6 | Tenant isolation を DB レベルで | `withTenantSession` + `app.tenant_id` GUC |
| S7 | Observability stack 標準準拠 | OTel + Prom + Jaeger + Grafana |
| S8 | Governance proposal queue (pg-boss) | stage→approve→apply の state machine |
| S9 | Schema versioning + snapshot | migration 0020 — replay 基盤の礎 |
| S10 | Skill / Persona / Agent を markdown で外部化 | runtime と知識の分離 |

---

## 4. 弱み (Weaknesses) — 厳しめ

| # | 弱み | 深刻度 |
|---|---|---|
| W1 | **Workflow engine が in-process 主体**, durable execution 非対応 | 🔴 High |
| W2 | **Tool 数 113+ で LLM の tool selection 精度が崩壊** | 🔴 High |
| W3 | **`mcp/core/` がモノリシック**、bounded context 未定義 | 🔴 High |
| W4 | **Self-improvement loop が閉じていない** (eval結果→model promote が手動) | 🔴 High |
| W5 | **Replay = session snapshot 復元** に留まる、event sourcing でない | 🟠 Med |
| W6 | **Embedding provider lock-in (Ollama)** — OpenAI/Voyage/Cohere fallback無し | 🟠 Med |
| W7 | **Vector backend abstraction が pgvector/tfidf のみ**、Qdrant/Weaviate/LanceDB拡張口無し | 🟠 Med |
| W8 | **Governance policy がコードに散在** (DSL or OPA 不在) | 🟠 Med |
| W9 | **prompt-engine/ が re-export のみ** — dead module | 🟡 Low |
| W10 | **memory/ と mcp/core/memory/ の二重ディレクトリ** | 🟡 Low |
| W11 | **scripts/ が 40+ で運用ガバナンス不在** (entry pointが曖昧) | 🟠 Med |
| W12 | **CEO/PM/Architect agent と code agent が同列** — agent role hierarchy 無し | 🟡 Low |
| W13 | **cost-ledger が "placeholder"** と composition-root に明記 | 🟠 Med |
| W14 | **HA story 不在** (single Postgres / single Ollama / leader election 無し) | 🟠 Med |
| W15 | **trace explosion 対策無し** (sampling policy 不明) | 🟠 Med |

---

## 5. アーキテクチャ上の危険箇所

### D1. `mcp/core/application/` の Service爆発
- 30+ service ファイルが直接 port を呼ぶ構造。  
- 新機能追加のたびに「ServiceXyz」が生まれ、**3年後に Spring 風 Anemic Domain Model 化** する。
- **対策**: bounded context (Resource / Governance / Learning / Orchestration / Memory / Observability) を `mcp/contexts/<bc>/` に再配置し、各 BC 内に application/domain/infrastructure を持たせる。

### D2. Workflow Engine の脆弱性
- `in-process-workflow-engine.ts` がメインの workflow engine。プロセスクラッシュで in-flight job が消失。
- `pg-boss` は proposal queue 専用で、汎用 workflow には使われていない。
- **危険シナリオ**: long-running multi-agent workflow 中にプロセス再起動 → 状態喪失 → user side effect は実行済み (audit残るが retry不能)。
- **対策**: `Temporal` / `Restate` / `Inngest` 等の **durable execution engine** へ port 化。

### D3. Tool Surface 113+ の LLM-side 破綻
- Claude/GPT は tool description 全文を context に詰める。113 tools × 平均200 tokens = **22,600 tokens** をシステム側で消費。
- tool selection accuracy も急落 (実証研究: 50+ tools で f1 が 30%以上劣化)。
- **対策**: 
  1. **Hierarchical tool routing** (`smart_chat` / `meta_tool` 経由で sub-tool dispatch)
  2. tool を「coarse-grained capability」に再設計
  3. 実装上は internal API として残し、**MCP surface は 20-30 個に絞る**

### D4. Self-Improvement の閉ループ未完成
- `agent-synergy` `lin-ucb-bandit` `drift-detector` `model-registry` は揃うが、**結果を policy 更新に自動反映するパイプライン不在**。
- `apply_proposal` が governance 用、model promote 用は別途必要。
- **対策**: `LearningOrchestrator` を新設し、`shadow→canary→promote` を Temporal workflow 化。

### D5. Embedding / Vector の Lock-in
- `OllamaEmbeddings` がデフォルト、fallback は n-gram TF-IDF のみ。
- 本番で Ollama サーバが落ちると **品質が n-gram まで劣化**(機能継続はするが retrieval は実質崩壊)。
- **対策**:
  1. `EmbeddingProvider` port を `embed(texts): number[][]` 単一メソッドに絞る
  2. 実装に OpenAI / Voyage / Bedrock / Cohere を加える
  3. **provider 横断の dimension整合**を `EmbeddingMetadataRegistry` で管理 (migration 0005 がその礎)

### D6. Governance Policy のコード化
- `mcp/core/governance/` 20files に if/else 形で policy が散在。
- enterprise では「監査人が policy を読める」必要がある。コードでは不可。
- **対策**: Open Policy Agent (OPA) / Cedar の導入。policy を `*.rego` / `*.cedar` に外出し。

---

## 6. 技術的負債 (Tech Debt)

| ID | 内容 | 利息 (年率) | 推奨返済時期 |
|---|---|---|---|
| T1 | `prompt-engine/` re-export のみ残存 | 低 | 即 |
| T2 | `memory/` と `mcp/core/memory/` 二重 | 低 | 1Q |
| T3 | `cost-ledger` placeholder のまま | **高** | 即 |
| T4 | tool 113+ の手動登録 | 高 | 1Q |
| T5 | scripts/ 40本の用途分類無し | 中 | 1Q |
| T6 | LangChain の浅い利用 (chain/agent未使用) | 中 | 2Q |
| T7 | in-process workflow engine | **高** | 2Q |
| T8 | governance policy の hard-code | 中 | 2-3Q |
| T9 | sampling/sanitization policy 不在 (trace) | 中 | 2Q |
| T10 | secret backend 4種実装の test カバレッジ | 中 | 2Q |
| T11 | DR/failover 文書はあるが automation 無し | 中 | 3Q |
| T12 | k8s rollouts/ が雛形 | 低 | 3Q |

---

## 7. 不足している重要コンポーネント

1. **Durable Workflow Engine** (Temporal/Restate) — Phase 2 必須
2. **Reflection / Critique Loop** (LLM-as-judge を別 lifecycle で) — Phase 2
3. **Eval Harness as Service** (現状 script、CI 連携未設計) — Phase 2
4. **Policy Engine (OPA/Cedar)** — Phase 3
5. **Embedding Provider Multiplexer** — Phase 2
6. **Vector DB 抽象 (Qdrant/Weaviate adapter)** — Phase 3
7. **Event Sourcing Layer** (audit ≠ event store) — Phase 3
8. **Secrets / Config 管理 SaaS Adapter** (Doppler/Infisical) — Phase 3
9. **Multi-tenant Quota / Rate Limit** (現 reliability/ は単機) — Phase 3
10. **Replay Debugger UI** (event timeline + agent state diff) — Phase 3
11. **Cost Aggregator + Budget Enforcer** (cost-ledger を実装) — Phase 1
12. **Tool Routing / Hierarchical MCP** — Phase 1
13. **Knowledge Graph 推論** (現 ingest のみ) — Phase 3
14. **HA / Leader Election** (pg-advisory-lock or etcd) — Phase 2

---

## 8. 今後追加すべき機能 (機能ロードマップ)

| Phase | 機能 | 目的 |
|---|---|---|
| 1 (1-2 mo) | Tool 階層化 / `smart_chat` 優先化 | LLM tool selection 救済 |
| 1 | cost-ledger 実装 + budget 強制 | 暴走LLMコスト防止 |
| 1 | prompt-engine 削除 + memory/ 統合 | dead code 除去 |
| 2 (2-4 mo) | Temporal / Restate 導入 | durable workflow |
| 2 | Embedding provider multiplexer | lock-in 解消 |
| 2 | Reflection loop (LLM-as-judge) | self-improvement 起動 |
| 2 | Eval harness を CI に組込み | regression 検知 |
| 2 | Trace sampling + PII redactor | trace explosion 防止 |
| 3 (4-6 mo) | OPA/Cedar | policy as code |
| 3 | Event Sourcing (replay/CQRS) | true replayability |
| 3 | Vector DB adapter (Qdrant/LanceDB) | retrieval品質 / scale |
| 3 | Replay Debugger UI | enterprise debug |
| 4 | Multi-region / leader election | HA |
| 4 | Tenant quota / fair scheduling | SaaS化 |

---

## 9. 優先的に修正すべき箇所 (Priority Matrix)

| 優先度 | 項目 | 工数 | 即効性 |
|---|---|---|---|
| **P0** | cost-ledger 実装 (placeholder解消) | 中 | 高 |
| **P0** | tool 階層化 / surface 圧縮 | 中 | 高 |
| **P0** | embedding provider 抽象強化 | 低 | 中 |
| **P1** | durable workflow 検討 (Temporal POC) | 高 | 中 |
| **P1** | sampling/PII policy (trace) | 低 | 高 |
| **P1** | scripts/ 棚卸し + cli 統合 | 中 | 中 |
| **P1** | prompt-engine 削除 | 低 | 低 |
| **P2** | OPA policy DSL 導入 | 高 | 中 |
| **P2** | event sourcing 化 | 高 | 中 |
| **P2** | bounded context 再配置 | 高 | 高 (中長期) |

---

## 10. 推奨アーキテクチャ改善案

### 10.1 Bounded Context 再配置
```
mcp/
  surface/                # MCP transport / tool registration
  contexts/
    orchestration/        # workflow / agent dispatch / trigger
    memory/               # vector / hierarchy / KG
    governance/           # policy / proposal / approval
    learning/             # bandit / drift / shadow / promote
    observability/        # otel / prom / dashboard
    resource/             # skill / preset / persona / agent registry
    cost/                 # ledger / budget / forecast
    identity/             # tenant / actor / RBAC
  shared/                 # ports / errors / utils
```
各 context は内部に `application / domain / infrastructure` を持つ。`mcp/core/application/` 30+ services はこの再配置で自然に分散。

### 10.2 Runtime Layering (理想形)
```
┌──────────────────────────────────────────────┐
│ Surface         : MCP / HTTP / CLI           │
├──────────────────────────────────────────────┤
│ Application     : use-case / saga            │
├──────────────────────────────────────────────┤
│ Workflow        : Temporal / Restate         │  ← durable
├──────────────────────────────────────────────┤
│ Domain          : pure logic (no I/O)        │
├──────────────────────────────────────────────┤
│ Ports           : LLMGateway / Memory / ...  │
├──────────────────────────────────────────────┤
│ Adapters        : pgvector / Ollama / pg     │
├──────────────────────────────────────────────┤
│ Cross-cut       : OTel / OPA / Logger        │
└──────────────────────────────────────────────┘
```

### 10.3 Tool 階層化案
- **Tier 1 (MCP surface, 15-20)**: `chat`, `smart_chat`, `orchestrate`, `recall`, `propose`, `approve`, `analyze`, `report`, `health`, `replay` …
- **Tier 2 (sub-capability, 内部dispatch)**: 既存 113 を Tier1 から呼ばれる internal handler に降格
- LLM が見るのは Tier1 のみ → tool selection 精度回復

---

## 11. Runtime進化の次ステップ (3 Step)

1. **Step 1 (Stabilize)**: cost-ledger 完成 / tool階層化 / dead code 除去 / sampling 投入
2. **Step 2 (Durable)**: Temporal導入 / embedding multiplexer / reflection loop / eval harness in CI
3. **Step 3 (Govern)**: OPA / event sourcing / replay UI / vector DB pluggable / HA

---

## 12. Enterprise運用に必要な追加要素

- SSO / SCIM / fine-grained RBAC (現状 actors テーブルあるが OIDC 連携が薄い)
- Data residency / region-aware routing
- Audit export to SIEM (Splunk/Datadog)
- DR runbook の **automation** (現状ドキュメントのみ)
- Tenant quota / fair scheduler
- Encryption-at-rest 設定 (pgcrypto / KMS)
- Backup / PITR の自動検証
- Change advisory (proposal queue を承認者UIに繋ぐ)
- Compliance report 自動生成 (SOC2/ISO27001 controls mapping)

---

## 13. 将来的なスケーラビリティ評価 (100+ agents / long-running / 自律改善)

| シナリオ | 現状の限界 | 主要ボトルネック |
|---|---|---|
| 100+ persistent agent | 30 agent 程度で破綻 | in-process workflow / event-bus in-memory / tool surface 圧 |
| Long-running workflow (>1h) | 30min で危険 | プロセス再起動で消失 |
| 自律改善ループ | 半自動どまり | shadow→promote の automation 無し |
| 1000 tenant | 100 tenant程度 | pg pool 単一 / quota 無し |
| 1M chunks vector | 数十万まで | pgvector index tuning / cold tier 圧縮無し |
| 100 req/s | 10-20 req/s | LLM bound / circuit breaker は単機 |

---

## 14. AI Runtime としての完成度スコア

**58 / 100**

内訳:
- Architecture: 14/20
- Runtime durability: 5/15
- Memory/RAG: 9/15
- Governance: 8/15
- Observability: 8/10
- Self-improvement: 4/10
- Infra/DX: 6/10
- OSS戦略: 4/5

---

## 15. OSS導入優先順位

### 🟢 今すぐ導入すべき (Phase 1)
| OSS | 理由 | 衝突 |
|---|---|---|
| **OpenTelemetry SDK 強化 (sampling/redactor)** | trace explosion 防止 / 既に部分採用 | 無 |
| **Zod-to-JSON-Schema (or `@hono/zod-openapi`)** | tool schema 自動化 | 軽微 |
| **`@temporalio/client` POC** | durable workflow 検証 | 既存 in-process と並走 |
| **`tiktoken`完全採用 (現 js-tiktoken)** | token 計測精度 / 既に採用 | 無 |
| **`p-queue` / `p-limit`** | concurrency 制御 (自作回避) | 無 |
| **`undici` / `got`** | http client 一貫化 | 無 |

### 🟡 後から導入すべき (Phase 2-3)
| OSS | 理由 |
|---|---|
| **Temporal / Restate / Inngest** | durable workflow 本格採用 |
| **Open Policy Agent / Cedar** | policy as code |
| **Qdrant / Weaviate / LanceDB** | vector scale (pgvector の後) |
| **LangSmith / Helicone / Langfuse** | LLM observability (OTel補完) |
| **Ragas / Promptfoo** | RAG/Prompt eval harness |
| **DSPy** | prompt 自動最適化 (tune_prompt_templates の置換) |
| **Pyroscope / Continuous profiling** | perf 可視化 |
| **MinIO / S3** | cold tier object store |

### 🔴 今は不要 (over-engineering)
- **LangGraph / CrewAI / AutoGen の本格採用** — 既存 orchestration と二重化、core が崩壊
- **LlamaIndex 全面導入** — 既に hierarchical retrieval を自作済、二重化
- **Kafka / NATS** — 現 event-bus 規模では過剰
- **Kubernetes Operator 自作** — Helm + Argo Rollouts で十分
- **Service Mesh (Istio/Linkerd)** — まず単体強化
- **Vector DB 即時切替** — pgvector で十分通用

### ⚪ 自作維持した方が良い領域
- **Composition Root / Ports** — 自作で十分、薄く保つ
- **Skill/Persona/Agent markdown registry** — 差別化要因
- **Vector tier classifier** — domain知識が要る
- **Synergy / agent-graph-learner** — 競争優位
- **Audit hash chain** — compliance 競争優位

---

## 16. 推奨 Dependency Boundary

```
[Surface]    →  [Application]  →  [Domain]
                       ↓ (port)
                 [Infrastructure]
                       ↓
                 [External: pg / Ollama / pg-boss / OTel]
```
**禁止方向**:
- Domain → Infrastructure (直接)
- Application → External (port を介さず)
- Surface → Domain (Application 経由)
- Cross-context 直接依存 (event-bus 経由のみ)

`scripts/lint-core-layers.ts` を bounded context に対応させ、`depcruise` で CI 強制する。

---

## 17. 推奨 Interface 一覧

```ts
// Persistent Runtime Core
interface WorkflowEngine        { start(spec): WorkflowHandle; signal(id, sig); query(id, q); replay(id) }
interface DurableTimer          { schedule(at, payload): void }
interface EventStore            { append(stream, events); read(stream, fromVersion); subscribe(filter, h) }

// LLM/Embedding
interface LLMGateway            { chat(req): Stream<Token> }
interface EmbeddingProvider     { embed(texts, opts): number[][]; dimension: number; modelId: string }
interface Reranker              { rerank(query, docs): RankedDoc[] }
interface Critic                { critique(input, output): CritiqueResult }   // reflection

// Memory/RAG
interface VectorStore           { upsert(items); query(vec, k, filter); delete(filter) }
interface HierarchicalStore     { ingest(doc); retrieve(query, level): Chunk[] }
interface KnowledgeGraph        { addTriple(); query(cypherLike); subgraph(node, depth) }
interface MemoryTierPolicy      { classify(item): 'hot'|'warm'|'cold'; promote(); demote() }

// Governance
interface PolicyEngine          { evaluate(input, policySet): Decision }      // OPA wrap
interface ProposalQueue         { stage(p); approve(id); apply(id); list() }
interface CostLedger            { record(usage); spend(window); enforce(budget) }
interface RateLimiter           { allow(key, cost): boolean }

// Observability
interface Tracer                { startSpan(name, attrs): Span }
interface MetricsSink           { counter / gauge / histogram }
interface ReplayLog             { snapshot(); diff(a, b); timeline(filter) }

// Learning
interface EvalHarness           { run(suite): EvalReport }
interface Bandit                { suggest(ctx): Arm; reward(arm, r) }
interface DriftDetector         { observe(metric); alerts(): Drift[] }
interface ModelRegistry         { register(); promote(); rollback(); shadow() }

// Identity / Multi-tenant
interface ActorContext          { tenant; principal; scopes }
interface SecretsProvider       { get(name); rotate(name) }
```

---

## 18. Abstraction Layer 設計案

### 18.1 LLM 抽象 (3層)
```
LLMGateway (port)
  ├─ ProviderRouter (model alias → provider)
  │   ├─ OllamaProvider
  │   ├─ OpenAIProvider
  │   ├─ AnthropicProvider
  │   └─ BedrockProvider
  └─ Decorators
      ├─ RateLimitDecorator
      ├─ CostLedgerDecorator
      ├─ RetryDecorator
      ├─ CacheDecorator
      └─ TraceDecorator
```

### 18.2 Memory 抽象 (3層)
```
MemoryFacade
  ├─ TierRouter (hot/warm/cold)
  │   ├─ InMemoryHot
  │   ├─ PgVectorWarm
  │   └─ S3JsonlCold
  ├─ HierarchicalStore (chunk/section/doc)
  └─ KnowledgeGraph (entity/relation)
```

### 18.3 Workflow 抽象
```
WorkflowEngine (port)
  ├─ InProcessEngine    # dev
  ├─ TemporalAdapter    # prod
  └─ RestateAdapter     # alternative
```

---

## 19. Runtime Complexity 増加リスク

| 提案 | 複雑度増加 | mitigation |
|---|---|---|
| Temporal導入 | **高** | 既存 in-process と coexistence、新規 saga のみ Temporal |
| OPA導入 | 中 | 既存 hard-code を policy bundle に段階移行 |
| Embedding multiplexer | 低 | provider 追加は加点的 |
| Event sourcing | **高** | 既存 audit を event store として再利用、CQRS は read model 単位に |
| Vector DB pluggable | 中 | adapter pattern 維持で吸収 |
| Bounded context 再配置 | **高** (一時的) | feature flag + 段階移行、layer-manifest で守る |

---

## 20. Lock-in リスク分析

| 領域 | Lock-in 度 | 主因 | 解消優先度 |
|---|---|---|---|
| Ollama | **高** | デフォルト、test 前提 | P0 |
| pgvector | 中 | adapter薄い | P1 |
| pg-boss | 中 | proposal専用、限定的 | P2 |
| LangChain | **意外に低** | embeddings のみ薄使用 | 監視のみ |
| Drizzle | 低 | SQL生成のみ | 不要 |
| awilix | 低 | composition-root 1箇所 | 不要 |
| MCP SDK | 中 | surface 全体に散在 | adapter化推奨 |
| Salesforce ドメイン | 高 (本質的) | 本ツールの核 | 解消不要 |

---

## 21. 「今すぐ導入すべきOSS」(Top 5)

1. **OpenTelemetry sampler/redactor 設定** — 既に SDK 採用済、policy だけ未整備
2. **Temporal (POC)** — durable workflow 緊急性高
3. **Promptfoo / Ragas** — eval harness を OSS に寄せる
4. **OpenPolicyAgent (低侵襲な policy bundle)** — まず governance の閲覧性
5. **Doppler/Infisical or sops** — secret backend を統一

---

## 22. 「後から導入すべきOSS」

- DSPy (prompt 自動最適化)
- Qdrant / LanceDB (vector scale, pgvector飽和後)
- Langfuse (LLM trace 専用、OTel と組合せ)
- Argo Rollouts (現状 yaml のみ)
- MinIO / R2 (cold tier)
- BullMQ (pg-boss の代替候補, redis前提なら)

---

## 23. 「今は不要なOSS」

- LangGraph / CrewAI / AutoGen (orchestration 二重化)
- Kafka / NATS (event 規模に過剰)
- Istio (まず単体)
- LlamaIndex 全面 (RAG 自作で十分動く)
- Kubernetes Operator 自作

---

## 24. 「自作維持した方が良い領域」

- **Skill / Persona / Agent registry (markdown ベース)** — 差別化
- **Synergy / agent-graph-learner** — competitive moat
- **Vector tier classifier** — domain logic
- **Audit hash chain** — compliance 強み
- **Resource governance proposal lifecycle** — 業務固有
- **Composition root / port 7本** — 薄く保つ限り自作で十分

---

## 25. Runtime が破綻するシナリオ (優先順位付き)

| 順位 | シナリオ | 引金 | 影響 | 対処 |
|---|---|---|---|---|
| 🥇 1 | **Tool surface explosion** | tool 200突破 / LLM が誤選択連発 | UX 崩壊・cost 暴騰 | tool 階層化 (P0) |
| 🥈 2 | **Workflow durability 崩壊** | プロセス再起動 / OOM kill | in-flight job 喪失 / side-effect 不整合 | Temporal化 |
| 🥉 3 | **Cost runaway** | budget 強制無し / cost-ledger placeholder | 月額予算1桁突破 | cost-ledger 実装 (P0) |
| 4 | **Vector DB 肥大化** | tier downgrade ジョブ無し | 検索遅延 / disk逼迫 | cold tier 圧縮 / Qdrant 移行 |
| 5 | **Trace explosion** | sampling 無し | OTel collector OOM | sampling policy |
| 6 | **Memory growth (KG)** | 無制限 ingest | 推論遅延 / index 肥大 | TTL / pruning |
| 7 | **Governance bypass** | policy hard-code バグ | 不正ツール実行 | OPA化 |
| 8 | **Observability 崩壊** | dashboard ハードコード × 数十枚 | 改修不能 | dashboard-as-code |
| 9 | **Embedding lock-in** | Ollama 障害 + 大量再 embed | 検索停止 | multiplexer |
| 10 | **Multi-tenant 干渉** | quota 無し / pg pool 飽和 | 騒がしい隣人 | tenant quota / pool分離 |
| 11 | **Replay 不能** | event sourcing 不在 | RCA 不能 | event store導入 |
| 12 | **Framework lock-in** | LangChain への深入り | upgrade 不能 | port 維持 / 浅利用 |

---

## 26. 「自作 vs OSS」差別化マトリクス

| 領域 | 自作価値 | Commodity度 | 推奨 |
|---|---|---|---|
| MCP server core | 中 | MCP SDK あり | SDK + 薄い自作 |
| Workflow durability | 低 | Temporal等成熟 | **OSS** |
| Vector store | 低 | pgvector/Qdrant成熟 | **OSS** |
| Embedding | 低 | provider 戦争中 | **OSS multiplexer** |
| Policy engine | 低 | OPA成熟 | **OSS** |
| Tracing | 低 | OTel標準 | **OSS** (採用済) |
| Eval harness | 中 | Ragas/Promptfoo発展中 | **併用** |
| Skill registry | **高** | 競合無し | **自作維持** |
| Agent synergy | **高** | 研究領域 | **自作維持** |
| Governance proposal lifecycle | **高** | 業務固有 | **自作維持** |
| Audit hash chain | 中 | OSS少ない | **自作維持** |
| Memory tier policy | **高** | 領域固有 | **自作維持** |
| Reflection loop | 中 | DSPy等発展 | **OSS薄ラップ** |

---

## 27. Runtime進化チェックリスト (Persistent AI Runtime 5要件)

| 要件 | 達成度 | コメント |
|---|---|---|
| ✅ State persists across restarts | 70% | session/proposal は Postgres / workflow state は脆弱 |
| ⚠️ Replayable execution | 35% | snapshot あり / event sourcing 無し |
| ⚠️ Self-improving loop | 30% | bandit/drift 計測 / 自動 promote 無し |
| ✅ Multi-agent coordination | 70% | trigger/synergy あり / DAG 軽量 |
| ⚠️ Organizational memory | 50% | KG ingest あり / 推論・想起戦略弱 |
| ⚠️ Governance as code | 35% | proposal 強い / policy DSL 無し |
| ✅ Observability | 75% | OTel/Prom/Jaeger 揃う |
| ❌ Durable workflow | 20% | in-process が主 |

---

## 28. 最重要メッセージ

> **このリポジトリは "AI Runtime の骨格" を持っているが "Runtime としての肉" がまだ薄い。**
> もっとも危険なのは「優秀な抽象が増え続けて application logic が `mcp/core/application/` に溜まり続ける」ことであり、いま **bounded context 境界** と **durable workflow** を入れないと、次の 1 年で「もう一つの Spring Framework 風レガシー」になる。
>
> 一方で、**memory tier / synergy / proposal queue / audit hash chain** は competitive moat になる素養を持っており、これらを「自作維持」しつつ、commodity 領域 (workflow / policy / vector / embedding) は段階的に OSS に置換するのが正解。
>
> Phase 1 (即時): cost-ledger 実装、tool 階層化、dead code 除去、sampling 投入。
> Phase 2 (中期): Temporal、Embedding multiplexer、Reflection loop、Eval harness in CI。
> Phase 3 (長期): OPA、Event Sourcing、Replay UI、Vector DB pluggable、HA。

---

*Reviewed by: Senior Architect (AI Runtime / MCP / RAG / Multi-Agent / Self-Improving Systems)*
