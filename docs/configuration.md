# 設定ガイド（運用向け）

このページは「まず何を設定すれば動くか」を優先してまとめています。
技術的な詳細は後半に載せています。

## まずはこれだけ

通常運用では、次の 2 つだけ覚えれば十分です。

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `DATABASE_URL` | 実行ログ・学習ログ・ガバナンス状態の既定保存先となる Postgres 接続文字列 | 未設定 |
| `SF_AI_OUTPUTS_DIR` | 生成レポートや fallback 生成物の保存場所（任意） | `outputs/` |
| `SF_AI_HISTORY_SQLITE` | 履歴ストアを SQLite へ切り替える（`true`/`false`） | `false` |
| `SF_AI_STATE_DB_PATH` | SQLite DB ファイルの保存先（`SF_AI_HISTORY_SQLITE=true` 時） | `outputs/state.sqlite` |
| `SF_AI_METRICS_REPORTING_HOURS` | 学習ダッシュボード更新時の集計ウィンドウ（時間） | `24` |
| `SF_AI_METRICS_WITH_DRIFT` | メトリクス更新時に drift / regression 検知を同時実行（`true`/`false`） | `false` |
| `SF_AI_LEARNING_ORCHESTRATOR_ENABLED` | metrics 更新時に learning orchestrator バッチを実行するか（`true`/`false`） | `false` |
| `SF_AI_LEARNING_SNAPSHOT_PATH` | learning orchestrator が読み書きする model-registry snapshot JSON パス | 未設定 |
| `SF_AI_LEARNING_MODEL_NAMES` | orchestrator 対象モデル名（`,` 区切り） | 未設定 |
| `SF_AI_LEARNING_CANARY_STATE_PATH` | canary 中モデルの状態を自動永続化する JSON パス | 未設定 |
| `LOG_LEVEL` | ログの詳しさ（`error` / `warn` / `info` / `debug`） | `info` |
| `SF_AI_LOCALE` | エラーメッセージ等のローカライズ言語（`ja` / `en`） | `ja` |
| `AI_LOW_RELEVANCE_THRESHOLD` | 低関連度判定のしきい値（高いほど厳格） | `6` |
| `AI_AGENT_TRUST_SCORING_ENABLED` | エージェント信頼スコアによる自動エスカレーションを有効化 | `false` |
| `AI_AGENT_TRUST_THRESHOLD` | 信頼スコアの閾値（0.0〜1.0） | `0.55` |

補足:

- SQLite 実装は `node:sqlite` を利用しています（Node 標準機能）
- 既定の DB ファイル名は `state.sqlite` で統一しています
- 既存 JSONL/history から移行する場合は `npm run state:migrate-sqlite`
- 互換 JSONL を再出力する場合は `npm run state:export-jsonl -- --out-dir <dir>`
- 再出力時に元 JSONL 件数と突合する場合は `--verify-source-dir <outputsDir>` を付与（不一致時は終了コード 1）
- 事前に `node -e "require('node:sqlite'); console.log('node:sqlite OK')"` でランタイム可用性を確認できます
- `ExperimentalWarning: SQLite is an experimental feature` は既知の警告です（起動失敗ではありません）
- 観測性の責務分離と削除ゲートは `docs/observability-cleanup-playbook.md` を参照してください

## よくある利用パターン

### 1. 生成レポートの保存先を別ディスクにしたい

```bash
SF_AI_OUTPUTS_DIR=D:/sf-ai-artifacts npm run ai -- dev
```

補足:

- `DATABASE_URL` が設定されていれば、実行 provenance / trace / metrics / drift / 学習補助ログは Postgres に保存されます
- `SF_AI_OUTPUTS_DIR` はサーバープロセス側で解決されます
- 絶対パスを使えば、別リポジトリから同じ MCP サーバーを使っても生成レポートの保存先を共通化できます

### 2. 調査のため詳細ログを出したい

```bash
LOG_LEVEL=debug SF_AI_DEBUG_VERBOSE_PROMPT=true npm run ai -- dev
```

