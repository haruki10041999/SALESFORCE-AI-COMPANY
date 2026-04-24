# 設定ガイド（運用向け）

このページは「まず何を設定すれば動くか」を優先してまとめています。
技術的な詳細は後半に載せています。

## まずはこれだけ

通常運用では、次の 2 つだけ覚えれば十分です。

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | 実行ログや履歴の保存場所 | `outputs/` |
| `LOG_LEVEL` | ログの詳しさ（`error` / `warn` / `info` / `debug`） | `info` |

## よくある利用パターン

### 1. 保存先を別ディスクにしたい

```bash
SF_AI_OUTPUTS_DIR=D:/sf-ai-data/outputs npm run mcp:dev
```

### 2. 調査のため詳細ログを出したい

```bash
LOG_LEVEL=debug SF_AI_DEBUG_VERBOSE_PROMPT=true npm run mcp:dev
```

注意: `SF_AI_DEBUG_VERBOSE_PROMPT=true` はプロンプト本文まで出力するため、通常運用では `false` 推奨です。

## バックアップ関連

| 変数名 | 何に使うか | 既定値 |
|---|---|---|
| `SF_AI_OUTPUTS_BACKUP_DIR` | 世代バックアップの保存先 | `outputs/backups` |
| `SF_AI_OUTPUTS_BACKUP_KEEP` | 保持世代数（古い順に削除） | `5` |

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
| `SF_AI_OUTPUTS_BACKUP_DIR` | outputs 世代バックアップの保存先ディレクトリ | `outputs/backups` |
| `SF_AI_OUTPUTS_BACKUP_KEEP` | 保持する snapshot 世代数（古い世代から削除） | `5` |
| `SF_AI_MEMORY_FILE` | プロジェクトメモリストアの JSONL ファイルパス | `outputs/memory.jsonl` |
| `SF_AI_VECTOR_STORE_FILE` | ベクターストア永続化先の JSONL ファイルパス | `outputs/vector-store.jsonl` |
| `SF_AI_VECTOR_MAX_RECORDS` | メモリ/ディスク上に保持するベクターレコードの最大件数（LRU） | `5000` |
| `SF_AI_TRACE_FILE` | トレース履歴の永続化先 JSONL ファイルパス | `outputs/events/trace-log.jsonl` |
| `SF_AI_METRICS_FILE` | メトリクスサンプルの永続化先 JSONL ファイルパス | `outputs/events/metrics-samples.jsonl` |
| `LOG_LEVEL` | ログ出力レベル（`error` / `warn` / `info` / `debug`） | `info` |
| `SF_AI_DEBUG_VERBOSE_PROMPT` | `LOG_LEVEL=debug` 時にプロンプト本文までログ出力するか | `false` |
| `PROMPT_CACHE_MAX_ENTRIES` | メモリ上にキャッシュするプロンプトの最大件数 | `100` |
| `PROMPT_CACHE_TTL_SECONDS` | キャッシュエントリの有効期間（秒） | `60` |
| `SF_AI_AUTO_APPLY` | リソースハンドラー・閾値ハンドラーによる自動 apply を有効化 | `false` |
| `SF_AI_AUTO_APPLY_MIN_SCORE` | 自動 apply を実行する最低品質スコア（0〜100） | `70` |
| `SF_AI_AUTO_APPLY_MAX_PER_DAY` | 1日あたりの自動リソース作成上限件数 | `5` |
| `SF_AI_AUTO_APPLY_MAX_DELETIONS` | 1回の閾値ハンドリングで許可する削除件数の上限 | `3` |
| `EVENT_HISTORY_MAX` | EventDispatcher がメモリ上に保持するイベントの最大件数 | `1000` |
| `TRACE_HISTORY_MAX` | メモリ上に保持する完了トレースの最大件数 | `500` |
| `METRICS_SAMPLES_MAX` | メモリ上に保持するメトリクスサンプルの最大件数 | `2000` |
