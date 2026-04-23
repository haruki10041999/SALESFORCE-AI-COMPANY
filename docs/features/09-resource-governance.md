# リソースガバナンスツール

スキル・ツール・プリセットの横断検索・利用状況追跡・閾値管理・一括 CRUD 操作を行うツール群です。
ガバナンス状態は `outputs/resource-governance.json` に保持されます。

---

## ガバナンスの概念

```
リソース種別: skills / tools / presets

┌─────────────────────────────┐
│ governance-state.json        │
│  - config                   │  ← 最大件数・閾値設定
│  - disabled                 │  ← 無効化されたリソース一覧
│  - usage                    │  ← 利用回数カウンタ
│  - bugSignals               │  ← バグシグナルカウンタ
└─────────────────────────────┘
```

---

## search_resources

### 概要

スキル・ツール・プリセットを横断検索し、クエリとの関連スコアが高い順に返します。
カスタムツールの `tags` フィールドも検索スコアに影響します。

### 入力パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `query` | string | — | 検索クエリ文字列 |
| `resourceTypes` | string[] | `["skills","tools","presets"]` | 検索対象の種別 |
| `limitPerType` | number | `5` | 種別ごとの返却件数上限（1〜20） |
| `includeDisabled` | boolean | `true` | 無効化されたリソースを含めるか |

### 出力例

```json
{
  "skills": [
    { "name": "security/apex-sharing", "summary": "...", "score": 0.85, "disabled": false }
  ],
  "tools": [
    { "name": "apex_analyze", "title": "Apex Analyzer", "description": "...", "score": 0.72, "disabled": false }
  ],
  "presets": [
    { "name": "Salesforce 開発レビュー", "description": "...", "score": 0.68 }
  ]
}
```

### 入力例

```text
search_resources:
  query: "security review"
  resourceTypes: ["skills", "tools"]
  limitPerType: 5
```

---

## auto_select_resources

### 概要

トピックに対して最適なエージェント・スキル・プリセットを自動選択します。
`search_resources` の上位層として、トピックに関連するリソースを一括推薦します。

### 入力パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `topic` | string | — | 推薦対象のトピック |
| `limitPerType` | number | `3` | 種別ごとの推薦件数上限 |

### 入力例

```text
auto_select_resources:
  topic: "Salesforce セキュリティレビュー"
  limitPerType: 3
```

---

## get_resource_governance

### 概要

現在のガバナンス状態全体（設定・無効化一覧・利用回数・バグシグナル）を返します。

### 入力パラメータ

なし

### 出力例（抜粋）

```json
{
  "updatedAt": "2026-04-23T10:00:00.000Z",
  "config": {
    "maxCounts": { "skills": 100, "tools": 100, "presets": 100 },
    "thresholds": { "minUsageToKeep": 1, "bugSignalToFlag": 3 }
  },
  "disabled": {
    "skills": ["debug/deprecated-approach"],
    "tools": [],
    "presets": []
  },
  "usage": {
    "skills": { "apex/apex-best-practices": 12 },
    "tools": { "apex_analyze": 8 }
  }
}
```

---

## record_resource_signal

### 概要

リソースの利用回数またはバグシグナルを記録します。
閾値を超えると `governance_threshold_exceeded` システムイベントが発行されます。

### 入力パラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `resourceType` | string | ✓ | — | `"skills"` / `"tools"` / `"presets"` |
| `name` | string | ✓ | — | リソース名 |
| `signal` | string | ✓ | — | `"used"`（利用）または `"bug"`（バグ報告） |

### 入力例（利用記録）

```text
record_resource_signal:
  resourceType: "skills"
  name: "apex/apex-best-practices"
  signal: "used"
```

### 入力例（バグ報告）

```text
record_resource_signal:
  resourceType: "tools"
  name: "apex_analyze"
  signal: "bug"
```

---

## review_resource_governance

### 概要

ガバナンス設定の最大件数・閾値を更新します。
`minUsageToKeep` 未満の利用回数のリソースは次回の自動整理候補になります。

### 入力パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `updateMaxCounts` | object | `{ skills?, tools?, presets? }` — 最大件数の更新 |
| `updateThresholds` | object | `{ minUsageToKeep?, bugSignalToFlag? }` — 閾値の更新 |

### 入力例

```text
review_resource_governance:
  updateMaxCounts:
    skills: 150
    tools: 150
    presets: 150
  updateThresholds:
    minUsageToKeep: 2
    bugSignalToFlag: 2
```

---

## apply_resource_actions

### 概要

リソースの作成・削除・無効化・有効化を一括実行します。
実行ログは `outputs/audit/resource-actions.jsonl` に自動追記されます。
デイリー制限（`SF_AI_AUTO_APPLY_MAX_PER_DAY`, `SF_AI_AUTO_APPLY_MAX_DELETIONS`）を超える場合はエラーになります。

### 入力パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `actions` | array | — | 実行するアクションの配列 |
| `dryRun` | boolean | `false` | `true` のとき変更せず検証のみ |

`actions` 配列の各要素:

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `resourceType` | string | ✓ | `"skills"` / `"tools"` / `"presets"` |
| `action` | string | ✓ | `"create"` / `"delete"` / `"disable"` / `"enable"` |
| `name` | string | ✓ | リソース名 |
| `content` | string | — | `action: create` かつ `resourceType: skills` のとき Markdown コンテンツ |

### アクション別の動作

| action | 動作 |
|---|---|
| `create` | スキルは `skills/` に Markdown を書き出す。プリセットは `outputs/presets/` に JSON を書き出す。ツールはカスタムツールとして登録 |
| `delete` | スキル/プリセットファイルを削除。ガバナンス状態からも削除 |
| `disable` | ガバナンス状態の `disabled` リストに追加 |
| `enable` | ガバナンス状態の `disabled` リストから削除 |

### 入力例

```text
apply_resource_actions:
  actions:
    - resourceType: "skills"
      action: "create"
      name: "security/apex-sharing-review"
      content: "# Apex Sharing Review\n\nCheck without sharing and CRUD/FLS."
    - resourceType: "tools"
      action: "disable"
      name: "run_tests"
    - resourceType: "presets"
      action: "enable"
      name: "Salesforce 開発レビュー"
```

### 入力例（ドライラン）

```text
apply_resource_actions:
  dryRun: true
  actions:
    - resourceType: "skills"
      action: "delete"
      name: "debug/deprecated-approach"
```

---

## ガバナンス関連の環境変数

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `SF_AI_AUTO_APPLY` | `false` | ハンドラーによる自動 apply を有効化 |
| `SF_AI_AUTO_APPLY_MIN_SCORE` | `70` | 自動 apply の最低品質スコア |
| `SF_AI_AUTO_APPLY_MAX_PER_DAY` | `5` | 1日あたりの自動作成上限 |
| `SF_AI_AUTO_APPLY_MAX_DELETIONS` | `3` | 1回の apply で許可する削除件数上限 |

---

## 推奨ワークフロー

### リソースのメンテナンスフロー

```
1. get_resource_governance       # 現在の状態・利用回数を確認
2. review_resource_governance    # 閾値を調整（必要に応じて）
3. apply_resource_actions        # 整理（削除・無効化）を実行
4. get_handlers_dashboard        # ハンドラー統計を確認（docs/features/07-logging-history.md）
```

---

## 関連ドキュメント

- [docs/features/08-presets-definitions.md](./08-presets-definitions.md) — プリセット管理
- [docs/features/10-event-automation.md](./10-event-automation.md) — ガバナンスイベントと自動化
- [docs/configuration.md](../configuration.md) — 環境変数一覧
