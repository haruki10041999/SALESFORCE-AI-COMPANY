# 会話生成ツール

エージェント・スキル・ペルソナを組み合わせてマルチエージェント会話プロンプトを生成するツール群です。
これらのツールはプロンプト文字列を**返す**ツールであり、AI 推論そのものは行いません。
返されたプロンプトを LLM クライアントに渡すことでマルチエージェント議論を開始します。

---

## chat / simulate_chat

### 概要

指定したエージェント・スキル・ペルソナを組み合わせて会話プロンプトを生成します。
`simulate_chat` は `chat` の完全互換エイリアスです。

### 入力パラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `topic` | string | ✓ | — | 会話テーマ |
| `agents` | string[] | — | `["product-manager","architect","qa-engineer"]` | 参加エージェント名（`agents/` ディレクトリのファイル名、拡張子なし） |
| `persona` | string | — | — | ペルソナ名（`personas/` ディレクトリのファイル名） |
| `skills` | string[] | — | `[]` | 適用スキル名（例: `"apex/apex-best-practices"`） |
| `filePaths` | string[] | — | `[]` | コンテキストとして渡すファイルパス一覧 |
| `turns` | number | — | `6` | 生成するプロンプトの会話ターン数 |
| `maxContextChars` | number | — | — | コンテキスト文字数の上限（500〜200000） |
| `appendInstruction` | string | — | — | プロンプト末尾に追加する補足指示 |

### 利用可能なエージェント名

```
apex-developer, architect, ceo, data-modeler, debug-specialist,
devops-engineer, documentation-writer, flow-specialist,
integration-developer, lwc-developer, performance-engineer,
product-manager, qa-engineer, refactor-specialist, release-manager,
repository-analyst, security-engineer
```

### 利用可能なペルソナ名

```
archivist, captain, commander, detective, diplomat, doctor,
engineer, gardener, hacker, historian, inventor, jedi,
samurai, speed-demon, strategist
```

### 入力例（基本）

```text
chat:
  topic: "Apex トリガー最適化"
  agents: ["architect", "qa-engineer"]
  skills: ["apex/apex-best-practices"]
  turns: 4
```

### 入力例（ペルソナ・補足指示付き）

```text
chat:
  topic: "パフォーマンス改善"
  agents: ["performance-engineer", "architect"]
  persona: "speed-demon"
  turns: 6
  appendInstruction: "バルク処理とキャッシュ活用を必ず評価してください"
```

### 出力

生成された会話プロンプト文字列（`content[0].text`）を返します。

---

## smart_chat

### 概要

リポジトリを自動解析して関連ファイルを検出し、それをコンテキストに含めたプロンプトを生成します。
`chat` との違いは、`repoPath` を指定すると `repo_analyze` が自動実行され、
検出された Apex・LWC・オブジェクトファイルの先頭をコンテキストに自動追加する点です。

トピック文字列内にファイルパスが含まれている場合（Windows/Unix 両形式対応）、
そのファイルが存在すれば自動的にコンテキストに取り込まれます。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `topic` | string | ✓ | 会話テーマ |
| `agents` | string[] | — | 参加エージェント名（デフォルト: `["product-manager","architect","qa-engineer"]`） |
| `persona` | string | — | ペルソナ名 |
| `skills` | string[] | — | 適用スキル名 |
| `repoPath` | string | — | 解析対象リポジトリパス（省略時はサーバー起動ディレクトリ） |
| `maxContextChars` | number | — | コンテキスト文字数の上限（500〜200000） |
| `appendInstruction` | string | — | プロンプト末尾に追加する補足指示 |

### 自動コンテキスト収集の動作

1. `topic` 文字列からファイルパスを抽出して存在確認
2. `repoPath`（または起動ルート）に対して `repo_analyze` を実行
3. Apex・LWC・Object の先頭 1 件ずつをコンテキストに追加
4. `repo_analyze` 失敗時は空配列で継続（エラーにならない）

### 入力例

```text
smart_chat:
  topic: "権限設計レビュー"
  repoPath: "D:/Projects/my-salesforce-project"
  skills: ["security/apex-sharing"]
  appendInstruction: "権限過剰付与リスクを重点確認"
```

### 入力例（ファイルパスをトピックに含める）

