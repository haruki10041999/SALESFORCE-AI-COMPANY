# 設定リファレンス

ランタイムで参照される環境変数の一覧です。

| 変数名 | 用途 | デフォルト値 |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | イベント・履歴・セッション・ガバナンス・生成物の出力ベースディレクトリ | `outputs/` |
| `SF_AI_MEMORY_FILE` | プロジェクトメモリストアの JSONL ファイルパス | `outputs/memory.jsonl` |
| `SF_AI_VECTOR_STORE_FILE` | ベクターストア永続化先の JSONL ファイルパス | `outputs/vector-store.jsonl` |
| `SF_AI_VECTOR_MAX_RECORDS` | メモリ/ディスク上に保持するベクターレコードの最大件数（LRU） | `5000` |
| `SF_AI_TRACE_FILE` | トレース履歴の永続化先 JSONL ファイルパス | `outputs/events/trace-log.jsonl` |
| `SF_AI_METRICS_FILE` | メトリクスサンプルの永続化先 JSONL ファイルパス | `outputs/events/metrics-samples.jsonl` |
| `LOG_LEVEL` | ログ出力レベル（`error` / `warn` / `info` / `debug`） | `info` |
| `PROMPT_CACHE_MAX_ENTRIES` | メモリ上にキャッシュするプロンプトの最大件数 | `100` |
| `PROMPT_CACHE_TTL_SECONDS` | キャッシュエントリの有効期間（秒） | `60` |
| `SF_AI_AUTO_APPLY` | リソースハンドラー・閾値ハンドラーによる自動 apply を有効化 | `false` |
| `SF_AI_AUTO_APPLY_MIN_SCORE` | 自動 apply を実行する最低品質スコア（0〜100） | `70` |
| `SF_AI_AUTO_APPLY_MAX_PER_DAY` | 1日あたりの自動リソース作成上限件数 | `5` |
| `SF_AI_AUTO_APPLY_MAX_DELETIONS` | 1回の閾値ハンドリングで許可する削除件数の上限 | `3` |
| `EVENT_HISTORY_MAX` | EventDispatcher がメモリ上に保持するイベントの最大件数 | `1000` |
| `TRACE_HISTORY_MAX` | メモリ上に保持する完了トレースの最大件数 | `500` |
| `METRICS_SAMPLES_MAX` | メモリ上に保持するメトリクスサンプルの最大件数 | `2000` |

## プロンプトキャッシュ

`buildChatPromptFromContext` は同一入力に対する Markdown ファイルの重複 I/O を避けるため、LRU キャッシュを内蔵しています。
以下の環境変数で動作を調整できます。

- **`PROMPT_CACHE_MAX_ENTRIES`**（デフォルト: `100`）: キャッシュの最大エントリ数。超えた場合は最も古いエントリが追い出されます（LRU）。
- **`PROMPT_CACHE_TTL_SECONDS`**（デフォルト: `60`）: キャッシュエントリの有効期間。アクセス時に期限切れのエントリは自動削除されます。

同じトピック・エージェント・スキルの組み合わせが短時間内に繰り返される場合に特に有効です。

### 設定例

```bash
SF_AI_OUTPUTS_DIR=/data/sf-ai/outputs \
SF_AI_MEMORY_FILE=/data/sf-ai/outputs/memory.jsonl \
SF_AI_VECTOR_STORE_FILE=/data/sf-ai/outputs/vector-store.jsonl \
PROMPT_CACHE_MAX_ENTRIES=200 \
PROMPT_CACHE_TTL_SECONDS=120 \
LOG_LEVEL=debug \
npm run mcp:dev
```
