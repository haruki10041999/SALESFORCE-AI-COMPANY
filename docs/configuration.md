# 設定ガイド（運用向け）

このページは「まず何を設定すれば動くか」を優先してまとめています。
技術的な詳細は後半に載せています。

## まずはこれだけ

通常運用では、次の 2 つだけ覚えれば十分です。

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | 実行ログや履歴の保存場所 | `outputs/` |
| `SF_AI_HISTORY_SQLITE` | 履歴ストアを SQLite へ切り替える（`true`/`false`） | `false` |
| `SF_AI_STATE_DB_PATH` | SQLite DB ファイルの保存先（`SF_AI_HISTORY_SQLITE=true` 時） | `outputs/state.sqlite` |
| `LOG_LEVEL` | ログの詳しさ（`error` / `warn` / `info` / `debug`） | `info` |
| `SF_AI_LOCALE` | エラーメッセージ等のローカライズ言語（`ja` / `en`） | `ja` |
| `AI_LOW_RELEVANCE_THRESHOLD` | 低関連度判定のしきい値（高いほど厳格） | `6` |
| `AI_AGENT_TRUST_SCORING_ENABLED` | エージェント信頼スコアによる自動エスカレーションを有効化 | `false` |
| `AI_AGENT_TRUST_THRESHOLD` | 信頼スコアの閾値（0.0〜1.0） | `0.55` |

補足:

- SQLite 実装は `sql.js` を利用しています（native addon 不要）
- 既定の DB ファイル名は `state.sqlite` で統一しています
- 既存 JSONL/history から移行する場合は `npm run state:migrate-sqlite`
- 互換 JSONL を再出力する場合は `npm run state:export-jsonl -- --out-dir <dir>`
- 再出力時に元 JSONL 件数と突合する場合は `--verify-source-dir <outputsDir>` を付与（不一致時は終了コード 1）

## よくある利用パターン

### 1. 保存先を別ディスクにしたい

```bash
SF_AI_OUTPUTS_DIR=D:/sf-ai-data/outputs npm run ai -- dev
```

補足:

- `SF_AI_OUTPUTS_DIR` はサーバープロセス側で解決されます
- 絶対パスを使えば、別リポジトリから同じ MCP サーバーを使っても出力先を共通化できます
- 実行 provenance は `outputs/execution-origins.jsonl` に追記されます

### 2. 調査のため詳細ログを出したい

```bash
LOG_LEVEL=debug SF_AI_DEBUG_VERBOSE_PROMPT=true npm run ai -- dev
```

注意: `SF_AI_DEBUG_VERBOSE_PROMPT=true` はプロンプト本文まで出力するため、通常運用では `false` 推奨です。

## 推奨プロファイル

用途別に、次のサンプルをベースに `.env` を作成できます。

- ローカル開発向け: `../.env.local.sample`
- 運用向け（可観測性重視）: `../.env.operations.sample`

例 (PowerShell):

```powershell
Copy-Item .env.local.sample .env
# または
Copy-Item .env.operations.sample .env
```

