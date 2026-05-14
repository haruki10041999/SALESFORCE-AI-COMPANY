# Persistent AI Runtime アーキテクチャレビュー

> 対象: `salesforce-ai-company`
> 観点: 「永続的 AI Runtime（Persistent AI Runtime）」としての評価
> レビュー日: 2026-05-13
> 形式: シニアアーキテクト視点・厳しめ・忖度なし

---

## 0. 調査サマリ（前提）

| 項目 | 計測値 |
|------|--------|
| `mcp/` 配下 TS ファイル数 | 548 |
| `mcp/handlers/` 配下 | 159（うち `register-*.ts` 22） |
| `mcp/core/` サブディレクトリ数 | 38 |
| `mcp/tools/` ファイル数 | 43 |
| `tests/` 配下 TS | 197 |
| Drizzle マイグレーション | 16 |
| `mcp/server.ts` 行数 | 892 |
| ドキュメント | 46 md |
| エージェント定義 | 18 md |
| 主要外部依存 | Temporal, pg-boss, Drizzle, pgvector, Qdrant, LanceDB, Awilix, Hono, OpenTelemetry, Prometheus, MCP SDK, LangChain (`core` / `community` / `ollama`), Ollama |
| Port 定義 | `llm-gateway` / `memory-service` / `workflow-engine` / `governance-gate` / `policy-engine` / `vector-store` / `event-store` / `cost-ledger-port` / `observability-port` / `outputs-port` / `critic` |
| Vector backend 同居 | pgvector + Qdrant + LanceDB（3 系統） |

---

## 1. 全体総評

このリポジトリは「単発 AI ツール」のスコープを完全に超えており、**Persistent AI Runtime を志向していること自体は明確**である。ports/composition-root/Awilix による DI、Temporal による durable workflow、pg-boss、OPA 風 policy engine、OpenTelemetry+Prometheus、A/B テスト・LinUCB・drift 検出・self-refine・eval harness 等、**ランタイムとして必要な役者は概ね揃っている**。

しかし全体としては **「揃えたが結合できていない」「層が宣言だけで実装が浅い箇所が多い」「コア概念が複数経路で表現されている」** 状態であり、現時点では「**Persistent AI Runtime のα版（プロトタイプ→ベータ移行期）**」と評価する。Production Persistent Runtime としては**まだ早い**。

特に以下が致命的観点である:

1. `mcp/server.ts` が 892 行の**起動オーケストレーション神オブジェクト**化している
2. `mcp/contexts/*`（DDD bounded context 風）が **`index.ts` だけのスケルトン**で、層として機能していない
3. **vector backend が 3 種類（pgvector / Qdrant / LanceDB）同居**しており、運用上の選択責務が runtime ではなくユーザに漏れている
4. `LlmGateway` Port の API が `chat({ topic, agents, persona, skills, turns ... })` と**オーケストレーション語彙**になっており、LLM 抽象として破綻している
5. `MemoryService` Port は `add/search/list/clear` の 4 メソッドだけで、**実際の階層・ベクタ・知識グラフは別経路**から触っている（=ports が偽装される）
6. handler 数 159・register-tool 22 系統は、**Tool 表面の認知負荷**として既に閾値を超えつつある
7. LangChain は `llm/langchain-*.ts` に局所化されているが、`@langchain/community` を取り込んだ瞬間に**推移依存の山**を抱える構造リスクが残る

「破綻はしていないが、これ以上機能を足す前にコア層の統合と削減（**負の機能追加**）が必須」というのが結論である。

---

## 2. 現在の成熟度レベル

| 項目 | レベル(0-5) | 根拠 |
|------|-----|------|
| 基本動作 | 4 | MCP server / DI / DB / Vector / Workflow が揃って起動する |
| Layering | 2.5 | core 層は分割されているが contexts は形骸化、server.ts に逆流 |
| Port-Adapter 抽象 | 2 | ports は宣言されるが実コードが直接 core 実装を import している箇所が多数想定 |
| Workflow durability | 3 | Temporal 統合・session-store・event-store・retry/replay 役者あり |
| Memory / RAG | 3 | hierarchical store / vector tier / KG / failure-memory まで実装あり、ただし統一 facade なし |
| Governance | 3.5 | OPA 風 policy / cost-ledger / approval / dangerous-actions / RBAC まで明示分離済 |
| Observability | 3.5 | OTEL+Prom+structured log+health+SLO burn 揃う |
| Self-Improvement | 3 | bandit / drift / eval-harness / self-refine 揃うが、ループ閉鎖は未検証 |
| Production Readiness | 2 | 単一プロセス前提・水平スケール前提の設計分離が不足 |
| OSS 活用戦略 | 2 | 自作と OSS が同列に並びすぎて、責務境界が崩れている |