注意: `SF_AI_DEBUG_VERBOSE_PROMPT=true` はプロンプト本文まで出力するため、通常運用では `false` 推奨です。

## 推奨プロファイル

用途別に、`../env.example` + `../env.profiles/*.overlay` をベースに `.env` を作成できます。

- 共通テンプレート: `../env.example`
- ローカル開発向け overlay: `../env.profiles/dev.overlay`
- 運用向け overlay: `../env.profiles/prod.overlay`

例 (PowerShell):

```powershell
Copy-Item env.example .env
Get-Content env.profiles/dev.overlay | Add-Content .env
# または
Copy-Item env.example .env
Get-Content env.profiles/prod.overlay | Add-Content .env
```

補足:

- 旧 `../.env.sample` / `../.env.local.sample` / `../.env.operations.sample` は移行期間中の互換サンプルです
- `SF_AI_ENV_VALIDATE=true`（既定）で起動時に env schema 検証を実施し、明らかな設定不備を fail-fast します

## MCP transport

`MCP_TRANSPORT` を切り替えると、stdio と HTTP の transport を選べます。

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `MCP_TRANSPORT` | MCP transport の種類（`stdio` / `http`） | `stdio` |
| `MCP_HTTP_HOST` | HTTP transport の待受ホスト | `127.0.0.1` |
| `MCP_HTTP_PORT` | HTTP transport の待受ポート | `3800` |
| `MCP_HTTP_CORS_ORIGIN` | HTTP transport の CORS 許可オリジン | `*` |
| `MCP_HTTP_RATE_LIMIT_PER_MIN` | クライアント単位の 1 分あたりリクエスト上限 | `120` |

補足:

- HTTP transport を使う場合は `MCP_TRANSPORT=http` を設定します
- セッション ID は `mcp-session-id` ヘッダで維持されます

## Event bus

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_EVENT_BUS_BACKEND` | イベントバス実装（`in-memory` / `postgres-notify` / `redis-streams`） | `in-memory` |
| `SF_AI_EVENT_BUS_REDIS_URL` | `redis-streams` 利用時の Redis 接続先 | 未設定 |
| `SF_AI_EVENT_BUS_STREAM_KEY` | Redis Streams のキー名 | `sfai_event_bus_stream` |

補足:

- `postgres-notify` は `DATABASE_URL` を使います
- `redis-streams` は trace context（`traceId` / `traceparent`）を message に含めて伝播します

## Policy Bundle 署名検証 (T15)

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_POLICY_BUNDLE_PUBLIC_KEY_PATH` | `policy-bundle.sig` 検証に使う Ed25519 公開鍵 PEM のパス | 未設定 |

補足:

- `SF_AI_POLICY_BUNDLE_PUBLIC_KEY_PATH` を設定すると、`config/policies/policy-bundle.json` の読み込み時に `policy-bundle.sig` を検証します
- 署名検証失敗時は bundle を採用せず、`<policySet>.json` へフォールバックします
- `policy-bundle.sha256` がある場合は digest も検証します

### bundle 署名生成

```bash
npm run policy:bundle -- --signing-private-key ./secrets/policy-bundle.private.pem
```

生成物:

- `config/policies/policy-bundle.json`
- `config/policies/policy-bundle.sha256`
- `config/policies/policy-bundle.sig`（`--signing-private-key` 指定時）

### 鍵ローテーション手順（推奨）

1. 新しい Ed25519 鍵ペアを生成し、公開鍵をサーバへ配布
2. 新秘密鍵で `npm run policy:bundle -- --signing-private-key ...` を実行して bundle 再生成
3. `SF_AI_POLICY_BUNDLE_PUBLIC_KEY_PATH` を新公開鍵へ切り替えて再起動
4. 起動後に policy decision が `bundle` 経由で変わらないことを smoke test
5. 問題なければ旧公開鍵/秘密鍵を廃棄

運用メモ:

