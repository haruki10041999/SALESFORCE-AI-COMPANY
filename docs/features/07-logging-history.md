# ログ・履歴ツール

エージェント発言の記録・参照・会話履歴の保存/復元・Markdown エクスポート・トレンド分析を行うツール群です。
記録はメモリ上のログ配列（`agentLog`）に保持され、`save_chat_history` で `outputs/history/` に永続化されます。

---

## record_agent_message

### 概要

エージェントの発言を1件メモリログに追記します。
オーケストレーションループで各エージェントの返答を記録する際に使用します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `agent` | string | ✓ | 発言エージェント名 |
| `message` | string | ✓ | 発言内容 |
| `topic` | string | — | 会話トピック（後で `get_agent_log` のフィルタ条件として使用可） |

### 出力例

```json
{ "recorded": true, "timestamp": "2026-04-23T10:05:00.000Z", "agent": "architect" }
```

---

## get_agent_log

### 概要

メモリ上のログから発言履歴を取得します。

### 入力パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `agent` | string | — | 指定するとそのエージェントの発言のみ返す |
| `limit` | number | 全件 | 返す最大件数（1〜200） |

### 出力例

```json
[
  {
    "agent": "architect",
    "message": "設計案を更新しました",
    "timestamp": "2026-04-23T10:05:00.000Z",
    "topic": "release-review"
  }
]
```

---

## parse_and_record_chat

### 概要

`**AgentName**: message` 形式の複数行テキストを一括パースしてログに追記します。
オーケストレーション結果をまとめてログに流し込む際に使用します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `topic` | string | ✓ | 会話トピック |
| `chatText` | string | ✓ | パース対象のテキスト（`**AgentName**: message` 形式） |

### 入力テキスト形式

```
**architect**: 設計修正します
**qa-engineer**: 回帰テスト追加します
**security-engineer**: SOQL インジェクション対策を確認してください
```

### 入力例

```text
parse_and_record_chat:
  topic: "release-review"
  chatText: "**architect**: 設計修正します\n**qa-engineer**: 回帰テスト追加します"
```

---

## analyze_chat_trends

### 概要

現在のメモリログ全体を集計し、エージェント別の発言件数・平均文字数・トピック別の分布を返します。

### 入力パラメータ

なし（空オブジェクト可）

### 出力例

```json
{
  "totalMessages": 24,
  "byAgent": [
    { "agent": "architect", "count": 8, "avgLength": 320, "topics": ["release-review"] },
    { "agent": "qa-engineer", "count": 6, "avgLength": 180, "topics": ["release-review"] }
  ]
}
```

---

## save_chat_history

### 概要

現在のメモリログを `outputs/history/<id>.json` に保存します。
保存後は `history_saved` システムイベントが発行されます。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `topic` | string | ✓ | 保存する履歴のトピック名（ファイル名に使用） |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `saved` | boolean | 保存成功 |
| `id` | string | 生成された履歴 ID（例: `2026-04-23-101500`） |
| `path` | string | 保存先ファイルパス |

### 入力例

```text
save_chat_history:
  topic: "release-review"
```

---

## load_chat_history

### 概要

保存済み履歴の一覧を返します。

### 入力パラメータ

なし

### 出力例

```json
[
  {
    "id": "2026-04-23-101500",
    "timestamp": "2026-04-23T10:15:00.000Z",
    "topic": "release-review",
    "agents": ["architect", "qa-engineer"],
    "entryCount": 8
  }
]
```

---

## restore_chat_history

### 概要

保存済み履歴をメモリログに復元します。
復元後は `get_agent_log` で参照可能になります。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `id` | string | ✓ | `load_chat_history` で取得した履歴 ID |

### 入力例

```text
restore_chat_history:
  id: "2026-04-23-101500"
```

---

## export_to_markdown

### 概要

現在のメモリログまたは保存済み履歴を Markdown ファイルとして生成します。
`outputPath` を指定するとファイルに書き出し、省略すると Markdown 文字列を直接返します。

### 入力パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `historyId` | string | 対象履歴 ID（省略時は現在のメモリログ） |
| `title` | string | Markdown のタイトル |
| `outputPath` | string | ファイル書き出し先パス（省略時は返却のみ） |

### 出力例（抜粋）

```markdown
# リリース準備レビュー

**Exported**: 2026-04-23T10:20:00.000Z

---

## architect

> 設計修正します

---

## qa-engineer

> 回帰テスト追加します
```

---

## get_handlers_dashboard

### 概要

ガバナンスハンドラー（リソースハンドラー・閾値ハンドラー等）の稼働統計を取得します。

### 入力パラメータ

なし

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `handlers` | array | ハンドラーごとの実行回数・成功/失敗数 |
| `lastRun` | string | 最後の実行日時 |

---

## 推奨ワークフロー

### セッション記録の標準フロー

```
1. orchestrate_chat でセッション開始
2. 各エージェント発言後に record_agent_message
   （または parse_and_record_chat でまとめて記録）
3. save_chat_history でファイルに保存
4. export_to_markdown で成果物を生成
```

### 長期セッションの中断・再開

```
1. save_chat_history（現在の発言を保存）
2. save_orchestration_session（セッション状態を保存）
-- 後日 --
3. load_chat_history でどの履歴か確認
4. restore_chat_history（発言ログを復元）
5. restore_orchestration_session（セッション状態を復元）
6. オーケストレーションループを再開
```

---

## 関連ドキュメント

- [docs/features/06-orchestration.md](./06-orchestration.md) — オーケストレーションセッション管理
- [docs/features/10-event-automation.md](./10-event-automation.md) — システムイベントの参照
- [docs/configuration.md](../configuration.md) — 環境変数一覧
