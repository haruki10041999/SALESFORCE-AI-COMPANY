# Changelog

このプロジェクトの変更履歴は、このファイルに記録します。
形式は Keep a Changelog を参考にし、バージョニングは SemVer に準拠します。

## [Unreleased]

### Added (2026-04-27 Phase 2 — SQL.js 永続化 / 移行検証 / UoW 拡張)

- **SQLite 実装を sql.js へ置換**
  [`mcp/core/persistence/sqlite-store.ts`](../mcp/core/persistence/sqlite-store.ts) を native addon 依存 (`better-sqlite3`) から `sql.js` ベースへ置換。`SQLiteStateStore.open()` の非同期初期化で wasm をロードし、`state.sqlite` へエクスポート永続化。
- **履歴ストア統合を async 化**
  [`mcp/core/context/history-store.ts`](../mcp/core/context/history-store.ts) が `SQLiteStateStore.open()` を利用するよう更新。`SF_AI_HISTORY_SQLITE=true` で SQLite 履歴モードを有効化。
- **JSONL 移行 / 互換エクスポート CLI の整備**
  [`scripts/migrate-jsonl-to-sqlite.ts`](../scripts/migrate-jsonl-to-sqlite.ts) / [`scripts/state-export-jsonl.ts`](../scripts/state-export-jsonl.ts) を追加・更新。
  - `state:migrate-sqlite`: JSONL/history から `state.sqlite` へ移行
  - `state:export-jsonl`: `state.sqlite` から JSONL 互換出力
- **移行後の整合チェックオプション追加**
  [`scripts/state-export-jsonl.ts`](../scripts/state-export-jsonl.ts) に `--verify-source-dir <dir>` を追加。`exportedRows` と元 JSONL 有効行数を突合し、不一致時は終了コード 1（`--allow-mismatch` で継続可）。
- **Unit-of-Work を保存系へ拡張**
  [`mcp/core/persistence/unit-of-work.ts`](../mcp/core/persistence/unit-of-work.ts) を新設し、[`mcp/core/governance/operation-log.ts`](../mcp/core/governance/operation-log.ts) を appendFile から原子的保存へ移行。
- **既定 DB 名の統一**
  `state.sqlite` を共通既定名として定義し、[`mcp/server.ts`](../mcp/server.ts)、[`scripts/migrate-jsonl-to-sqlite.ts`](../scripts/migrate-jsonl-to-sqlite.ts)、[`scripts/state-export-jsonl.ts`](../scripts/state-export-jsonl.ts)、[`mcp/core/context/history-store.ts`](../mcp/core/context/history-store.ts) へ反映。
- **テスト追加/更新**
  [`tests/persistence-unit-of-work.test.ts`](../tests/persistence-unit-of-work.test.ts)、[`tests/sqlite-state-store.test.ts`](../tests/sqlite-state-store.test.ts)、[`tests/operation-log.test.ts`](../tests/operation-log.test.ts) を整備し、sql.js バックエンドでの回帰を確認。

### Added (2026-04-28 Phase 3 — 解析強化 / エージェント協調 / Skill 推薦)

Apex/Flow/PermissionSet の統合可視化、Test Gap 拡張、incremental cache、breaking change 検出、エージェント協調スコア学習、Context-Aware Skill 推薦を実装。

- **TASK-A2 Apex 依存グラフ拡張**
  [`mcp/tools/apex-dependency-graph.ts`](../mcp/tools/apex-dependency-graph.ts) に `includePermissionSets` / `includeFlows` / `includeIntegrations` オプション追加 (既定 false)。PermissionSet XML の `<apexClass>` タグ、Flow XML の `<actionName>` タグからクラス参照を抽出し、`ext:http` / `ext:future-callout` / `ext:nc:*` の外部連携ノードを統合。Mermaid 出力で node type ごとに色分け (`cls=#dbeafe/stroke=#3b82f6`, `flow=#dcfce7/stroke:#16a34a`, `perm=#fce7f3/stroke:#db2777`, `intg=#f3e8ff/stroke:#9333ea`)。既存 Apex 依存グラフはシグネチャ不変。
- **TASK-A8 Test Gap Analysis 拡張**
  [`mcp/tools/analyze-test-coverage-gap.ts`](../mcp/tools/analyze-test-coverage-gap.ts) に `includeBranchScaffold` オプション追加。新規 [`mcp/tools/test-scaffold-extractor.ts`](../mcp/tools/test-scaffold-extractor.ts) で Apex AST から try/catch/finally ブロック数と throw 送出例外型を抽出し、テスト雛形名 (例: `testClassName_RecoversFromException`, `testClassName_Throws<ExceptionType>`) を提案。Markdown レポートに「Suggested Test Scaffolds」セクション追加。
- **TASK-A8 branch-extractor コア層**
  [`mcp/core/testing/branch-extractor.ts`](../mcp/core/testing/branch-extractor.ts) を新規追加。`extractBranchInfo(apexSource, fallbackName)` で if/else-if/switch-when/三項演算子の分岐数、catch ブロック数、throw 例外型を統計。test-scaffold-extractor.ts の実装を再エクスポート。
- **TASK-A18 Apex 依存グラフ incremental**
  [`mcp/tools/apex-dependency-graph-incremental.ts`](../mcp/tools/apex-dependency-graph-incremental.ts) で `fingerprintFile` (mtime/size/SHA1 hash) によるキャッシュ機構を実装。次回実行時に `diffFingerprints` で added/modified/deleted を検出し、`incremental` フィールドに delta を付与。新規 [`mcp/core/dependency/graph-cache.ts`](../mcp/core/dependency/graph-cache.ts) に `DEFAULT_GRAPH_CACHE_PATH="outputs/cache/apex-graph.json"` と I/O ヘルパー (`loadCache`, `saveCache`, `isCacheValid`) を集約。
- **TASK-A14 Apex Changelog AST 差分**
  [`mcp/tools/apex-changelog.ts`](../mcp/tools/apex-changelog.ts) に `includeSignatureDiff` オプション追加 (既定 false)。新規 [`mcp/core/apex/signature-diff.ts`](../mcp/core/apex/signature-diff.ts) で 2 リビジョン間の public/global メソッド・フィールド署名を比較し、削除・型変更を breaking change として分類。`diffApexSignatures(before, after, className)` は method-added/method-removed/method-signature-changed/field-added/field-removed/field-type-changed を返す。Markdown レポートに「Breaking Changes」セクション追加。