**総合成熟度: Level 2.8 / 5（"Architected Prototype"）。**
"Production Persistent Runtime" には Level 4 が必要。差は大きい。

---

## 3. 強み（事実ベース）

1. **Ports & Adapters の宣言**: `core/ports/` に 11 個の Port があり、composition-root + Awilix で wiring されている。設計思想は正しい。
2. **Workflow durability の二段構え**: `WorkflowEngine` Port が `in-process | temporal` を抽象化し、`replay()` `signal()` `retry()` `completeStep()` まで備えている。これは **Persistent Runtime の中核として正しい形**。
3. **Memory tier の階層化**: `vector-tier.ts` / `memory-tier-policy.ts` / `hierarchical-store.ts` / `kg-reasoner.ts` / `failure-memory.ts` まで分離され、organizational memory 化の足場がある。
4. **Governance の本気度**: `opa-policy-engine.ts` / `policy-gate.ts` / `cost-budget.ts` / `cost-ledger-manager.ts` / `dangerous-actions.ts` / `audit-archiver.ts` / `governance-state-manager.ts` / `approval` 周りが揃っており、**enterprise 視点の必須役者がほぼ実装側に存在**。
5. **Audit hash chain & event store**: `0002_audit_log_hash_chain.sql` `event-store.ts` `postgres-event-store.ts` がある。改ざん検知 + replay の基盤として正しい。
6. **Observability スタック**: OTEL SDK + Prom + Jaeger + Grafana + dashboard generator + SLO burn tracker + PII redactor まで一通り。
7. **Reliability primitives**: `circuit-breaker` / `bulkhead` / `rate-limiter` / `leader-election` / `advisory-lock` / `unit-of-work` が core に存在する。Multi-instance 化の地固めとして良い。
8. **Self-Improvement のレシピ**: `bandit-orchestration-policy` / `lin-ucb-bandit` / `drift-detector` / `eval-harness` / `replay-ab` / `self-refine-loop` / `staged-adoption` / `policy-snapshot` が揃う。**思想的には self-improving runtime を満たしている**。
9. **DR / Compliance スクリプト**: `scripts/dr/*` `siem:export:audit` `dr-drill` 等が package.json に明示。enterprise 化への意志が見える。
10. **Tenant scope 配慮**: `migrate-tenant-scope.ts` / `tenant-quota-windows` / `postgres-tenant-context.ts`。多テナント化への布石はある。

---

## 4. 弱み（厳しめ）

1. **`mcp/server.ts` 神化**: 892 行で governance / orchestration / memory / workflow / temporal worker / observability / preset / history / leader-election をすべて束ねている。**Persistent Runtime において単一プロセス起動シーケンスがビジネスロジックと混ざるのは構造破綻の前兆**。
2. **`mcp/contexts/*` がスケルトンのまま**: `orchestration` `memory` `governance` `learning` `observability` `cost` `identity` `resource` の各 context が `index.ts` 1 ファイルのみ。DDD レイアウトを宣言したが**中身が core に流出**している。**設計の嘘**である。
3. **Ports の語彙汚染**: 
   - `LlmGateway.chat({ topic, agents, persona, skills, turns })` は LLM ではなく **multi-agent orchestrator の入力**。LLM ports に「agents/persona/skills」が現れている時点で**抽象が崩壊**。
   - `MemoryService` は `add/search/list/clear` の 4 メソッドのみ。実際の階層・ベクタ・KG は別 API。**Ports が「便宜上の存在」に成り下がっている**。
4. **Vector backend 三重化**: `lancedb-vector-store.ts` + `qdrant-vector-store.ts` + `pgvector` の 3 経路。これは「選択肢を残す」ではなく**完成していない決断**。3 経路を維持するコストは ML 周りの保守 budget を簡単に溶かす。
5. **Tool 表面爆発**: `register-*.ts` が 22 系統、handlers 159 ファイル、tools 43 ファイル。ユーザ提示の available deferred tools にも 100 超の `mcp_salesforce-ai_*` が並ぶ。**MCP の発見性とユーザビリティが既に閾値超え**。Tool catalog のリファクタが急務。
6. **Workflow runtime mode が実質 dual**: `in-process` を多くの開発フローで使い、Temporal は profile として残る形。**dev/prod のセマンティクス差**が将来 replay/retry の互換性問題を生む。
7. **LangChain 三点採用**: `@langchain/core` `@langchain/community` `@langchain/ollama`。**`community` の取り込みは推移依存と semver 不安定さを runtime コアに伝染させる**。`ollama` 単体直接呼び出しで十分な場面で community を使っている懸念。
8. **Learning loop のループ閉鎖が未検証**: bandit/drift/eval が並ぶが、**「reward → policy update → snapshot → deploy → next reward」が一本線で通っている根拠**が docs 上見つけにくい。**部品はあるがループが閉じていない可能性が高い**。
9. **Multi-tenant の半端さ**: `quota` `tenant-context` はあるが、ports（特に memory/vector）に `tenantId` が **第一級**で乗っていない。あとから tenantId 追加は地獄の改修になる。
10. **テスト 197 vs プロダクション 548**: テスト比率は健全に見えるが、**replay / chaos / multi-instance / governance violation 系の e2e が薄い**可能性が高い（要監査）。