- ローテーション中に署名不一致が発生しても、policy set JSON へのフォールバックで fail-open/fail-closed を避けられます
- フォールバック理由は OPA policy engine の warning ログに出力されます

## Observability / trace

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `OTEL_TRACES_SAMPLER_RATIO` | trace の deterministic sampling 比率（0.0〜1.0） | `0.1` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP endpoint（Collector 推奨: `http://localhost:4318`） | `http://localhost:4318` |

補足:

- 低い比率にすると trace コストは下がりますが、詳細追跡性も下がります
- `OTEL_ENABLED=true` と組み合わせて利用します
- 運用は OTel Collector 経由を推奨します（`docker compose --profile observability up -d otel-collector jaeger`）

### profile固定 (T-26)

`SF_AI_PROFILE` を設定すると backend switcher をプロファイル値に固定します。

- `SF_AI_PROFILE=local`:
	- `SF_AI_STATE_BACKEND=sqlite`
	- `SF_AI_PROPOSAL_QUEUE_BACKEND=file`
	- `SF_AI_VECTOR_BACKEND=tfidf`
- `SF_AI_PROFILE=operations`:
	- `SF_AI_STATE_BACKEND=postgres`
	- `SF_AI_PROPOSAL_QUEUE_BACKEND=pg-boss`
	- `SF_AI_VECTOR_BACKEND=pgvector`

既定では `SF_AI_PROFILE_STRICT=true` で動作し、上記 3 変数を強制上書きします。
`SF_AI_PROFILE_STRICT=false` の場合は既存値を優先し、強制上書きしません。

優先順位:

1. `.env` 読み込み
2. `SF_AI_PROFILE` / `SF_AI_RUNTIME_PROFILE` の適用
3. サーバ起動時の backend 解決

## バックアップ関連

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_OUTPUTS_BACKUP_DIR` | 生成物 snapshot の保存先 | `outputs/backups` |
| `SF_AI_OUTPUTS_BACKUP_KEEP` | 保持世代数（古い順に削除） | `5` |

関連コマンド:

- `npm run ai -- outputs:version -- backup`
- `npm run ai -- outputs:version -- list`
- `npm run ai -- outputs:version -- wipe --keep-backups`
- `npm run ai -- outputs:version -- restore --snapshot <snapshot-id>`

## 自動運用（必要な場合のみ）

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_AUTO_APPLY` | 自動適用を有効化 | `false` |
| `SF_AI_AUTO_APPLY_MIN_SCORE` | 自動適用の最低スコア | `70` |
| `SF_AI_AUTO_APPLY_MAX_PER_DAY` | 1日の自動作成上限 | `5` |
| `SF_AI_AUTO_APPLY_MAX_DELETIONS` | 1回の削除上限 | `3` |

## バックエンド切り替え（推奨）

ローカル開発から運用環境へのスケール時は、次のバックエンド変数を利用します。

| 変数名 | 既定値 | 選択肢 | 説明 |
|---|---|---|---|
| `SF_AI_STATE_BACKEND` | `sqlite` | `sqlite`, `postgres` | 状態・ガバナンス・ガイダンス情報の保存先。`postgres` で冗長性向上 |
| `SF_AI_PROPOSAL_QUEUE_BACKEND` | `file` | `file`, `pg-boss` | proposal queue と cleanup schedule の永続化。`pg-boss` で分散トランザクション対応 |
| `SF_AI_VECTOR_BACKEND` | `tfidf` | `tfidf`, `pgvector` | ベクターストア。`pgvector` で PostgreSQL 統合、大規模検索に対応 |
| `DATABASE_URL` | 未設定 | `postgres://...` | Postgres 接続文字列（STATE_BACKEND=postgres または PROPOSAL_QUEUE_BACKEND=pg-boss 時） |
| `DATABASE_POOL_SIZE` | `10` | 整数 | Postgres 接続プール数 |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | `30000` | 整数 | アイドル接続タイムアウト（ミリ秒） |
| `PG_VECTOR_POOL_SIZE` | `10` | 整数 | PGVector 検索用の接続プール数 |