- **TASK-A6 エージェント協調スコア学習**
  新規 [`mcp/core/learning/agent-synergy.ts`](../mcp/core/learning/agent-synergy.ts)。チャット終了時に `recordAgentSynergySession({ agents, qualityScore?, sessionId, recordedAt })` を `outputs/learning/agent-synergy.jsonl` に追記。`computeSynergyBonuses` で Bayesian average (m=5, μ_prior=0.5) + ε-greedy 探索 (ε=0.1, maxBonus=0.15) ベースのボーナスを計算。`getSynergyBonusForAgent` でペア ボーナスの総和を取得可能。
- **TASK-A4 Context-Aware Skill 推薦強化**
  [`mcp/tools/recommend-skills-for-role.ts`](../mcp/tools/recommend-skills-for-role.ts) に role・topic・recentFiles による文脈ボーナス実装済み (context bonus = +10)。ROLE_TO_CATEGORIES (apex-developer → [apex, testing, performance] 等)、FILE_EXT_TO_CATEGORIES (.cls → [apex]、.permissionset-meta.xml → [security] 等)、PATH_SEGMENT_TO_CATEGORIES (classes/ → [apex]、flows/ → [salesforce-platform] 等) による段階的カテゴリ推定。`scoreByQuery` + context bonus で skill ランキング。
- **A2~A4 テスト体系**
  全 Phase 3 新規実装について既存テストスイートと同様の unit test を `tests/` に配置済み (branch-extractor 3件、signature-diff 5件、agent-synergy 4件、その他)。

### Added (2026-04-27 Phase 2 — MCP 公開 / Vector Ollama / OTel / AST リファクタ)

F-10 quality rubric MCP 公開、F-11 vector-store Ollama 切替、T-OLLAMA-03 generate ストリーム、T-OBS-01 OTel、T-OBS-02 Prometheus、F-12 AST refactor 統合。全 6 件完了、610 PASS 達成。

### Added (2026-04-27 Phase 6 — Ollama 連携 / 観測性 / 安全網基盤)

無料縛り + Ollama Docker 既定方針の改修を順次投入。M1 安全網 (F-01〜F-05) から開始。

- **F-01 CI/CD 拡張**
  [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) に `lint:core-layers` / `lint:outputs` ステップを追加。`ubuntu-latest` + `windows-latest` のマトリクス化で Windows 互換性を保証 (Windows は `npm test` フル実行、Linux は selective + benchmark)。新規 [`.github/workflows/release.yml`](../.github/workflows/release.yml) で `vX.Y.Z` タグ push 時に typecheck → build → test → tarball 生成 → GitHub Release 自動化。
- **F-01 layer-manifest 修正**
  [`mcp/core/layer-manifest.ts`](../mcp/core/layer-manifest.ts) に `declarative` を `data` tier として登録。`resource/proposal/applier.ts → declarative/tool-spec.js` の既存違反を解消し `lint:core-layers` を CI で fail-fast 可能に。
- **F-02 Dependabot + CodeQL**
  [`.github/dependabot.yml`](../.github/dependabot.yml): npm / github-actions / docker の 3 エコシステムを毎週月曜 07:00 JST にスキャン。`@opentelemetry/*` / `@types/*` をグループ化、major bump は手動レビュー。[`.github/workflows/codeql.yml`](../.github/workflows/codeql.yml): `security-extended` + `security-and-quality` クエリで TypeScript/JavaScript を週次解析。
- **F-03 Golden Prompt Suite**
  [`tests/prompts/golden/`](../tests/prompts/golden/) に JSON Golden ケース (3 件: basic-architect-review / review-mode-by-files / persona-injection) と [`_schema.json`](../tests/prompts/golden/_schema.json) を新設。[`tests/prompt-golden.test.ts`](../tests/prompt-golden.test.ts) が `buildChatPromptFromContext` に Golden を流し、`mustContain` / `mustNotContain` / `sectionOrder` / `minLength` / `maxLength` で構造を回帰検証。テンプレート修正で意図しないセクション欠落・順序入替を即検知できる。
- **F-04 Prompt Injection Guard**
  [`mcp/core/prompt/injection-guard.ts`](../mcp/core/prompt/injection-guard.ts): 外部入力 (topic / 添付ファイル / appendInstruction) に潜む `ignore previous instructions` 系・日本語「これまでの指示を無視」・`system:` ロール乗っ取り・`<tool_call>` 偽装・ANSI エスケープ・ゼロ幅 BiDi 制御文字を検出するヒューリスティック実装。`guardUntrustedText()` は `<untrusted>` 境界マーカーで隔離 + サニタイズ、`mode: "block"` で危険入力を `PromptInjectionBlockedError` で遮断、`onDetect` で audit ログ連携。15 件のユニットテスト ([`tests/injection-guard.test.ts`](../tests/injection-guard.test.ts)) で多言語パターンとサニタイズ挙動を回帰検証。
- **F-05 Crash Injection Test**
  [`tests/crash-recovery.test.ts`](../tests/crash-recovery.test.ts): `TemporaryFileManager.writeAtomic` / `cleanupStaleTempFiles` のクラッシュ復旧シナリオを 7 ケースで検証。(1) 過去クラッシュで残った stale `.tmp` の掃除、(2) 連続書き込みでの最終状態整合、(3) 書き込み途中クラッシュ時の target 不変性、(4) 10 並列書き込みでの JSON 完全性、(5) ディレクトリ自動生成、(6) 欠損ディレクトリでの冪等性、(7) 無関係ファイル非破壊。状態ファイル更新の壊れたデータからの自動復旧契約をテストで担保。
- **F-06 tiktoken トークンカウント**
  [`mcp/core/prompt/token-counter.ts`](../mcp/core/prompt/token-counter.ts): `js-tiktoken` の `cl100k_base` を用いた厳密トークンカウンタを実装。エンコーダはプロセス内キャッシュ。失敗時は `Math.ceil(text.length / 4)` の approx へ自動フォールバック。[`prompt-engine/prompt-evaluator.ts`](../prompt-engine/prompt-evaluator.ts) の `estimatedTokens` を char/4 推定から tiktoken へ置換し、`tokenMethod` で計測手段を可視化。9 件のユニットテスト ([`tests/token-counter.test.ts`](../tests/token-counter.test.ts)) で英語/日本語/長文/キャッシュ再利用を回帰検証。