## バックアップ関連

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_OUTPUTS_BACKUP_DIR` | 世代バックアップの保存先 | `outputs/backups` |
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

## フル一覧（管理者向け）

| 変数名 | 用途 | デフォルト値 |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | イベント・履歴・セッション・ガバナンス・生成物の出力ベースディレクトリ | `outputs/` |
| `SF_AI_HISTORY_SQLITE` | 履歴ストアを SQLite (`sql.js`) に切り替えるフラグ（`true`/`false`） | `false` |
| `SF_AI_STATE_DB_PATH` | SQLite DB ファイルパス（`SF_AI_HISTORY_SQLITE=true` 時に利用） | `outputs/state.sqlite` |
| `SF_AI_OUTPUTS_BACKUP_DIR` | outputs 世代バックアップの保存先ディレクトリ | `outputs/backups` |
| `SF_AI_OUTPUTS_BACKUP_KEEP` | 保持する snapshot 世代数（古い世代から削除） | `5` |
| `SF_AI_MEMORY_FILE` | プロジェクトメモリストアの JSONL ファイルパス | `outputs/memory.jsonl` |
| `SF_AI_VECTOR_STORE_FILE` | ベクターストア永続化先の JSONL ファイルパス | `outputs/vector-store.jsonl` |
| `SF_AI_VECTOR_MAX_RECORDS` | メモリ/ディスク上に保持するベクターレコードの最大件数（LRU） | `5000` |
| `SF_AI_TRACE_FILE` | トレース履歴の永続化先 JSONL ファイルパス | `outputs/events/trace-log.jsonl` |
| `SF_AI_METRICS_FILE` | メトリクスサンプルの永続化先 JSONL ファイルパス | `outputs/events/metrics-samples.jsonl` |
| `SF_AI_AUTO_MEMORY` | チャット/ツール実行のたびに input/output サマリを `memory.jsonl` と `vector-store.jsonl` へ自動追記する。`1`/`true`/`on`/`yes` で有効。memory/vector 系ツール自身は再帰防止のため除外 | `false` |
| `SF_AI_PROGRESS_BANNER` | ツール応答テキストの先頭に進捗タイムライン (フェーズ別開始時刻・所要時間) を追加表示する。`false`/`0`/`off`/`no` で無効。`get_tool_progress` / `ping` は対象外 | `true` |
| `LOG_LEVEL` | ログ出力レベル（`error` / `warn` / `info` / `debug`） | `info` |
| `SF_AI_DEBUG_VERBOSE_PROMPT` | `LOG_LEVEL=debug` 時にプロンプト本文までログ出力するか | `false` |
| `SF_AI_LOCALE` | `AppError` 等のローカライズ言語（`ja` / `en`）。未対応値は `ja` にフォールバック (TASK-F8) | `ja` |
| `SF_AI_DOTENV_DISABLE` | `.env` 自動読込を無効化する (`1` で無効) | `0` |
| `SF_AI_DOTENV_PATH` | 読み込む `.env` のパスを明示指定（指定時は優先） | 未設定 |
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
| `SF_AI_AUTO_APPLY` | リソースハンドラー・閾値ハンドラーによる自動 apply を有効化 | `false` |
| `SF_AI_AUTO_APPLY_MIN_SCORE` | 自動 apply を実行する最低品質スコア（0〜100） | `70` |
| `SF_AI_AUTO_APPLY_MAX_PER_DAY` | 1日あたりの自動リソース作成上限件数 | `5` |
| `SF_AI_AUTO_APPLY_MAX_DELETIONS` | 1回の閾値ハンドリングで許可する削除件数の上限 | `3` |
| `OLLAMA_REQUIRED` | `true` の場合、Ollama が利用不可なら起動を中断する | `false` |
| `SF_AI_BENCHMARK_TRACE_LIMIT` | `benchmark-suite` が参照する直近 trace 件数 | `300` |
| `EVENT_HISTORY_MAX` | EventDispatcher がメモリ上に保持するイベントの最大件数 | `1000` |
| `TRACE_HISTORY_MAX` | メモリ上に保持する完了トレースの最大件数 | `500` |
| `METRICS_SAMPLES_MAX` | メモリ上に保持するメトリクスサンプルの最大件数 | `2000` |

## outputs provenance

- `outputs/execution-origins.jsonl` には、各ツール実行について `toolName`, `status`, `serverRoot`, `processCwd`, `repoRoots`, `inputPathHints` が追記されます
- `repoRoots` は `repoPath`, `rootDir`, `filePath`, `filePaths` などの入力から近傍 `.git` をたどって推定されます
- 入力に repo 情報がない軽量ツールでは、server 側 repo root とカレント作業ディレクトリが主な手がかりになります

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