```text
smart_chat:
  topic: "D:/Projects/my-salesforce-project/force-app/main/default/classes/AccountService.cls のレビュー"
  agents: ["security-engineer", "architect"]
```

---

## batch_chat

### 概要

複数トピックを一度にプロンプト化してまとめて返します。
各トピックに個別のエージェント・補足指示を設定できる `topicConfigs` モードと、
シンプルな `topics` 配列モードに対応します。

### 入力パラメータ

| パラメータ | 型 | 制約 | 説明 |
|---|---|---|---|
| `topics` | string[] | 1〜10件 | シンプルモード: トピック文字列の配列 |
| `topicConfigs` | array | 1〜10件 | 詳細モード: `{ topic, agents?, appendInstruction? }` の配列 |
| `agents` | string[] | — | 全トピック共通のエージェント（`topicConfigs` の個別設定で上書き可） |
| `persona` | string | — | 全トピック共通のペルソナ |
| `skills` | string[] | — | 全トピック共通のスキル |
| `maxContextChars` | number | 500〜200000 | コンテキスト文字数の上限 |
| `appendInstruction` | string | — | 全トピック共通の補足指示 |
| `parallel` | boolean | — | `true` のとき全トピックを並行処理（デフォルト: 逐次） |

`topics` と `topicConfigs` は同時指定不可です。`topicConfigs` が優先されます。

### 入力例（シンプルモード）

```text
batch_chat:
  topics: ["Apex レビュー", "LWC レビュー", "権限レビュー"]
  agents: ["architect", "qa-engineer"]
  appendInstruction: "各トピックでテスト観点を1つ以上提示"
```

### 入力例（詳細モード・並行処理）

```text
batch_chat:
  topicConfigs:
    - topic: "Apex セキュリティレビュー"
      agents: ["security-engineer", "apex-developer"]
      appendInstruction: "SOQL インジェクションと without sharing を重点確認"
    - topic: "LWC パフォーマンス改善"
      agents: ["lwc-developer", "performance-engineer"]
      appendInstruction: "renderedCallback とメモリリークを評価"
  parallel: true
```

### 出力

`# Batch Report` ヘッダーの後にトピックごとのプロンプトを `---` で区切って連結した文字列を返します。

---

## プロンプトキャッシュ

`buildChatPromptFromContext` は同一入力に対する重複 I/O を避けるため LRU キャッシュを持ちます。

| 環境変数 | デフォルト | 説明 |
|---|---|---|
| `PROMPT_CACHE_MAX_ENTRIES` | `100` | キャッシュの最大エントリ数 |
| `PROMPT_CACHE_TTL_SECONDS` | `600` | キャッシュエントリの有効期間（秒） |
| `AI_PROMPT_CACHE_MAX_ENTRIES` | `100` | `PROMPT_CACHE_MAX_ENTRIES` の新名称（優先して参照） |
| `AI_PROMPT_CACHE_TTL_SECONDS` | `600` | `PROMPT_CACHE_TTL_SECONDS` の新名称（優先して参照） |

同じトピック・エージェント・スキルの組み合わせが短時間内に繰り返される場合は自動的にキャッシュが使われます。

### キャッシュ無効化

`invalidateBuildChatPromptCache` を使うことで、条件に一致するキャッシュだけを部分的に無効化できます。

- `agentNames`
- `skillNames`
- `filePaths`
- `topic`
- `personaName`

例: スキル更新時に対象スキルだけキャッシュを無効化

```ts
invalidateBuildChatPromptCache({ skillNames: ["apex/apex-best-practices"] });
```

### キャッシュメトリクス

`summarize_metrics` の `promptCache` フィールドで以下を確認できます。

- `hits`: キャッシュヒット回数
- `misses`: キャッシュミス回数（期限切れ含む）
- `hitRate`: ヒット率
- `evictions`: 上限超過による追い出し回数
- `expirations`: TTL 期限切れ回数
- `size`: 現在のキャッシュ件数
- `maxSize`: 設定上の最大キャッシュ件数

---

## 関連ドキュメント

- [docs/features/06-orchestration.md](./06-orchestration.md) — マルチターン・トリガーによる自動エージェント切り替え
- [docs/features/08-presets-definitions.md](./08-presets-definitions.md) — エージェント/スキル/ペルソナの定義確認
- [docs/configuration.md](../configuration.md) — 環境変数一覧