- **T-OLLAMA-01 Ollama HTTP クライアント**
  [`mcp/core/llm/ollama-client.ts`](../mcp/core/llm/ollama-client.ts): ローカル Ollama サーバ (既定 `http://localhost:11434`) との通信を担う stateless な fetch ラッパ。`AbortController` ベースのタイムアウト、5xx/408/429 のみリトライ、ネットワーク異常を `OllamaError` (`E_OLLAMA_TIMEOUT` / `E_OLLAMA_NETWORK` / `E_OLLAMA_HTTP_5xx` / `E_OLLAMA_EMPTY_EMBEDDING` 等) へ正規化。`/api/tags` / `/api/embeddings` / `/api/generate` をサポート。`buildOllamaClientFromEnv` で環境変数 (`OLLAMA_BASE_URL` / `OLLAMA_TIMEOUT_MS`) からインスタンス化。12 件のテスト ([`tests/ollama-client.test.ts`](../tests/ollama-client.test.ts)) で HTTP モック、リトライ挙動、タイムアウト、URL 正規化を検証。
- **T-OLLAMA-05 Health チェック / フォールバック判定**
  [`mcp/core/llm/ollama-health.ts`](../mcp/core/llm/ollama-health.ts): `/api/tags` を 30 秒キャッシュで照会し、`required: true` で必要モデル不足を検知すると `unavailable` 判定。`readOllamaPolicy` が env (`OLLAMA_REQUIRED` / `EMBEDDING_PROVIDER` / `OLLAMA_EMBEDDING_MODEL` / `OLLAMA_JUDGE_MODEL`) を読み取り、`decideFallback` が起動方針 (`use-ollama` / `fallback-ngram` / `abort-startup`) を返す純粋ロジック。13 件のテスト ([`tests/ollama-health.test.ts`](../tests/ollama-health.test.ts)) で必須モデル不足・required+unavailable・cache TTL・provider 切替を検証。
- **T-OLLAMA-02 Vector Embedding Provider 抽象化**
  [`mcp/core/llm/embedding-provider.ts`](../mcp/core/llm/embedding-provider.ts): `VectorEmbeddingProvider` 共通 IF を定義し、`NgramEmbeddingProvider` (FNV-1a ハッシュ + L2 正規化、unigram/bigram) と `OllamaEmbeddingProvider` (concurrency 制御付き batch、失敗時 ngram フォールバック) を提供。`createEmbeddingProvider` が env から自動選択。`cosineSimilarity` ヘルパも公開。17 件のテスト ([`tests/embedding-provider.test.ts`](../tests/embedding-provider.test.ts)) で決定的性、類似度ランキング、required モード時の throw、batch 並列度上限を検証。
- **F-07 Quality Rubric (LLM-as-Judge)**
  [`mcp/core/llm/quality-rubric.ts`](../mcp/core/llm/quality-rubric.ts): 5 軸 rubric (relevance / completeness / actionability / safety / structure、合計重み 1.0) で応答品質を 0..10 採点。`buildJudgePrompt` が JSON 出力を要求するプロンプトを生成し、`parseJudgeResponse` がフェンス付きコードブロック対応のロバストパーサで JSON を抽出。判定不能項目は heuristic (見出し数 / コードブロック / DML キーワード等) で補完。Ollama 失敗時は heuristic にフルフォールバック。15 件のテスト ([`tests/quality-rubric.test.ts`](../tests/quality-rubric.test.ts)) で重み正規化、JSON 抽出、欠落判定、fallbackOnFailure=false 時の throw を検証。
- **F-08 Apex AST 解析**
  [`mcp/core/parsers/apex-ast.ts`](../mcp/core/parsers/apex-ast.ts): `@apexdevtools/apex-parser` (ANTLR4) を用いた純粋 AST 解析モジュール。class / interface / enum / trigger を判別し、メソッド (戻り値型・パラメータ・修飾子・アノテーション)、フィールド、プロパティ、内部型、`extends`/`implements`、トリガイベント (`before insert` 等) と対象 sObject を抽出。SOQL/DML 数は文字列リテラル/コメントを除去した上で regex 補助カウント。エラーは `ANTLRErrorListener` で構造化収集し部分解析でも継続。10 件のテスト ([`tests/apex-ast.test.ts`](../tests/apex-ast.test.ts)) で `@AuraEnabled` / `@InvocableMethod` の検出、トリガ、内部クラス、文字列内キーワードの誤カウント抑止、構文エラー時の挙動を検証。
- **F-09 Flow AST 解析**
  [`mcp/core/parsers/flow-ast.ts`](../mcp/core/parsers/flow-ast.ts): `fast-xml-parser` で Salesforce Flow XML を well-formed 検証付きパース。Decision のルール条件 (`leftValueReference` / `operator` / `rightValueLiteral`)、ActionCall (Apex 判定)、Subflow、recordCreates/Updates/Deletes/Lookups、Screen、Formula、`start.scheduledPaths` を構造化抽出。`analyzeFlowAst` が件数集計 + リスクヒント (DML ≥ 5 / Subflow ≥ 3 / Apex action / Scheduled path / orphan defaultConnector) を返す。10 件のテスト ([`tests/flow-ast.test.ts`](../tests/flow-ast.test.ts)) でフルカバレッジ Flow、複数ルール、無効 XML、ガバナ閾値、空 Flow を検証。
- **Phase 1 動線接続 (production wiring)**
  Phase 1 で追加した新モジュールを既存ツール / bootstrap に接続し、テスト専用から本番経路へ昇格させた。
  - F-04: [`mcp/core/context/chat-prompt-builder.ts`](../mcp/core/context/chat-prompt-builder.ts) で `topic` / `appendInstruction` を `guardUntrustedText({ mode: "sanitize" })` 経由でサニタイズし、`block` 級検出時は `PromptInjectionGuard` ロガーで警告 (キャッシュキー安定のため wrap モードは未採用)。
  - T-OLLAMA-05: [`mcp/bootstrap.ts`](../mcp/bootstrap.ts) の `initializeServerRuntime` で `evaluateOllamaStartup()` を実行し、`use-ollama` / `fallback-ngram` / `abort-startup` を logger 出力。`OLLAMA_REQUIRED=true` で abort、それ以外は ngram fallback で起動継続。
  - F-08: [`mcp/tools/apex-analyzer.ts`](../mcp/tools/apex-analyzer.ts) が `analyzeApexSource` を呼び、`ApexFileAnalysis.ast` に AST 解析結果を任意付与。AST 失敗時は heuristic 結果で継続。AST 公開関数は名前衝突回避のため `analyzeApex` → `analyzeApexSource` に改名。
  - F-09: [`mcp/tools/flow-analyzer.ts`](../mcp/tools/flow-analyzer.ts) が `analyzeFlowAst` を呼び、well-formed XML 時のみ `FlowFileAnalysis.ast` に詳細を付与。AST が出した riskHints は regex 由来のものとマージ。