## Postgres & pg-boss（STATE_BACKEND=postgres または PROPOSAL_QUEUE_BACKEND=pg-boss 時）

| 変数名 | 用途 | デフォルト値 |
|---|---|---|
| `DATABASE_URL` | Postgres 接続文字列 | 未設定 |
| `DATABASE_POOL_SIZE` | コネクションプール数 | `10` |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | アイドル接続のタイムアウト（ミリ秒） | `30000` |
| `CLEANUP_SCHEDULER_QUEUE` | pg-boss recurring job 用のキュー名 | `governance-auto-cleanup` |

注記:

- `PROPOSAL_QUEUE_BACKEND=pg-boss` の場合、Postgres は必須です
- 既定の migration は `npm run db:migrate` で自動実行
- pg-boss のセットアップは Postgres init 時に自動化されます

## LangSmith（オプション）

| 変数名 | 用途 | デフォルト値 |
|---|---|---|
| `SF_AI_LANGSMITH_ENABLED` | LangSmith トレースフレームワークを有効化（`true`/`false`） | `false` |
| `LANGSMITH_API_KEY` | LangSmith API キー（`SF_AI_LANGSMITH_ENABLED=true` 時に必須） | 未設定 |
| `LANGSMITH_TRACING_ENABLED` | LangSmith トレースの有効化フラグ | 未設定（`SF_AI_LANGSMITH_ENABLED=true` 時に自動設定） |

注記:

- `SF_AI_LANGSMITH_ENABLED=true` を設定すると `LANGCHAIN_TRACING_V2=true` が自動設定されます
- ローカル開発では既定 OFF（計装オーバーヘッド削減）
- 運用環境（`.env.operations.sample`）では推奨 ON

## フル一覧（管理者向け）

