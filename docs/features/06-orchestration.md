# オーケストレーションツール

複数エージェントによる疑似セッションを管理し、トリガールールに基づいてエージェントの発言順を自動制御するツール群です。

---

## オーケストレーションの概念

```
orchestrate_chat        ← セッション開始・初期キュー生成
      │
      └── evaluate_triggers   ← 各エージェント発言後にトリガーを評価
               │
               └── dequeue_next_agent  ← 次の担当エージェントをキューから取り出す
```

セッション状態はメモリ上に保持され、`save_orchestration_session` で `outputs/sessions/` に永続化できます。
中断後は `restore_orchestration_session` で再開可能です。

---

## orchestrate_chat

### 概要

オーケストレーションセッションを開始します。
セッション ID を生成し、エージェントキューを初期化して最初のプロンプトを生成します。

### 入力パラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `topic` | string | ✓ | — | セッションテーマ |
| `agents` | string[] | — | `["product-manager","architect","qa-engineer"]` | 参加エージェント名 |
| `persona` | string | — | — | セッション共通ペルソナ |
| `skills` | string[] | — | `[]` | 適用スキル |
| `turns` | number | — | `6` | 全体のターン数 |
| `triggerRules` | array | — | `[]` | トリガールール定義（後述） |

### triggerRules の構造

```typescript
{
  whenAgent: string;       // このエージェントが発言したとき
  thenAgent: string;       // このエージェントをキューに追加する
  messageIncludes?: string; // 発言にこのキーワードが含まれる場合のみ（大文字小文字無視）
  reason?: string;         // トリガー理由（ログ用）
  once?: boolean;          // true のとき同一ルールは1回のみ発火
}
```

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `sessionId` | string | 生成されたセッション ID（例: `orch-2026-04-23T10-00-00-000Z`） |
| `prompt` | string | 最初のプロンプト |
| `queue` | string[] | 初期エージェントキュー |

### 入力例

```text
orchestrate_chat:
  topic: "リリース準備レビュー"
  agents: ["product-manager", "architect", "qa-engineer"]
  turns: 6
  triggerRules:
    - whenAgent: "architect"
      thenAgent: "qa-engineer"
      messageIncludes: "テスト"
      reason: "設計議論後に品質確認"
      once: true
    - whenAgent: "qa-engineer"
      thenAgent: "security-engineer"
      messageIncludes: "セキュリティ"
      reason: "QA 指摘後にセキュリティ確認"
      once: false
```

---

## evaluate_triggers

### 概要

直前のエージェント発言に対してトリガールールを評価し、次にキューに追加すべきエージェントを返します。
`orchestrate_chat` 後に各エージェントの発言ごとに呼び出してください。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `sessionId` | string | ✓ | `orchestrate_chat` が返したセッション ID |
| `lastAgent` | string | ✓ | 直前に発言したエージェント名 |
| `lastMessage` | string | ✓ | 直前の発言内容 |
| `fallbackRoundRobin` | boolean | — | トリガーが発火しなかった場合に次のエージェントをラウンドロビンで追加するか |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `triggered` | string[] | 新たにキューに追加されたエージェント名 |
| `reasons` | string[] | 各トリガーの理由 |
| `queue` | string[] | 更新後のエージェントキュー |

### 入力例

```text
evaluate_triggers:
  sessionId: "orch-2026-04-23T10-00-00-000Z"
  lastAgent: "architect"
  lastMessage: "この実装には追加のテストが必要です"
  fallbackRoundRobin: true
```

---

## dequeue_next_agent

### 概要

エージェントキューの先頭から次の担当エージェントを取り出し、その会話プロンプトを生成します。

### 入力パラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `sessionId` | string | ✓ | — | セッション ID |
| `limit` | number | — | `1` | 一度に取り出すエージェント数（1〜5） |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `agents` | string[] | 取り出されたエージェント名 |
| `prompt` | string | 次のエージェントのプロンプト |
| `remainingQueue` | string[] | 残りのキュー |
| `done` | boolean | キューが空になった場合 `true` |

### 入力例

```text
dequeue_next_agent:
  sessionId: "orch-2026-04-23T10-00-00-000Z"
  limit: 2
```

---

## get_orchestration_session

### 概要

セッションの現在状態（キュー・発言履歴・トリガールール等）を取得します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `sessionId` | string | ✓ | セッション ID |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `sessionId` | string | セッション ID |
| `topic` | string | セッションテーマ |
| `agents` | string[] | 参加エージェント |
| `queue` | string[] | 現在のキュー |
| `history` | array | 発言履歴 |
| `triggerRules` | array | 定義されたトリガールール |
| `firedRules` | string[] | 発火済みルールキー |
| `turn` | number | 現在のターン数 |

### 入力例

```text
get_orchestration_session:
  sessionId: "orch-2026-04-23T10-00-00-000Z"
```

---

## save_orchestration_session

### 概要

メモリ上のセッション状態を `outputs/sessions/<sessionId>.json` に保存します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `sessionId` | string | ✓ | 保存するセッション ID |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `sessionId` | string | セッション ID |
| `filePath` | string | 保存先ファイルパス |
| `historyCount` | number | 保存された発言数 |

---

## restore_orchestration_session

### 概要

保存済みセッションをファイルから読み込みメモリに復元します。
セッションが既にメモリにある場合はそちらが優先されます。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `sessionId` | string | ✓ | 復元するセッション ID |

---

## 標準的なオーケストレーションループ

```
1. orchestrate_chat（セッション開始・初期プロンプト取得）
   └── sessionId を保存

2. ループ：
   a. dequeue_next_agent（次エージェントのプロンプトを取得）
   b. LLM にプロンプトを投げて発言を得る
   c. evaluate_triggers（トリガー評価・キュー更新）
   d. done: true になるまで繰り返す

3. save_orchestration_session（中断/完了時に保存）

4. 再開時: restore_orchestration_session（2のループを継続）
```

### 実装例（イメージ）

```text
# ステップ1
orchestrate_chat:
  topic: "リリース準備"
  agents: ["product-manager", "architect", "qa-engineer"]
  turns: 6

# セッション ID: orch-2026-04-23T10-00-00-000Z を取得

# ステップ2a
dequeue_next_agent:
  sessionId: "orch-2026-04-23T10-00-00-000Z"

# ステップ2c（LLM の返答を lastMessage に渡す）
evaluate_triggers:
  sessionId: "orch-2026-04-23T10-00-00-000Z"
  lastAgent: "product-manager"
  lastMessage: "..."
  fallbackRoundRobin: true

# ステップ3（中断時）
save_orchestration_session:
  sessionId: "orch-2026-04-23T10-00-00-000Z"

# 再開
restore_orchestration_session:
  sessionId: "orch-2026-04-23T10-00-00-000Z"
```

---

## 関連ドキュメント

- [docs/features/05-chat-generation.md](./05-chat-generation.md) — 単発・バッチプロンプト生成
- [docs/features/07-logging-history.md](./07-logging-history.md) — 発言履歴の記録と参照
- [docs/configuration.md](../configuration.md) — 環境変数一覧