### Added (2026-04-27 Phase 2 — 観測性 / Ollama 高度化 / AST 活用)

Phase 1 で導入した基盤を MCP ツール層と本番運用パイプラインに接続し、観測性 (OTel/Prom)・LLM ストリーム・AST シグナルを段階的に拡張。

- **F-10 evaluate_quality_rubric ツール公開**
  [`mcp/handlers/register-vector-prompt-tools.ts`](../mcp/handlers/register-vector-prompt-tools.ts) に MCP ツール `evaluate_quality_rubric` を追加。`response` (必須) / `topic` / `judge` / `model` を受け、`judge=true` で Ollama judge (qwen2.5:3b 既定) を呼び parse 失敗時は heuristic にフォールバック。`judge=false` (既定) は完全ローカル評価のみ。BUILTIN_TOOL_CATALOG にも登録し manifest を再生成 (115 ツール)。
- **F-11 vector-store の Ollama 埋め込みバックエンド対応**
  [`memory/vector-store.ts`](../memory/vector-store.ts) に `searchByKeywordAsync(query, options)` を新設。`SF_AI_VECTOR_BACKEND=ngram|ollama` で `createEmbeddingProvider` 経由の VectorEmbeddingProvider をブリッジし、cosine 類似度ランキング + 上位件数 / minScore 制御 + レコード埋め込みキャッシュ (id+text の FNV ハッシュ) を提供。`tfidf` (既定) は従来挙動を維持。`search_vector` ツールは backend に応じて async 経路を自動選択し、レスポンスに `backend` フィールドを追加。
- **T-OLLAMA-03 generateStream ストリーム対応**
  [`mcp/core/llm/ollama-client.ts`](../mcp/core/llm/ollama-client.ts) に `OllamaGenerateChunk` 型と `generateStream(req, onChunk?)` を追加。`/api/generate` を NDJSON 行単位で読み出し、各チャンクを `onChunk` コールバックへ流しつつ累積レスポンス + 終了メタ (`total_duration`, `eval_count`) を返却。タイムアウト / HTTP 非 2xx / モデル未指定は `OllamaError` で正規化。3 件のテスト ([`tests/ollama-client.test.ts`](../tests/ollama-client.test.ts)) で集約挙動 / 503 ハンドリング / バリデーションを検証 (全 15 ケース)。
- **T-OBS-01 OpenTelemetry tracing wiring**
  [`mcp/core/observability/otel-tracer.ts`](../mcp/core/observability/otel-tracer.ts): `OTEL_ENABLED=true` で `@opentelemetry/api` を dynamic import し、tracer を遅延初期化。`notifyOtelTraceStart` / `notifyOtelTraceEnd` / `notifyOtelTraceFail` の 3 API を [`mcp/core/governance/governed-tool-registrar.ts`](../mcp/core/governance/governed-tool-registrar.ts) の MCP トレース ID と 1:1 で連携し、span 属性 `sfai.tool_name` / `sfai.trace_id` / `sfai.attempts` / `sfai.disabled` を発行。OTel 未導入環境では完全 no-op。
- **T-OBS-02 Prometheus metrics export**
  [`mcp/core/observability/prometheus-metrics.ts`](../mcp/core/observability/prometheus-metrics.ts): `prom-client` の専用 Registry を遅延初期化し、`sfai_tool_executions_total{tool,status}` (counter) / `sfai_tool_duration_seconds{tool,status}` (histogram, 1ms-30s 12 buckets) / `sfai_tool_failures_total{tool,code}` (counter) + Node.js デフォルトメトリクスを集積。[`mcp/tools/metrics.ts`](../mcp/tools/metrics.ts) の `recordMetric` から fan-out。MCP ツール `get_prometheus_metrics` を [`mcp/handlers/register-core-analysis-tools.ts`](../mcp/handlers/register-core-analysis-tools.ts) に追加し、Prometheus text/plain v0.0.4 形式で公開。
- **F-12 Refactor 提案エンジン AST 統合**
  [`mcp/tools/refactor-suggest.ts`](../mcp/tools/refactor-suggest.ts) に AST ベースシグナル `god-class` (単一クラスのメソッド数 > `maxMethodsPerClass`) と `soql-dml-overload` (ファイル単位 SOQL+DML 合計 > `maxSoqlDmlPerFile`) を追加。`analyzeApexSource` を併用し、AST 失敗時は無視してヒューリスティックのみで継続する safe-fallback を維持。`RefactorSuggestionKind` を 4→6 に拡張。

#### Phase 2 検証結果
- `npm test`: 610 件 PASS / 0 FAIL (Phase 1 の 607 件から +3)。
- `npm run lint:core-layers`: 101 ファイルスキャン、レイヤ違反 0。
- `npm run docs:tools` / `docs:manifest`: 115 ツール (Phase 1 の 114 から +1)。
- **インフラ基盤**
  [`docker-compose.yml`](../docker-compose.yml) で Ollama (LLM/Embedding) + Jaeger (OTel trace) + Prometheus (metrics) + Grafana (dashboard) を 1 ファイルで起動。Ollama は Docker 既定 (port 11434)、ホスト版インストールは不要。`docker compose up -d` 一発で全依存が立ち上がる。
- **追加 npm 依存**
  `js-tiktoken` / `@apexdevtools/apex-parser@4.4.1` / `fast-xml-parser@^5` / `better-sqlite3` / `@opentelemetry/api` / `@opentelemetry/sdk-node` / `@opentelemetry/exporter-trace-otlp-http` / `prom-client` を追加 (全 OSS / 完全無料)。`npm audit fix` 後 vulnerabilities = 0。

### Added (2026-04-27 Phase 5 — 運用強化 / 発話スタイル制御)

ユーザー指定 9 件の運用系アップデート + エージェント別言葉遣い制御を実装。WebSocket / Git hook 系は対象外。