| 変数名 | 用途 | デフォルト値 |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | 生成物・互換 file fallback の出力ベースディレクトリ | `outputs/` |
| `SF_AI_HISTORY_SQLITE` | 履歴ストアを SQLite (`node:sqlite`) に切り替えるフラグ（`true`/`false`） | `false` |
| `SF_AI_STATE_DB_PATH` | SQLite DB ファイルパス（`SF_AI_HISTORY_SQLITE=true` 時に利用） | `outputs/state.sqlite` |
| `SF_AI_OUTPUTS_BACKUP_DIR` | 生成物 snapshot の保存先ディレクトリ | `outputs/backups` |
| `SF_AI_OUTPUTS_BACKUP_KEEP` | 保持する snapshot 世代数（古い世代から削除） | `5` |
| `SF_AI_MEMORY_FILE` | プロジェクトメモリストアの JSONL ファイルパス | `outputs/memory.jsonl` |
| `SF_AI_VECTOR_STORE_FILE` | ベクターストア永続化先の JSONL ファイルパス | `outputs/vector-store.jsonl` |
| `SF_AI_VECTOR_MAX_RECORDS` | メモリ/ディスク上に保持するベクターレコードの最大件数（LRU） | `5000` |
| `SF_AI_TRACE_FILE` | トレース履歴の互換 JSONL 保存先。`DATABASE_URL` 未設定時や test override 時に利用 | `outputs/events/trace-log.jsonl` |
| `SF_AI_METRICS_FILE` | メトリクスサンプルの互換 JSONL 保存先。`DATABASE_URL` 未設定時や test override 時に利用 | `outputs/events/metrics-samples.jsonl` |
| `SF_AI_METRICS_REPORTING_HOURS` | 学習ダッシュボード更新時の集計ウィンドウ（時間） | `24` |
| `SF_AI_METRICS_WITH_DRIFT` | `metrics:update` 実行時に drift / regression 検知を同時実行するか | `false` |
| `SF_AI_DRIFT_BASELINE_HOURS` | drift 比較の baseline ウィンドウ（時間） | `168` |
| `SF_AI_DRIFT_RECENT_HOURS` | drift 比較の recent ウィンドウ（時間） | `24` |
| `SF_AI_DRIFT_MIN_REWARD_SAMPLES` | drift 判定に必要な recent reward の最小件数 | `20` |
| `SF_AI_DRIFT_MIN_REPUTATION_SAMPLES` | regression 判定に必要な agent reputation の最小件数（各窓） | `3` |
| `SF_AI_DRIFT_THRESHOLD` | reward drift 判定しきい値（平均シフト/スコア） | `0.15` |
| `SF_AI_REGRESSION_THRESHOLD` | agent regression 判定しきい値 | `0.1` |
| `SF_AI_DRIFT_REPORT_PATH` | drift / regression レポートの互換 JSONL 保存先。`DATABASE_URL` 未設定時や test override 時に利用 | `outputs/reports/drift-regression.jsonl` |
| `SF_AI_DRIFT_FREEZE_ENABLED` | drift alert 検知時に学習 freeze 状態を有効化するか (`true`/`false`) | `true` |
| `SF_AI_DRIFT_FREEZE_HOURS` | freeze の有効期間（時間）。未設定または `0` 以下の場合は手動解除まで継続 | 未設定 |
| `SF_AI_DRIFT_FREEZE_STATE_PATH` | freeze 状態ファイルの保存先 | `outputs/learning/drift-freeze.json` |
| `SF_AI_LEARNING_ORCHESTRATOR_ENABLED` | `metrics:update` 実行時に learning orchestrator を起動するか | `false` |
| `SF_AI_LEARNING_SNAPSHOT_PATH` | learning orchestrator が読み書きする model-registry snapshot JSON | 未設定 |
| `SF_AI_LEARNING_MODEL_NAMES` | orchestrator 対象モデル名（`,` 区切り） | 未設定 |
| `SF_AI_LEARNING_CURRENT_CANARY_MAP` | 現在 canary 中モデルの `model:version` 対応（`,` 区切り） | 未設定 |
| `SF_AI_LEARNING_CANARY_STATE_PATH` | canary 中モデルの `model -> version` を scheduler 実行時に保存/読込する JSON | 未設定 |
| `SF_AI_LEARNING_CANARY_TRAFFIC_PERCENT` | canary traffic 比率（1-100） | `5` |
| `SF_AI_LEARNING_MANUAL_APPROVAL_REQUIRED` | promote 前に proposal queue で手動承認を要求するか | 未設定 |
| `SF_AI_LEARNING_MANUAL_OVERRIDE` | 手動 override（`approve`/`reject`） | 未設定 |
| `SF_AI_LEARNING_ACTOR_ID` | event/proposal 記録に使う actor ID | 未設定 |
| `SF_AI_LEARNING_ORCHESTRATOR_REPORT_PATH` | orchestrator 実行レポート出力先 JSON | 未設定 |
| `SF_AI_AUTO_MEMORY` | チャット/ツール実行のたびに input/output サマリを `memory.jsonl` と `vector-store.jsonl` へ自動追記する。`1`/`true`/`on`/`yes` で有効。memory/vector 系ツール自身は再帰防止のため除外 | `false` |
| `SF_AI_PROGRESS_BANNER` | ツール応答テキストの先頭に進捗タイムライン (フェーズ別開始時刻・所要時間) を追加表示する。`false`/`0`/`off`/`no` で無効。`get_tool_progress` / `ping` は対象外 | `true` |
| `SF_AI_RATE_LIMIT_ENABLED` | actor/tenant/tool 単位の固定ウィンドウ rate limit を有効化する (`true`/`false`) | `true` |
| `SF_AI_RATE_LIMIT_WINDOW_MS` | rate limit 判定ウィンドウ（ミリ秒） | `60000` |
| `SF_AI_RATE_LIMIT_ACTOR_MAX` | actor ごとのウィンドウ内最大実行回数 | `120` |
| `SF_AI_RATE_LIMIT_TENANT_MAX` | tenant ごとのウィンドウ内最大実行回数 | `600` |
| `SF_AI_RATE_LIMIT_TOOL_MAX` | tool ごとのウィンドウ内最大実行回数 | `300` |
| `SF_AI_RATE_LIMIT_MAX_KEYS` | in-memory カウンタの最大キー数（超過時は古い窓を prune） | `10000` |
| `SF_AI_ENCRYPTION_ENABLED` | 保存時暗号化 (at-rest encryption) を有効化する (`true`/`false`) | `false` |
| `SF_AI_ENCRYPTION_KEY_B64` | AES-256-GCM 用の 32byte 鍵を base64 で指定（有効時は必須） | 未設定 |
| `SF_AI_SECRET_BACKEND` | Secret backend 種別（`env` / `file` / `vault` / `aws-sm`） | `env` |
| `SF_AI_SECRET_BOOTSTRAP` | 起動時の secret hydration を有効化（`true`/`false`） | `true` |
| `SF_AI_SECRET_ENV_MAP` | 追加 hydration マップ(JSON)。例: `{ "SERVICE_KEY": "config/service-key" }` | 未設定 |
| `SF_AI_SECRET_FILE_PATH` | `SF_AI_SECRET_BACKEND=file` 時の secrets ディレクトリ | `.secrets` |
| `SF_AI_VAULT_ADDR` | `SF_AI_SECRET_BACKEND=vault` 時の Vault URL | 未設定 |
| `SF_AI_VAULT_TOKEN` | `SF_AI_SECRET_BACKEND=vault` 時の Vault token | 未設定 |
| `SF_AI_VAULT_MOUNT` | `SF_AI_SECRET_BACKEND=vault` 時の KV mount 名 | `secret` |
| `SF_AI_VAULT_VALUE_FIELD` | Vault secret payload から取り出す value フィールド名 | `value` |
| `SF_AI_AWS_REGION` | `SF_AI_SECRET_BACKEND=aws-sm` 時の AWS region | `ap-northeast-1` |
| `SF_AI_ENCRYPTION_KEY_SECRET_NAME` | `SF_AI_ENCRYPTION_KEY_B64` を hydration する secret 名 | 未設定 |
| `SF_AI_ENCRYPTION_KEY_ID` | 暗号化 envelope に記録する鍵 ID | `local-env-v1` |
| `SF_AI_RETENTION_DAYS_PUBLIC` | T-24 分類 `public` の保持日数 | `365` |
| `SF_AI_RETENTION_DAYS_INTERNAL` | T-24 分類 `internal` の保持日数 | `180` |
| `SF_AI_RETENTION_DAYS_CONFIDENTIAL` | T-24 分類 `confidential` の保持日数 | `90` |
| `SF_AI_RETENTION_DAYS_RESTRICTED` | T-24 分類 `restricted` の保持日数 | `30` |
| `LOG_LEVEL` | ログ出力レベル（`error` / `warn` / `info` / `debug`） | `info` |
| `SF_AI_DEBUG_VERBOSE_PROMPT` | `LOG_LEVEL=debug` 時にプロンプト本文までログ出力するか | `false` |
| `SF_AI_LOCALE` | `AppError` 等のローカライズ言語（`ja` / `en`）。未対応値は `ja` にフォールバック (TASK-F8) | `ja` |
| `SF_AI_DOTENV_DISABLE` | `.env` 自動読込を無効化する (`1` で無効) | `0` |
| `SF_AI_DOTENV_PATH` | 読み込む `.env` のパスを明示指定（指定時は優先） | 未設定 |
| `OTEL_ENABLED` | OTel SDK を有効化する (`true` で有効) | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP エンドポイント（`/v1/traces` は自動補完） | 未設定 |
| `OTEL_SERVICE_NAME` | OTel のサービス名（Jaeger 上の識別名） | `salesforce-ai-company` |
| `SF_AI_LANGSMITH_ENABLED` | LangSmith 連携の有効化フラグ（`true` で `LANGCHAIN_TRACING_V2=true` を設定） | `false` |
| `PROMETHEUS_METRICS_PORT` | `/metrics` を公開する HTTP ポート（`0` で無効） | `0` |
| `OLLAMA_INIT_MODELS` | docker compose の `ollama-init` が pull するモデル一覧（空白区切り） | `qwen2.5:3b nomic-embed-text:latest` |
| `PROMPT_CACHE_MAX_ENTRIES` | メモリ上にキャッシュするプロンプトの最大件数 | `100` |
| `PROMPT_CACHE_TTL_SECONDS` | キャッシュエントリの有効期間（秒） | `600` |
| `PROMPT_CACHE_FILE` | プロンプトキャッシュを JSONL に永続化する先（未指定なら永続化しない / TASK-046） | 未設定 |
| `AI_PROMPT_CACHE_MAX_ENTRIES` | `PROMPT_CACHE_MAX_ENTRIES` の新名称（優先して参照） | `100` |
| `AI_PROMPT_CACHE_TTL_SECONDS` | `PROMPT_CACHE_TTL_SECONDS` の新名称（優先して参照） | `600` |
| `AI_LOW_RELEVANCE_THRESHOLD` | 低関連度判定しきい値（`LOW_RELEVANCE_SCORE_THRESHOLD` 互換） | `6` |
| `AI_AGENT_TRUST_SCORING_ENABLED` | エージェント信頼スコアを有効化（`SF_AI_AGENT_TRUST_SCORING_ENABLED` 互換） | `false` |
| `SF_AI_AGENT_TRUST_SCORING_ENABLED` | 互換用: エージェント信頼スコアを有効化 | `false` |
| `AI_AGENT_TRUST_THRESHOLD` | 信頼スコアの閾値（0.0〜1.0） | `0.55` |
| `SF_AI_AGENT_TRUST_THRESHOLD` | 互換用: 信頼スコアの閾値（0.0〜1.0） | `0.55` |
| `AI_LLM_PROVIDER` | LLM provider 切替（`ollama` / `heuristic`）。quality rubric / self-refine の judge 経路に適用 | `ollama` |
| `SF_AI_LLM_PROVIDER` | 互換用: LLM provider 切替（`ollama` / `heuristic`） | 未設定 |
| `SF_AI_AUTO_APPLY` | リソースハンドラー・閾値ハンドラーによる自動 apply を有効化 | `false` |
| `SF_AI_AUTO_APPLY_MIN_SCORE` | 自動 apply を実行する最低品質スコア（0〜100） | `70` |
| `SF_AI_AUTO_APPLY_MAX_PER_DAY` | 1日あたりの自動リソース作成上限件数 | `5` |
| `SF_AI_AUTO_APPLY_MAX_DELETIONS` | 1回の閾値ハンドリングで許可する削除件数の上限 | `3` |
| `SF_AI_STATE_BACKEND` | 状態・ガバナンス・ガイダンス情報の保存先（`sqlite` / `postgres`） | `sqlite` |
| `SF_AI_PROPOSAL_QUEUE_BACKEND` | proposal queue と cleanup schedule の永続化（`file` / `pg-boss`） | `file` |
| `SF_AI_VECTOR_BACKEND` | ベクターストア（`tfidf` / `pgvector`） | `tfidf` |
| `DATABASE_URL` | Postgres 接続文字列（`STATE_BACKEND=postgres` または `PROPOSAL_QUEUE_BACKEND=pg-boss` 時） | 未設定 |
| `SF_AI_DB_URL_PRIMARY` | Postgres の primary 接続先。設定時は `DATABASE_URL` より優先して write/read の基準になる | 未設定 |
| `SF_AI_DB_URL_REPLICA` | Postgres の replica 接続先。設定時は read 用コネクションとして利用（未設定時は primary を利用） | 未設定 |
| `SF_AI_DR_DRILL_EXECUTE` | `dr:drill` を本実行モードにする補助フラグ | `false` |
| `SF_AI_DR_PROMOTE_COMMAND` | DR drill 時の promote コマンド | 未設定 |
| `SF_AI_DR_DNS_COMMAND` | DR drill 時の DNS 切替コマンド | 未設定 |
| `SF_AI_DR_ROLLBACK_COMMAND` | DR drill 失敗時の rollback コマンド | 未設定 |
| `DATABASE_POOL_SIZE` | Postgres コネクションプール数 | `10` |
| `DATABASE_POOL_IDLE_TIMEOUT_MS` | アイドル接続のタイムアウト（ミリ秒） | `30000` |
| `CLEANUP_SCHEDULER_QUEUE` | pg-boss recurring job 用のキュー名 | `governance-auto-cleanup` |
| `PG_VECTOR_POOL_SIZE` | PGVector 検索用の接続プール数 | `10` |
| `SF_AI_LANGSMITH_ENABLED` | LangSmith トレースフレームワークを有効化（`true`/`false`） | `false` |
| `LANGSMITH_API_KEY` | LangSmith API キー | 未設定 |
| `LANGSMITH_TRACING_ENABLED` | LangSmith トレースの有効化フラグ | 未設定 |
| `OLLAMA_REQUIRED` | `true` の場合、Ollama が利用不可なら起動を中断する | `false` |
| `SF_AI_BENCHMARK_TRACE_LIMIT` | `benchmark-suite` が参照する直近 trace 件数 | `300` |
| `EVENT_HISTORY_MAX` | EventDispatcher がメモリ上に保持するイベントの最大件数 | `1000` |
| `TRACE_HISTORY_MAX` | メモリ上に保持する完了トレースの最大件数 | `500` |
| `METRICS_SAMPLES_MAX` | メモリ上に保持するメトリクスサンプルの最大件数 | `2000` |
| `OUTPUTS_BACKEND` | outputs 保存先 backend（`fs` / `s3`） | `fs` |
| `SF_AI_OUTPUTS_S3_BASE_URL` | `OUTPUTS_BACKEND=s3` 時の保存先 base URL（prefix 含む） | 未設定 |
| `SF_AI_OUTPUTS_S3_AUTH_HEADER` | `OUTPUTS_BACKEND=s3` 時の Authorization ヘッダ値（任意） | 未設定 |