---

## 5. アーキテクチャ上の危険箇所（優先度付き）

| 優先度 | 箇所 | 危険度 | 内容 |
|--------|------|--------|------|
| P0 | `mcp/server.ts` 892 行 | 致命 | composition と起動 orchestration が肥大、変更影響が runtime 全体に波及 |
| P0 | `LlmGateway` Port の語彙 | 致命 | LLM 抽象に orchestration 概念が混入。下層交換不能 |
| P0 | Vector 3 backend 同居 | 高 | 運用判断が runtime 外（=ユーザ）に漏出。データ整合性の単一点不在 |
| P1 | `contexts/*` の空殻 | 高 | 命名通りの bounded context が機能せず、core が肥大 |
| P1 | Tool 表面 100+ | 高 | 認知負荷・命名衝突・governance の policy gate 抜け穴の温床 |
| P1 | Multi-tenant が後付け | 高 | ports に tenantId 第一級なし。後から差し込みは破壊的 |
| P1 | Learning ループ閉鎖未確証 | 高 | self-improvement を謳っているのに reward → policy のフローが文書化不足 |
| P2 | LangChain `community` 取り込み | 中 | 推移依存が runtime コアの semver 安定性を毀損 |
| P2 | dev=in-process / prod=temporal | 中 | replay/durability の挙動差が後で噛む |
| P2 | `MemoryService` Port が浅い | 中 | 実利用は別経路で抽象が偽装。port 信頼性が下がる |

---

## 6. 技術的負債（具体）

1. **DDD layout の偽装**: `contexts/*` がスケルトン → 「設計したフリ」の負債。**いま削除するか、いま中身を移すか**の二択。中途半端維持は最悪。
2. **同名概念の重複**: `core/memory` `contexts/memory` `memory/`（ルート）。3 経路に同じ概念が散らばる。
3. **register-\*.ts 22 系統**: tool registration の重複ボイラープレートと、`governed-tool-registrar` `auto-init` `tool-registry` の 3 軸が同居。
4. **server.ts 内 import 100 超**: 単一ファイルからの循環依存・遅延 init の温床。
5. **vector adapter API の揺れ**: `vector-store.ts` `vector-store-adapter.ts` `lancedb-vector-store.ts` `qdrant-vector-store.ts` `core/memory/vector-tier.ts` が並ぶが**唯一の port が小さく、抽象漏れ**が発生中。
6. **`langchain-llm.ts` `langchain-embedding.ts`**: 用途上 LangChain を本当に必要とするか不明。直接呼び出しで十分なら**負債候補**。
7. **scripts/ の肥大**: 50+ スクリプトが package.json に並ぶ。CLI 統一 (`sf-ai`) に集約途中の中間状態。
8. **i18n と PII redactor が core に同居**: cross-cutting concern が core 直下にある（共通基盤層が分離されていない）。

---

## 7. 不足している重要コンポーネント

1. **Agent Identity & Capability Registry**: 18 agents が md だが、runtime 内で「capability schema → tool 利用権限 → governance policy」が**型として閉じていない**。
2. **Tenant-aware ports**: `tenantId: TenantId` を全 port の第一引数に持つ規約が欠落。
3. **Outbox / Inbox パターン**: event-store はあるが、**外部副作用 (Salesforce deploy, SIEM export, MCP tool call) の outbox** が pg-boss に統合された明確な口がない。
4. **Saga / Compensation**: Temporal はあるが、**ビジネス上の補償アクション（rollback の宣言的記述）**が見当たらない。
5. **Schema registry for events**: `event-store` の payload 形状を中央で管理する schema registry なし。
6. **Replay determinism contract**: replay-reader はあるが、**「決定論的に再現できる範囲」の明示契約**がない。LLM 含む replay は本質的に非決定的。
7. **Cost-aware routing**: cost-ledger はあるが、**「次の決定に cost を反映する router」**（model-arbitration はあるが、エンドツーエンドのフィードバックが弱い）。
8. **Eval gating in CI**: `eval:ci` は存在するが、**メトリクス回帰での自動ブロック契約**が docs 上明示されていない。
9. **Vector lifecycle manager**: 階層は宣言されているが、**hot→warm→cold の自動 demotion スケジューラ**の実体が薄い。
10. **Knowledge graph の更新ガバナンス**: `knowledge-graph.ts` あるが、**矛盾検出・出典管理・confidence decay** の仕組みが見えない。