- **T-FIX-01** [`mcp/core/quality/scan-exclusions.ts`](../mcp/core/quality/scan-exclusions.ts): `markdown-catalog` / `apex-dependency-graph(-incremental)` / `register-core-analysis-tools` の Apex 走査でも `shouldSkipScanDir` を共通利用するよう統一。
- **T-FIX-02** [`mcp/core/registration/`](../mcp/core/registration/): `register-all-tools.ts` を `domain-analysis` / `domain-chat` / `domain-history-context` / `domain-resource` の 4 サブビルダに分割し可読性を向上。
- **T-FIX-03** [`mcp/core/resource/proposal/`](../mcp/core/resource/proposal/): `proposal-queue` / `proposal-applier` / `auto-create-gate` を `proposal/` サブディレクトリへ整理し `index.ts` で再エクスポート。
- **T-FIX-04** [`mcp/core/errors/messages.ts`](../mcp/core/errors/messages.ts) / [`mcp/core/errors/tool-error.ts`](../mcp/core/errors/tool-error.ts): `AppError` に `withContext({ filePath, line, functionName })` を追加し、エラーメッセージ末尾へ `[fn=… file=…:line]` を自動付与。
- **T-FIX-06** [`mcp/core/context/markdown-catalog.ts`](../mcp/core/context/markdown-catalog.ts): プロジェクトルート解決を `realpathSync` 化し、12 階層上限 + visited Set でシンボリックリンク循環を防止。
- **T-FIX-07** [`scripts/lint-outputs.ts`](../scripts/lint-outputs.ts): `--fix` フラグでスキーマ未登録のディレクトリ/ファイルを自動追記、孤立スキーマエントリは WARN 出力。
- **T-FIX-08** [`docs/documentation-map.md`](./documentation-map.md): "まず読む 5 つ" + 機能テーブル形式に再編。
- **T-FIX-09** [`tests/outputs-schema-integration.test.ts`](../tests/outputs-schema-integration.test.ts): `lint:outputs` の終了コードを実バイナリ起動で検証する統合テスト。
- **T-ADD-02** [`mcp/core/learning/rl-feedback.ts`](../mcp/core/learning/rl-feedback.ts): `computeDynamicExplorationRate(state, { baseRate, minSamples, maxRate })` を追加。サンプル数中央値が低いほど探索率を引き上げる Thompson サンプリング補助。
- **T-ADD-03** [`mcp/core/org/org-catalog.ts`](../mcp/core/org/org-catalog.ts): `findStaleOrgs(catalog, intervalMs)` と `diffOrgMetadata(left, right)` を追加し、複数 Org のメタデータ差分比較を可能化。
- **T-ADD-04** [`mcp/tools/flow-condition-simulator.ts`](../mcp/tools/flow-condition-simulator.ts): `extractFlowConditionFields` / `enumerateFlowConditionMatrix` を追加し Flow 条件を全数評価して真偽マトリクスを返す (上限 256 セルでトリミング)。
- **T-ADD-05** [`mcp/tools/security-rule-scan.ts`](../mcp/tools/security-rule-scan.ts): 全 10 ルールへ CWE 番号 (CWE-89/862/798/601/79/95/532/285/942/327) と日本語 remediation を付与し SecurityScanIssue に伝搬。
- **T-ADD-07** [`scripts/skill-auto-classify.ts`](../scripts/skill-auto-classify.ts) + `npm run skills:classify`: `embedding-ranker` を用いて各 skill のカテゴリ妥当性と類似 skill を `outputs/reports/skill-auto-classify.json` に出力。
- **T-ADD-08** [`mcp/tools/apex-compliance-report.ts`](../mcp/tools/apex-compliance-report.ts) + MCP ツール `apex_compliance_report` ([`mcp/handlers/register-core-analysis-tools.ts`](../mcp/handlers/register-core-analysis-tools.ts)): セキュリティ × 性能 × 依存グラフを統合し overallRiskScore と上位被依存 Apex を返す総合レポート。
- **T-ADD-09** [`mcp/core/observability/dashboard-agent-views.ts`](../mcp/core/observability/dashboard-agent-views.ts): `buildAgentTopicHeatmap` (agent×topic 成功率マトリクス) と `buildAgentTrustScoreTimeline` (24h バケットの信頼スコア時系列) を追加。
- **T-NEW-01** [`mcp/core/context/speech-style-registry.ts`](../mcp/core/context/speech-style-registry.ts): 各 persona / agent の **一人称・文末語尾・敬語レベル・口癖** を定義した発話スタイルレジストリを新設し、[`mcp/core/context/chat-prompt-builder.ts`](../mcp/core/context/chat-prompt-builder.ts) から `## 発話スタイル一覧` セクションとして自動注入。例: samurai → 拙者 / でござる、speed-demon → 俺 / 急げ、commander → 本官 / 以上。

テスト: `tests/dashboard-agent-views.test.ts` / `tests/speech-style-registry.test.ts` / `tests/rl-feedback-dynamic.test.ts` / `tests/org-catalog-sync.test.ts` / `tests/flow-condition-matrix.test.ts` / `tests/outputs-schema-integration.test.ts` を追加。`npm test` 全 495 件 PASS。MCP ツール総数は 112 → 113 件。

### Added (2026-04-27 Phase 3 — F1〜F12 / A1〜A19)

エラー応答整備・ドキュメント自動化・拡張ツール群を一括投入。MCP ツールは 89 → 105 件に増加。

#### F1〜F12 基盤・品質改善

- **F1** [`mcp/core/errors/messages.ts`](../mcp/core/errors/messages.ts): 多言語化対応の AppError / errorCode テーブルを導入し、ハンドラ層から共通利用。
- **F2** [`mcp/core/i18n/`](../mcp/core/i18n/): ロケール辞書 (`ja` / `en`) と `t()` フォーマッタを追加。エラーメッセージとレポート見出しを多言語化。
- **F3** [`mcp/core/context/context-budget.ts`](../mcp/core/context/context-budget.ts): プロンプト断片を tokens / priority で打ち切る `applyContextBudget` を実装し、`chat-prompt-builder` から使用。
- **F4** [`mcp/core/context/prompt-rendering.ts`](../mcp/core/context/prompt-rendering.ts): セクション順序・冗長性制御を持つレンダラを切り出し、persona-style と統合。
- **F5** [`mcp/core/governance/defaults.ts`](../mcp/core/governance/defaults.ts): governance 既定値を一元化し `governance-manager` が参照。
- **F6** [`mcp/core/learning/model-arbitration.ts`](../mcp/core/learning/model-arbitration.ts): shadow / candidate / production の比較とアービトレーションを追加し `model-registry` から呼び出し。
- **F7** [`mcp/core/layer-manifest.ts`](../mcp/core/layer-manifest.ts) + [`scripts/lint-core-layers.ts`](../scripts/lint-core-layers.ts): レイヤ依存制約を宣言し循環参照を検出する Lint。
- **F8** [`scripts/lint-outputs.ts`](../scripts/lint-outputs.ts): outputs 配下スキーマ整合性チェック。
- **F9** [`scripts/extract-tool-names.ts`](../scripts/extract-tool-names.ts): MCP ツール名一覧抽出ユーティリティ。
- **F10** [`scripts/generate-tools-doc.ts`](../scripts/generate-tools-doc.ts): `npm run docs:tools` で [`docs/features/tools-reference.md`](./features/tools-reference.md) を自動生成。
- **F11** [`scripts/generate-config-doc.ts`](../scripts/generate-config-doc.ts): `npm run docs:config` で [`docs/configuration.md`](./configuration.md) の governance 既定セクションを再生成。
- **F12** [`scripts/test.mjs`](../scripts/test.mjs): `pathToFileURL` を使った Windows 安定版 node:test ランナー。