## provenance / trace 保存

- `DATABASE_URL` が設定されていれば、execution origin / trace / metrics / drift report は Postgres に保存されます
- `outputs/execution-origins.jsonl` は互換 file fallback または test override 時のみ利用されます
- `repoRoots` は `repoPath`, `rootDir`, `filePath`, `filePaths` などの入力から近傍 `.git` をたどって推定されます
- 入力に repo 情報がない軽量ツールでは、server 側 repo root とカレント作業ディレクトリが主な手がかりになります

## 複数リポジトリでの併用時の推奨

同一マシンで複数の MCP サーバを立ち上げる場合、次を分離すると衝突を避けられます。

- `SF_AI_OUTPUTS_DIR`
- `PROMETHEUS_METRICS_PORT`
- `OTEL_SERVICE_NAME`

例:

- repo A: `PROMETHEUS_METRICS_PORT=9464`, `OTEL_SERVICE_NAME=salesforce-ai-company-a`
- repo B: `PROMETHEUS_METRICS_PORT=9465`, `OTEL_SERVICE_NAME=salesforce-ai-company-b`

<!-- AUTO-GOVERNANCE:START -->

## Governance Defaults (auto-generated)

> Source of truth: `mcp/core/governance/defaults.ts`. Run `npm run docs:config` after editing.

### `maxCounts`

| Resource | Limit |
| -------- | ----- |
| skills | 150 |
| tools | 150 |
| presets | 150 |

### `thresholds`

| Threshold | Value |
| --------- | ----- |
| minUsageToKeep | 2 |
| bugSignalToFlag | 2 |

### `resourceLimits` (per day)

| Operation | Limit |
| --------- | ----- |
| creationsPerDay | 5 |
| deletionsPerDay | 3 |

<!-- AUTO-GOVERNANCE:END -->
