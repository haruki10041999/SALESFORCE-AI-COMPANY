# データ保存と生成物ガイド

このページは、現在の保存方針を非エンジニア向けにまとめた運用説明です。

## まず理解したいこと

- 永続データの既定保存先は Postgres (`DATABASE_URL`) です。
- 互換 fallback (file backend / test override) を除き、履歴・イベント・提案・学習ログは DB に保存されます。
- `outputs/` は「主データの保存先」ではなく、生成物と互換ファイルの置き場です。

## どこに保存されるか

| 種別 | 既定保存先 | fallback / 補足 |
|---|---|---|
| チャット履歴 | Postgres (history store) | file backend 時は `outputs/history/` |
| Orchestration セッション | Postgres (session store) | file backend 時は `outputs/sessions/` |
| System Events | Postgres `system_events` | fallback: `outputs/events/system-events.jsonl` |
| Trace ログ | Postgres `trace_logs` | fallback: `outputs/events/trace-log.jsonl` |
| 実行 provenance | Postgres `execution_origins` | fallback: `outputs/execution-origins.jsonl` |
| Proposal queue | pg-boss / Postgres | file backend 時は `outputs/tool-proposals/` |
| ガバナンス状態 | Postgres (state backend) | sqlite/file backend 時は `outputs/resource-governance.json` など |
| メモリ / ベクトル | Postgres / PGVector | fallback: `outputs/memory.jsonl`, `outputs/vector-store.jsonl` |

## `outputs/` を使うケース

- 生成レポート: 既定では保存しません（レスポンス返却のみ）。必要時のみ `reportOutputDir` 指定で保存。
- ダッシュボード出力: 既定では保存しません。必要時のみ `write=true` で保存。
- ベンチマーク成果物: 既定では保存しません。エクスポート運用時のみ明示保存。
- 一時的な互換ファイルや手動検証の出力（運用で無効化可能）

### 書き込み制約 (T-25)

- アプリケーションの `OutputsArtifactWriter` は、原則として以下の生成物プレフィックスのみ書き込みを許可します。
- 許可プレフィックス: `reports/`, `dashboards/`, `exports/`, `recordings/`, `backups/`, `setup/`
- それ以外の state 系パス (例: `trigger-rules.json`, `audit/*.jsonl`) は禁止されます。
- 監査/実行 provenance は DB 優先で保存され、互換 fallback は専用 API (`appendAuditArtifact`, `appendExecutionOrigin`) のみで扱います。
- チャット履歴の file fallback は既定で無効です。必要な場合のみ `SF_AI_HISTORY_FILE_FALLBACK=true` を設定します。
- プロジェクトメモリの `outputs/memory.jsonl` fallback は既定で無効です。必要な場合のみ `SF_AI_ALLOW_OUTPUTS_STATE_FALLBACK=true` または `SF_AI_MEMORY_FILE` で明示設定します。
- System Events の `outputs/events/system-events.jsonl` fallback は既定で無効です。必要な場合のみ `SF_AI_EVENTS_FILE_FALLBACK=true` を設定します。
- Preset 保存の file fallback は既定で無効です。必要な場合のみ `SF_AI_PRESET_FILE_FALLBACK=true` を設定します。
- Proposal 適用時の Custom Tool/Preset ファイル反映は既定で無効です。必要な場合のみ `SF_AI_CUSTOM_TOOL_FILE_FALLBACK=true` / `SF_AI_PRESET_FILE_FALLBACK=true` を設定します。
- `npm run ai -- scaffold -- preset ...` / `tool ...` は runtime state を直接作らず、既定では `outputs/setup/scaffold/` 配下に雛形を書き出します。

## API レスポンスでの保存有無の見分け方

- レポート系ツールは `persisted: boolean` を返します。
- 補足情報として `persistenceNotice: string` を返します。
- `persisted=true` のときだけ `reportJsonPath` / `reportMarkdownPath` をファイルパスとして扱ってください。
- `persisted=false` のときは、`reportJsonPath` / `reportMarkdownPath` は空文字を許容し、ファイル存在チェックを行わないでください。
- ダッシュボード系は `write=true` のときのみ保存され、`persisted` と `writtenTo` が有効になります。

推奨判定順序:

1. `persisted` を最優先で判定
2. 必要に応じて `persistenceNotice` をログ出力
3. `persisted=true` の場合のみ `report*Path` / `writtenTo` を利用

## 運用コマンド

```bash
# ヘルスチェック
npm run ai -- doctor

# 生成物整理（まず dry-run）
npm run ai -- outputs:cleanup -- --dry-run

# 生成物のスナップショット管理
npm run ai -- outputs:version -- backup
npm run ai -- outputs:version -- list
```

## 障害時の最短手順

1. `npm run ai -- doctor`
2. Postgres の `system_events`, `trace_logs`, `execution_origins` を確認
3. 生成物に依存する障害なら `outputs:version` で復元
4. 再度 `doctor` を実行

## 補足

- 互換 fallback は段階的に縮退中です。
- 旧運用資産や削除ゲートは `docs/observability-cleanup-playbook.md` を参照してください。

## 生成物を作らない運用について

- 現在の既定動作は「DB 参照してレスポンス返却のみ」です。ファイル保存は明示指定時のみ行います。
- 既存の `latest.json` / `latest.md` / HTML を前提にした外部連携がある場合は、呼び出し側で保存先指定を有効化してください。