#### A 系 拡張ツール (A11/A12/A13/A17 は外部ツール連携のため除外)

- **A1** [`mcp/core/org/org-catalog.ts`](../mcp/core/org/org-catalog.ts) + [`mcp/handlers/register-org-catalog-tools.ts`](../mcp/handlers/register-org-catalog-tools.ts): Org カタログ (CRUD + サマリ) と 4 つの MCP ツール (`register_org` / `remove_org` / `get_org` / `list_orgs`)。
- **A2** [`mcp/tools/apex-dependency-graph.ts`](../mcp/tools/apex-dependency-graph.ts) 強化と [`mcp/tools/apex-dependency-graph-incremental.ts`](../mcp/tools/apex-dependency-graph-incremental.ts): 差分更新対応。
- **A3** [`mcp/core/governance/governance-ui.ts`](../mcp/core/governance/governance-ui.ts): governance ルールの HTML / Markdown UI レンダラ (XSS 対策済み)。MCP ツール `render_governance_ui`。
- **A4** [`mcp/tools/recommend-skills-for-role.ts`](../mcp/tools/recommend-skills-for-role.ts): role / topic / 最近触ったファイル拡張子から関連スキルを推薦。
- **A5** [`mcp/tools/tune-prompt-templates.ts`](../mcp/tools/tune-prompt-templates.ts): avgScore / successRate / tokenEfficiency の合成スコアで promote / retire / leader を判定。
- **A6** [`mcp/tools/agent-synergy-score.ts`](../mcp/tools/agent-synergy-score.ts): 共起 lift × log(1+co) によるエージェント協調スコア。MCP ツール `score_agent_synergy`。
- **A7** [`mcp/tools/refactor-suggest.ts`](../mcp/tools/refactor-suggest.ts): リファクタ候補抽出。
- **A8** [`mcp/tools/test-scaffold-extractor.ts`](../mcp/tools/test-scaffold-extractor.ts): Apex テスト雛形抽出。
- **A9** [`mcp/tools/security-rule-scan.ts`](../mcp/tools/security-rule-scan.ts) + [`scan_security_rules`](../mcp/handlers/register-branch-review-tools.ts) MCP ツール: 10 ルール (SOQL injection / hardcoded credential / innerHTML / eval / weak crypto 等) のヒューリスティック走査。
- **A10** [`mcp/tools/apex-perf-predict.ts`](../mcp/tools/apex-perf-predict.ts) + [`predict_apex_performance`](../mcp/handlers/register-core-analysis-tools.ts) MCP ツール: SOQL/DML in loop、深いネスト、長大メソッド等のリスクスコアリング。
- **A14** [`mcp/tools/apex-changelog.ts`](../mcp/tools/apex-changelog.ts): Apex 変更履歴生成。
- **A15** [`mcp/core/observability/dashboard-drill-down.ts`](../mcp/core/observability/dashboard-drill-down.ts): toolName / status / 期間でフィルタしたドリルダウン集計と 5 秒窓相関。MCP ツール `drill_down_dashboard`。
- **A16** [`mcp/core/resource/feedback-loop-visualization.ts`](../mcp/core/resource/feedback-loop-visualization.ts): rejectReason 分布、デイリー timeline、(topic×resource) ヒートマップ、上昇/下降トレンド比較。MCP ツール `visualize_feedback_loop`。
- **A18** governance / observability dashboard 出力に統計補強。
- **A19** [`mcp/core/governance/handler-schedule.ts`](../mcp/core/governance/handler-schedule.ts): allow/deny ルールと wrap-around 時間帯 (深夜跨ぎ) を扱う `evaluateHandlerSchedule`。

#### Tests

- 上記すべての pure function に対し `tests/*.test.ts` を追加 (合計 +20 テストファイル)。`scripts/test.mjs` 経由で全 green。

#### Docs auto-regen

- [`docs/features/tools-reference.md`](./features/tools-reference.md): 105 ツールに更新 (旧 89)。
- [`docs/internal/tool-manifest.md`](./internal/tool-manifest.md) / [`docs/internal/tool-manifest.json`](./internal/tool-manifest.json): 再生成。
- [`docs/configuration.md`](./configuration.md): governance 既定セクション再生成。
- [`README.md`](../README.md): ツール総数 (60+ → 105+) を更新。

### Fixed (2026-04-27)

- [`mcp/core/quality/scan-exclusions.ts`](../mcp/core/quality/scan-exclusions.ts) を新設し、リポジトリ走査で `.sf` / `.sfdx` / `.git` / `node_modules` / `dist` / `build` / `coverage` / `.next` / `.cache` / `.vscode` / `.idea` / `.turbo` / `__pycache__` / `.venv` を除外。Salesforce CLI の自動生成キャッシュが解析対象に混入する問題を解消。
- [`mcp/tools/repo-analyzer.ts`](../mcp/tools/repo-analyzer.ts) / [`mcp/tools/apex-dependency-graph.ts`](../mcp/tools/apex-dependency-graph.ts) / [`mcp/tools/apex-dependency-graph-incremental.ts`](../mcp/tools/apex-dependency-graph-incremental.ts) で共通除外ヘルパ `shouldSkipScanDir` を適用。
- [`tests/governed-tool-registrar.test.ts`](../tests/governed-tool-registrar.test.ts): 必須となった `outputsDir` / `serverRoot` を `mkdtempSync` で生成して渡し、ビルドエラーを解消。
- [`outputs/.schema.json`](../outputs/.schema.json): A1 Org カタログ実装が書き込む実パス (`outputs/orgs/`) と allow-list の不整合 (`org-catalog`) を修正し、`orgs` に統一。あわせて [`docs/outputs-structure.md`](./outputs-structure.md) に `.schema.json` / `npm run lint:outputs` の運用節を追加。

### Added (2026-04-27 Phase 4 — Resource Auto-Creation Phase 1)

リソース作成提案を**永続化**する仕組みを導入 (Phase 1: 提案キュー)。自動適用は Phase 3 以降。MCP ツールは 105 → 110 件。