---

## 8. 今後追加すべき機能（runtime 価値順）

1. **Tenant-first Port refactor**（P0）
2. **Tool Catalog 圧縮 & 階層化（surface API の v2）**（P0）
3. **Replay determinism contract + LLM seed/cache**（P1）
4. **Saga DSL（compensation 宣言）on Temporal**（P1）
5. **Outbox via pg-boss / event-store**（P1）
6. **Vector lifecycle scheduler（demotion / TTL / re-embed）**（P1）
7. **Schema registry + event versioning**（P1）
8. **Drift → policy snapshot → A/B → promotion の自動 promotion DAG**（P2）
9. **Capability schema for agents + governance binding**（P2）
10. **Cost-aware model router の port 化**（P2）

---

## 9. 優先的に修正すべき箇所（実装順）

1. **`mcp/server.ts` 解体**: 起動シーケンスを `surface/bootstrap-*.ts` 群に分解。`server.ts` は 200 行以下を目指す。
2. **`LlmGateway` Port を 2 つに分割**:
   - `LlmCompletionPort` (`generate(prompt, params)`) — 純粋な LLM 抽象
   - `AgentChatService`（core 内の高位サービス）— 現行 `chat(...)` を移管
3. **`contexts/*` を「実装する or 削除する」決断**: 中途半端解消。推奨は **段階的に core から context へ移管し、最終的に core/* は primitives のみ**に。
4. **Vector backend の決断**: 既定を `pgvector`（運用最小）+ scale-out 必要時のみ `qdrant` に absent-by-default。LanceDB は **明示的に dev-only or 削除**。
5. **`MemoryService` Port を再設計**:
   - `MemoryReader` / `MemoryWriter` / `HierarchicalSearchPort` / `KnowledgeGraphPort` に分割
   - 実利用は port 経由のみとする lint ルール追加
6. **Tool registry の v2**: `category > capability > tool` の 3 階層化、命名規約、deprecation 機構。
7. **`tenantId` を全 port の第一引数化**（破壊的だが**早ければ早いほど安い**）。
8. **LangChain `community` 切り離し**: `community` だけは依存削除を試みる（ollama / embedding は薄い直叩きで代替）。
9. **Workflow mode を `temporal-only`（dev では `temporal-lite`/embedded）** に揃える方針へ。
10. **Replay の決定論契約 doc + LLM cache layer の port**。

---

## 10. 推奨アーキテクチャ改善案

### 10.1 推奨レイヤリング（4 層 + cross-cutting）

```
+----------------------------------------------------------+
|  surface/      MCP transport, HTTP, CLI, registration    |
+----------------------------------------------------------+
|  application/  Use-cases, agent services, orchestration  |
|                services, policies-as-code use            |
+----------------------------------------------------------+
|  domain/       Pure types: Agent, Tool, Memory, Trace,   |
|                Workflow, Tenant, Cost, Policy            |
+----------------------------------------------------------+
|  infrastructure/  Adapters: Postgres, pgvector, Qdrant,  |
|                Temporal, pg-boss, Ollama, OTEL, OPA      |
+----------------------------------------------------------+
|  cross-cutting:  logging, i18n, PII, security, errors    |
+----------------------------------------------------------+
```

`mcp/core/` は今 38 サブディレクトリある。**domain と infrastructure と application が混在**している。これを 4 層に強制分離。

### 10.2 Port 再設計（11 → 整理後）

| Port | 役割 |
|------|------|
| `LlmCompletionPort` | LLM 単発呼び出し（純粋） |
| `EmbeddingPort` | embedding 生成（純粋） |
| `VectorStorePort` | tenant-aware CRUD + ANN |
| `HierarchicalMemoryPort` | document/section/chunk + tier |
| `KnowledgeGraphPort` | node/edge + provenance + confidence |
| `WorkflowEnginePort` | start/signal/retry/replay/query (現行近い) |
| `EventStorePort` | append/read/snapshot |
| `OutboxPort` | reliable side-effect dispatch |
| `PolicyEnginePort` | OPA decisions |
| `GovernanceGatePort` | high-level approval workflow |
| `CostLedgerPort` | spend record + budget query |
| `ObservabilityPort` | trace/metric/log facade |
| `SecretsPort` | secret resolution |
| `OutputsPort` | artifact write/read |

→ 14 port まで増えるが**分離の意味のある 14**。

### 10.3 Cross-cutting

- すべての Port メソッドに `RequestContext { tenantId, traceId, actorId, sessionId }` を必須引数化。
- `core/runtime/index.ts` は実質空 → ここに `RequestContext` 伝播 (AsyncLocalStorage) を集約させる。

---

## 11. Runtime 進化の次ステップ（フェーズ別）

| Phase | 期間目安 | ゴール |
|-------|---------|--------|
| **P1: 整流期** | 直近 | server.ts 分解 / Port 再設計 / contexts 整理 / vector backend 決断 / Tool catalog v2 |
| **P2: Tenant First** | 続けて | 全 port に tenantId / quota の port 化 / multi-tenant e2e テスト |
| **P3: Durable Loop** | その後 | Temporal-only / Saga DSL / Outbox / Replay 決定論契約 |
| **P4: Self-Improvement Closure** | 続けて | drift→snapshot→A/B→promotion を 1 本の DAG で自動化、CI eval gating |
| **P5: Org Memory** | 続けて | KG provenance + decay / hierarchical lifecycle scheduler / failure precedent retrieval |
| **P6: Enterprise** | 続けて | OPA bundle 配信 / SIEM 完全双方向 / DR runbook 自動化 / FedRAMP-like control mapping |

---

## 12. Enterprise 運用に必要な追加要素

1. **OPA bundle 配信 + signed policy**（現状: in-tree policy）
2. **KMS 統合 + envelope encryption for memory**（現状: at-rest-crypto あるが KMS 抽象未確認）
3. **SAML / OIDC actor identity**（actors.ts はあるが IdP 統合の記述薄）
4. **Per-tenant quota & rate limit + isolation**
5. **Audit log の immutable storage（WORM 相当）or external SIEM mandatory**
6. **DR drill の Chaos 試験スケジューラ**
7. **Policy change の peer review + signed approval**
8. **SBOM 生成（CycloneDX）+ supply-chain scan の CI 強制**
9. **Data residency / encryption-at-rest per tenant**
10. **Observability の long-term cold storage（Tempo + S3）**

---

## 13. 将来的なスケーラビリティ評価

| 軸 | 現状の限界（推定） | 必要な改修 |
|----|----------|-----------|
| Concurrent agents/session | 数十程度（in-process workflow）| Temporal-only + worker pool 分離 |
| Tenants | 単一 ~ 数 tenant | port tenantId 化 + schema-per-tenant or RLS |
| Vector size | pgvector で ~数百万 chunk | Qdrant への自動移行 + tier scheduler |
| Throughput | 単一プロセスがボトルネック | surface/MCP と worker を分離プロセス化 |
| Tool count | 既に >100 で発見性低下 | Tool catalog v2 + capability schema |
| Trace volume | OTLP exporter のサンプリング設計次第 | tail-based sampling, 長期 cold ストレージ |
| Memory growth | hierarchical/KG の demotion 未自動化 | lifecycle scheduler + cost-aware compaction |

→ **100+ persistent agent / 組織知識管理 / 長時間 workflow / 自律改善ループ / enterprise governance / deployment automation** の同時達成は、**現アーキでは Temporal の活用と Port の tenant 化を行わない限り Phase 1 で必ず破綻**する。

---

## 14. AI Runtime 完成度スコア

| カテゴリ | スコア (0-100) |
|----------|------|
| Architecture | 60 |
| Runtime Core | 62 |
| Memory / RAG | 60 |
| Governance | 70 |
| Observability | 70 |
| Self-Improvement | 55 |
| Infrastructure | 70 |
| MCP / DX | 50 |
| Production Readiness | 45 |
| OSS Strategy | 45 |
| **総合** | **58 / 100** |

**判定: "Architected Prototype" → "Beta Persistent Runtime" 移行直前。Production には -25pt 不足。**

---

## 15. OSS 導入優先順位

### 15.1 今すぐ導入すべき OSS（P0）

| OSS | 目的 | 理由 |
|-----|------|------|
| **OPA**（または OpenFGA） | policy 配信 + bundle 検証 | 自作 `opa-policy-engine.ts` の限界、署名つき bundle 必要 |
| **Temporal**（既導入を**主たる**ものに昇格） | workflow durability | dual-mode を解消し runtime 中核へ |
| **pg-boss**（既導入を outbox に正式利用） | reliable side-effect | event-store と連携した outbox を作るベース |
| **OpenTelemetry Collector**（既: SDK のみ）| trace/metrics 集約 | exporter 直結ではなく collector 経由を強制 |

### 15.2 後から導入すべき OSS（P1〜P2）

| OSS | 目的 |
|-----|------|
| **Cedar**（or OpenFGA） | fine-grained authorization for multi-tenant |
| **Qdrant** を **正式な** scale-out vector に昇格（LanceDB は撤去） | vector scale |
| **Vespa or Weaviate** | 大規模 KG + vector の hybrid retrieval（必要時） |
| **Helm + Argo CD** | k8s デプロイの宣言化 |
| **Tempo / Loki / Mimir** | OTEL の long-term backend |
| **Conftest** | OPA policy の CI 検証 |
| **Grype / Syft** | SBOM + 脆弱性 |
| **Sigstore (cosign)** | policy bundle / artifact 署名 |
| **Schema Registry**（自作 or `@bufbuild`） | event schema |

### 15.3 今は不要 / 撤退検討すべき OSS

| OSS | 理由 |
|-----|------|
| **`@langchain/community`** | 推移依存が大きすぎ、現状利用は薄い。撤去候補 |
| **LanceDB** | pgvector と Qdrant がいる。3 系統維持は負債 |
| **LangChain 全般**（`@langchain/core` 含む再評価） | LLM/embedding 直叩きと OpenAI/Ollama SDK で十分なケースが多い。**コア runtime に LangChain 抽象を残すと将来の lock-in 源**になる |
| **i18next** をコア層に置く設計 | surface 層に移すべき |

### 15.4 自作維持すべき領域（差別化要因）

| 領域 | 理由 |
|------|------|
| **Agent orchestration / DAG / pseudo-hooks** | 製品の中核ロジック。OSS（LangGraph, CrewAI 等）に寄せると差別化が消える |
| **Governance approval workflow / dangerous-action 判定** | 業務ドメインに密接。政策変更の鋭さで差がつく |
| **Failure memory / governance precedent retrieval** | 組織記憶という差別化資産 |
| **Self-Improvement loop（bandit/drift/eval/snapshot/promotion）** | runtime の競争優位の核 |
| **Salesforce 特化 analyzer 群（apex/lwc/permission/flow）** | ドメイン優位 |

---

## 16. 推奨 dependency boundary（依存方向の規約）

```
surface  →  application  →  domain
                         ↘  ports
infrastructure  →  ports  (実装方向)
cross-cutting  ↺  全層から利用可、ただし domain は cross-cutting に依存しない
```

- `domain` は外部 OSS に **一切依存禁止**（zod だけ許容）
- `application` は `domain` と `ports` のみに依存
- `infrastructure` は `ports` を実装。`domain` 型を返す
- `surface` は `application` と DI 経由でのみ通信
- LangChain / Temporal / pg / OTEL は **infrastructure に閉じる**（現状はここが破られている）

dependency-cruiser ルールで強制すること（現存する `lint:depcruise` を**この境界**に合わせて再構成）。

---

## 17. 推奨 interface 一覧（追加 / 改修）

```ts
interface RequestContext {
  tenantId: TenantId;
  actorId: ActorId;
  sessionId?: SessionId;
  traceId: TraceId;
  reasonCode?: string;
}

interface LlmCompletionPort {
  complete(ctx: RequestContext, req: CompletionRequest): Promise<CompletionResult>;
  stream?(ctx: RequestContext, req: CompletionRequest): AsyncIterable<CompletionChunk>;
}

interface EmbeddingPort {
  embed(ctx: RequestContext, texts: string[], opts?: EmbedOptions): Promise<number[][]>;
}

interface VectorStorePort {
  upsert(ctx: RequestContext, items: VectorItem[]): Promise<void>;
  search(ctx: RequestContext, q: VectorQuery): Promise<VectorHit[]>;
  delete(ctx: RequestContext, ids: string[]): Promise<void>;
}

interface HierarchicalMemoryPort { /* document/section/chunk + tier */ }
interface KnowledgeGraphPort { /* nodes/edges/provenance/confidence */ }
interface OutboxPort { enqueue(ctx, msg): Promise<void>; }
interface SagaCoordinatorPort { /* compensation declarations */ }
interface PolicyEnginePort { evaluate(ctx, input): Promise<PolicyDecision>; }
interface CostLedgerPort { record(ctx, e): Promise<void>; spent(ctx, window): Promise<Cost>; }
interface ReplayReaderPort { stream(ctx, sessionId): AsyncIterable<Event>; }
```

すべて `RequestContext` を第一引数化することが**最重要規約**。

---

## 18. Abstraction layer 設計案（要点）

1. **Domain types are frozen**: `Agent`, `Skill`, `Tool`, `Capability`, `Policy`, `Memory*`, `Trace`, `Workflow`, `Tenant`, `Cost`。これらは外部 OSS の型を**漏らさない**。
2. **Ports**: 14 個に再構成（§17）。
3. **Adapters**: 1 port = N adapter。`vector-store: pgvector|qdrant|lancedb`, `llm: ollama|openai|anthropic`, `policy: opa|cedar|inline`, `workflow: temporal|in-process`。
4. **Registry**: adapter は capability bit を申告し、composition-root が tenant policy に応じて選択する（**選択責務を runtime 内に閉じる**）。
5. **Capability binding**: agent のスキルが「使える tool」「触れる memory tier」「呼べる LLM tier」「使える budget」を**型で**閉じる。
6. **Replay contract**: 副作用は outbox 経由のみ。Replay 時は outbox 抑止モードに入る。LLM 呼び出しは LLM cache port にキャッシュキーで再現。

---

## 19. Runtime complexity 増加リスク

- 現在の complexity score（主観）: **中の上**。追加機能で容易に**高**へ。
- 増加要因 TOP 5:
  1. Tool 表面の追加（毎週増えれば 1 年で 200+）
  2. Vector backend 維持コスト
  3. LangChain 推移依存
  4. Workflow dual-mode のセマンティクス差
  5. contexts/core 二重化
- 抑制案: **「機能追加 1 つにつき surface API 1 つ削除」ルールを入れる**（負の機能追加）。

---

## 20. Lock-in リスク分析

| 対象 | リスク | 軽減策 |
|------|--------|--------|
| **LangChain** | 高（API 不安定 + 依存爆発） | core から消す。infrastructure 局所化 or 撤去 |
| **Temporal** | 中（API stable だが運用コスト高） | port 越しの利用を厳守。`replay()` セマンティクスを domain で定義 |
| **Ollama** | 中（モデル管理が独自） | LlmCompletionPort で隔離 |
| **pgvector** | 低（Postgres native） | port 越しなら問題なし |
| **Qdrant** | 中 | port 越し前提 |
| **OPA** | 低 | bundle で外部化、Cedar 移行も port で隔離可能 |
| **MCP SDK** | 中 | surface 層に閉じる。application 層に MCP 型を漏らさない |
| **OpenTelemetry** | 低 | facade 経由 |

**最大のリスクは LangChain と vector backend**。

---

## 21. 「今すぐ導入すべき OSS」まとめ

1. OPA（policy bundle 化）
2. Temporal（dev/prod 統一）
3. pg-boss（既導入を outbox に正規化）
4. OTel Collector（直結廃止）
5. Conftest（policy CI）

## 22. 「後から導入すべき OSS」

1. Cedar / OpenFGA
2. Qdrant 昇格
3. Tempo / Loki / Mimir
4. Argo CD / Helm
5. Sigstore (cosign)
6. Syft / Grype（SBOM）
7. Schema Registry
8. Vespa or Weaviate（規模が出たら）

## 23. 「今は不要な OSS」

1. `@langchain/community`（撤去推奨）
2. LanceDB（撤去 or dev-only）
3. CrewAI / AutoGen / LangGraph 等の上位エージェント FW（自作の差別化を消す）
4. Pinecone（pgvector + Qdrant で十分）
5. LiteLLM（必要になったら検討）

## 24. 「自作維持すべき領域」

1. Agent orchestration / DAG / pseudo-hooks
2. Governance approval & dangerous action policy
3. Failure memory / governance precedent retrieval
4. Self-Improvement loop（bandit/drift/eval/snapshot/promotion）
5. Salesforce ドメイン解析（apex/lwc/permission/flow）
6. Replay 契約 + 決定論ルール

---

## 25. Runtime が破綻するシナリオ（優先順 = 起こりやすさ）

| # | シナリオ | 引き金 | 影響 | 最初に壊れる箇所 |
|---|----------|-------|------|----------------|
| 1 | **Tool 表面爆発** | tool 数が >150 を超え、policy gate が漏れる | governance 信頼性消失、誤呼び出し | Tool catalog / governance binding |
| 2 | **Multi-tenant 後付け破綻** | 大口顧客の要望で tenant 分離を後から入れる | 全 port 改修、データ移行不能 | Memory / Vector / Audit |
| 3 | **Vector 三重化の運用崩壊** | LanceDB / Qdrant / pgvector の整合性問題 | 検索結果の劣化、retrieval 信頼性消失 | Hierarchical store / KG |
| 4 | **LangChain 破壊的更新** | community の semver 不安定 | runtime ビルド不能 / 推論経路停止 | llm/embedding adapter |
| 5 | **Workflow dual-mode の replay 不一致** | dev=in-process で書いた workflow が prod=temporal で再現せず | インシデント対応不能 | replay-reader / workflow-engine |
| 6 | **Trace explosion** | サンプリング設計なしで 100 agent 同時稼働 | ストレージコスト爆発、Jaeger / Tempo 詰まり | observability |
| 7 | **Drift → Promotion の手作業残置** | learning loop が閉じず、policy が腐る | Self-improvement の停滞、品質劣化 | learning orchestrator |
| 8 | **server.ts 起動順依存爆発** | 新機能初期化が起動順に依存 | デプロイ不能 | mcp/server.ts |
| 9 | **KG 矛盾蓄積** | provenance/confidence なしに事実が増える | retrieval 品質低下、ハルシネーション増加 | knowledge-graph |
| 10 | **Audit/Event growth** | partition 設計（既存 0016）がテナント爆発に追従できず | 監査リテンション破綻、コンプラ違反 | audit / event-store |

**最初に破綻する可能性が高い順 TOP3**:
1. **Tool 表面爆発 + governance 抜け**
2. **Multi-tenant 後付け**
3. **Vector backend 三重化の整合性**

---

## 26. 「自作 vs OSS」のメタ判断

| 領域 | 結論 | 理由 |
|------|------|------|
| LLM 呼び出し | OSS（直叩き or 軽量 SDK） | commodity 化済み。LangChain 抽象は重い |
| Embedding | OSS 直叩き | commodity |
| Vector store | OSS（pgvector + Qdrant） | commodity |
| Workflow durability | OSS（Temporal） | 自作不可能領域 |
| Policy engine | OSS（OPA / Cedar） | 標準化が進む。自作は損失 |
| Tracing/Metrics | OSS（OTEL） | 標準 |
| **Agent orchestration** | **自作維持** | 差別化資産。FW 化すると個性喪失 |
| **Governance workflow** | **自作維持** | 業務ドメイン密着 |
| **Self-Improvement loop** | **自作維持** | 競争優位の核心 |
| **Failure / org memory** | **自作維持** | データ資産化 |

判断軸: 「commodity → OSS、差別化資産 → 自作」**徹底**。

---

## 27. 100+ agent / 組織知識 / 長時間 workflow / 自律改善 / enterprise governance / deployment automation を扱う場合のボトルネック

1. **Workflow worker pool の単一化** → Temporal worker を agent capability ごとに分離プロセス化必要
2. **Memory growth 制御** → vector lifecycle scheduler 必須
3. **KG 矛盾検知** → confidence/decay/provenance を型で保有
4. **Tool gate の P95 latency** → policy decision のキャッシュ層
5. **Audit storage** → tenant + 月単位 partition + cold export
6. **Tracing tail-based sampling** → collector で必須
7. **Promotion DAG の失敗モード** → drift→A/B→promotion を自動化しないと改善が止まる
8. **Deployment automation** → policy bundle の段階配布 + canary
9. **Observability long-term** → Tempo/Loki/Mimir + S3 cold
10. **MCP surface の versioning** → tool deprecation ポリシーが必須

---

## 28. 結論

- このリポジトリは **「Persistent AI Runtime を志向する野心的な設計」と「層の偽装・抽象の漏れ・OSS 同居の未決断」が共存**している。
- 機能カバレッジは強い（OSS の山と自作の山の両方）。**だが、構造の単純化を 1 サイクル経由しない限り、本番 enterprise 運用には到達しない**。
- 優先課題は明確: **(A) server.ts 解体 / (B) Port 再設計 (Llm 二分割 + Memory 多分割 + tenantId 第一級) / (C) Vector backend 一本化 + Qdrant 二段目 / (D) Tool catalog v2 / (E) LangChain `community` 撤去**。この 5 つを終えれば**Beta Persistent Runtime に到達**する。
- **「過剰設計」**: contexts/* スケルトン、Ports に対する偽装的実装、3 vector backend、register-* 22 系統。
- **「将来負債化箇所」**: LangChain `community`、in-process workflow、tool 表面、KG 矛盾、tenantId 後付け。

> **次の 1 アクション提案**: `mcp/server.ts` の責務分解と `LlmGateway` Port の二分割を**同一 PR**で行う。これが他のすべての改善の前提条件である。

---

_End of review._