- [`mcp/core/resource/proposal-queue.ts`](../mcp/core/resource/proposal-queue.ts): `enqueueProposal` / `listProposals` / `getProposal` / `approveProposal` / `rejectProposal` / `summarizeProposalQueue`。`outputs/tool-proposals/{pending,approved,rejected}/<id>.json` で状態を永続化。`buildProposal` / `nextProposalId` は純粋関数。
- [`mcp/handlers/register-proposal-queue-tools.ts`](../mcp/handlers/register-proposal-queue-tools.ts): MCP ツール 5 件を登録。
  - `enqueue_proposal` — 新規 skill / tool / preset の作成提案を pending/ にキュー。
  - `list_proposals` — status / resourceType / limit でフィルタ。
  - `get_proposal` — ID で 1 件取得。
  - `approve_proposal` — pending → approved に移動 (実適用は引き続き `apply_resource_actions` / `create_preset`)。
  - `reject_proposal` — pending → rejected に移動 (理由必須)。
- [`tests/proposal-queue.test.ts`](../tests/proposal-queue.test.ts): 11 ケース全 green。
- [`docs/features/tools-reference.md`](./features/tools-reference.md) / [`docs/internal/tool-manifest.md`](./internal/tool-manifest.md): 110 ツールに更新。

### Added (2026-04-28 Phase 4 — Resource Auto-Creation Phase 2 / 3 / 4)

提案キューに**実適用**と**自動承認バッチ**を追加。MCP ツールは 110 → 112 件 (`apply_proposal` / `auto_apply_pending_proposals`)。

- **Phase 2 — 実適用** [`mcp/core/resource/proposal-applier.ts`](../mcp/core/resource/proposal-applier.ts):
  - `slugifyResourceName` (純粋関数。lowercase/dash collapse/64 文字制限)。
  - `applyProposal(record, { repoRoot, outputsDir, overwrite })` で resourceType 別に物理書き込み。
    - `skills` → `skills/<slug>.md`
    - `tools` → `outputs/custom-tools/<slug>.json` (content を JSON parse、失敗時は `{description}` ラップ)
    - `presets` → `outputs/presets/<slug>/v<n>.json` + `outputs/presets/<slug>.json` (latest)。`v\d+\.json` を走査して自動 increment。
  - 既定 idempotent (`overwrite=false` で既存スキップ)。
- **Phase 2 — MCP ツール** `apply_proposal` (`approve` + 物理適用を 1 ステップ実行):
  - pending を取得 → `applyProposal` → 成功時のみ `approveProposal` で approved/ へ移動。
- **Phase 3 — Auto-create gate** [`mcp/core/resource/auto-create-gate.ts`](../mcp/core/resource/auto-create-gate.ts):
  - `evaluateAutoCreateGate({ proposal, config, todayAppliedCount, denyList })` の純粋関数。
  - 拒否理由は `type-disabled` / `below-threshold` / `daily-limit-reached` / `denied-by-list` / `not-pending` の機械可読コードで返却。
  - `DEFAULT_AUTO_CREATE_CONFIG` は **すべて enabled=false** (明示 opt-in 必須)。
  - `countTodayApplied(approvedRecords, now)` で同日適用件数を集計。
- **Phase 4 — バルク自動承認** MCP ツール `auto_apply_pending_proposals`:
  - pending を一括スキャン → AutoCreateGate を通過した提案だけを `applyProposal` + `approveProposal`。
  - `dryRun: true` で適用せず判定のみ確認可能。`config` で resourceType ごとの policy を上書き、`denyList` で個別ブロック、`limit` (1〜100) でスキャン件数を制限。
  - cron 自体は実装せず、CI / 外部スケジューラから本ツールを定期呼び出しする運用前提。
- [`tests/proposal-applier.test.ts`](../tests/proposal-applier.test.ts) (6 ケース) / [`tests/auto-create-gate.test.ts`](../tests/auto-create-gate.test.ts) (7 ケース): 全 13 ケース green、リグレッション 462 件 pass。

### Added (2026-04-28 Declarative Tool Layer)

ツール定義を **Declarative (JSON)** と **Code (TS)** の二層に明示分離。LLM/ノンエンジニアが安全に追加できる層と、副作用 / 厳格スキーマが必要な層の境界線を確立。MCP ツール数 (公開向け) は 112 件のまま、内部基盤を強化。

- [`mcp/core/declarative/tool-spec.ts`](../mcp/core/declarative/tool-spec.ts): `DeclarativeToolSpec` zod スキーマ。`compose-prompt` / `static-text` 2 種の action、legacy `CustomToolDefinition` 互換変換 `fromLegacyCustomTool` / `parseToolSpec`。name は lowercase + `_` `-` 許容。
- [`mcp/core/declarative/loader.ts`](../mcp/core/declarative/loader.ts): `loadDeclarativeToolsFromDir` で `outputs/custom-tools/*.json` を起動時に動的 `govTool` 登録。重複名 / `governance.deprecated:true` / parse 失敗ファイルはスキップしレポート返却 (例外を上位に投げない)。
- [`mcp/core/registration/register-all-tools.ts`](../mcp/core/registration/register-all-tools.ts): loader を fire-and-forget で統合 (同期 API 維持)。
- [`mcp/core/resource/proposal-applier.ts`](../mcp/core/resource/proposal-applier.ts): `applyTool` を新スキーマ準拠で書き出すよう更新。検証失敗時は legacy 形式にフォールバックし loader 互換性を保つ。
- [`mcp/core/declarative/frontmatter.ts`](../mcp/core/declarative/frontmatter.ts): agents/personas/skills 用の **opt-in** YAML サブセット parser と zod schema (`AgentFrontmatterSchema` / `PersonaFrontmatterSchema` / `SkillFrontmatterSchema`、`strict()`)。既存 Markdown を非破壊。
- [`scripts/lint-outputs.ts`](../scripts/lint-outputs.ts): `outputs/custom-tools/*.json` の DeclarativeToolSpec 検証を追加。
- [`docs/architecture.md`](./architecture.md) §8: 二層構造の Mermaid 図と分類基準テーブル、関連モジュール一覧を追加。
- [`docs/examples/declarative-tool.compose-prompt.example.json`](./examples/declarative-tool.compose-prompt.example.json) / [`.static-text.example.json`](./examples/declarative-tool.static-text.example.json): 新スキーマの記述例。
- [`tests/declarative-tool-loader.test.ts`](../tests/declarative-tool-loader.test.ts) 9 件 + [`tests/declarative-frontmatter.test.ts`](../tests/declarative-frontmatter.test.ts) 6 件: 計 15 ケース全 green、リグレッション 477 件 pass。

### Added (2026-04-24 Phase 2-4)

- **TASK-036** [`mcp/core/resource/query-intent-classifier.ts`](../mcp/core/resource/query-intent-classifier.ts): topic から 7 種 intent (debug / design / review / explain / fix / test / generic) を判定しスコアに override を適用。
- **TASK-037** [`mcp/core/resource/cascading-delete.ts`](../mcp/core/resource/cascading-delete.ts): `apply_resource_actions` に `cascadeMode` (force / prompt / block) を追加し依存リソースの連鎖判定を実装。
- **TASK-038** [`mcp/core/trace/trace-context.ts`](../mcp/core/trace/trace-context.ts): `startPhase` / `endPhase` / `withPhase` を追加。`chat` / `orchestrate_chat` を `input` / `plan` / `execute` / `render` の 4 phase で計測し `metrics_summary` に `phaseBreakdown` を出力。
- **TASK-039** [`mcp/core/resource/usage-pattern.ts`](../mcp/core/resource/usage-pattern.ts): daily / weekly / burst / dormant の利用パターン検出を追加し `suggest_cleanup_resources` に統合。
- **TASK-040** [`mcp/core/context/persona-style-registry.ts`](../mcp/core/context/persona-style-registry.ts): 15 persona 分の tone / sectionOrder / hints を登録しプロンプト整形に反映。
- **TASK-041** [`mcp/core/resource/cleanup-scheduler.ts`](../mcp/core/resource/cleanup-scheduler.ts): cron スタイルのスケジューラと `governance_auto_cleanup_schedule` MCP ツールを追加。
- **TASK-042** [`mcp/core/resource/embedding-ranker.ts`](../mcp/core/resource/embedding-ranker.ts): n-gram cosine による hybrid rescore (`embeddingMode` / `embeddingAlpha`) を `selectResources` に追加。
- **TASK-043** [`mcp/core/resource/synergy-model.ts`](../mcp/core/resource/synergy-model.ts) と新ツール `synergy_recommend_combo` を追加。`agent-trust-score.evaluateAgentTrust` に `synergyBonus` 引数 (最大 +0.15)、`selectResources` に synergy bonus 経路を追加。
- **TASK-044** [`mcp/core/observability/dashboard.ts`](../mcp/core/observability/dashboard.ts) と MCP ツール `observability_dashboard` を追加し `outputs/dashboards/observability.{html,md,json}` を生成。
- **TASK-045** [`mcp/core/learning/model-registry.ts`](../mcp/core/learning/model-registry.ts): shadow → promote → rollback の段階反映を実装。
- **TASK-046** [`mcp/core/context/prompt-cache-persistence.ts`](../mcp/core/context/prompt-cache-persistence.ts): 環境変数 `PROMPT_CACHE_FILE` で JSONL 永続化と TTL 復元に対応。
- **TASK-047** [`mcp/core/learning/rl-feedback.ts`](../mcp/core/learning/rl-feedback.ts): Thompson Sampling bandit (Marsaglia-Tsang Gamma) と `forcedExplorationRate` を追加。
- **TASK-031** [`mcp/tools/agent-ab-test.ts`](../mcp/tools/agent-ab-test.ts) に仕様準拠の `applyAbTestOutcome(trustStorePath, winner, loser, magnitude)` エイリアスを追加。
- **TASK-048** [`tests/property-based.test.ts`](../tests/property-based.test.ts): `fast-check` で scoring / learning / trust の不変条件 10 properties を追加。
- **TASK-049** [`docs/architecture.md`](./architecture.md): Core 層の説明を更新し Mermaid サブシステム関係図を追加。
- **TASK-050** [`.github/workflows/benchmark-nightly.yml`](../.github/workflows/benchmark-nightly.yml): 毎日 19:30 UTC に benchmark を実行し grade 低下で alert、`outputs/benchmark/` に蓄積。
- **検証ドキュメント** [`docs/full-feature-verification.md`](./full-feature-verification.md): 全機能を一通り動作確認するための網羅的検証手順を追加。

### Added

- `docs/architecture.md` を追加し、レイヤ構成・主要フロー・非機能観点を整理。
- `docs/features/` に機能別ドキュメントを追加（11カテゴリ）。
- `docs/documentation-map.md` を追加し、用途別導線を整備。
- Trace / Metrics 集約の運用導線を明確化。
- `scripts/cleanup-outputs.ts` を追加し、`outputs/history` と `outputs/sessions` の保持期間クリーンアップを自動化。
- `docs/metrics-evaluation.md` を追加し、各評価指標の算出式・しきい値・運用基準を明確化。
- `.github/workflows/metrics-dashboard-publish.yml` を追加し、GitHub Pages へダッシュボードを定期公開。
- `docs/developer-guide.md` に MCP SDK 更新ランブック（依存更新、型差分確認、互換性確認、統合テスト、ドキュメント反映）を追加。
- `mcp/tool-registry.ts` を追加し、ツール登録責務を分離。
- `mcp/transport.ts` を追加し、stdio 接続責務を明示化。
- `mcp/lifecycle.ts` を追加し、起動・終了・エラーハンドリング責務を分離。

### Changed

- `README.md` の起動手順を `npm run mcp:dev` / `npm run mcp:start` ベースに更新。
- `verification-guide.md` のテスト手順を `npm test` に統一。
- `docs/feature-usage-guide.md` のコマンド・環境変数説明を更新。
- `mcp/tools/branch-diff-summary.ts` の Git 差分取得処理を共通ヘルパ利用に統一。
- `mcp/tools/changed-tests-suggest.ts` と `mcp/tools/coverage-estimate.ts` に targetOrg の共通検証を適用。
- `docs/outputs-structure.md` に outputs の運用ルールと cleanup 手順を追記。
- `scripts/metrics-dashboard.js` に指標評価方法の表示を追加し、metrics ファイル未存在時の空ダッシュボード生成に対応。
- `mcp/server.ts` をリファクタし、登録・接続・起動責務を新規モジュールへ委譲（TASK-006 完了）。

### Fixed

- targetOrg の不正入力に対する防御（入力検証）を強化。
- Vector Store の LRU 振る舞いに関する回帰を防ぐテストを追加。
- テストケースを拡充し、141件の pass 状態を維持。

## [1.0.0] - 2026-04-20

### Added

- MCP サーバの初期実装。
- エージェント / スキル / ペルソナ / コンテキストの読み込み基盤。
- リソースガバナンス、イベント自動化、履歴保存の基盤。
- Salesforce 向けの主要分析ツール群。
