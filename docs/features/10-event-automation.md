# イベント・自動化ツール

ツール実行イベントの記録・自動化設定・リトライ戦略・統計分析を管理するツール群です。
イベントは `outputs/events/system-events.jsonl` に JSONL 形式で永続化されます。

---

## システムイベントの種類

| イベント名 | 発行タイミング |
|---|---|
| `session_start` | オーケストレーションセッション開始時 |
| `turn_complete` | 各エージェントターン完了時 |
| `tool_before_execute` | ツール実行直前 |
| `tool_after_execute` | ツール実行完了後（成功・失敗問わず） |
| `preset_before_execute` | プリセット実行直前 |
| `governance_threshold_exceeded` | ガバナンス閾値超過時 |
| `low_relevance_detected` | 検索スコアが低閾値を下回った時 |
| `history_saved` | チャット履歴保存時 |
| `error_aggregate_detected` | 10分以内に同一ツールで3回以上エラーが発生した時 |
| `session_end` | セッション終了時 |

---

## get_system_events

### 概要

システムイベントの最新一覧をメモリおよびファイルから取得します。

### 入力パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `limit` | number | `50` | 返す最大件数 |
| `event` | string | — | フィルタするイベント名（上記テーブルの値） |

### 出力例

```json
[
  {
    "id": "evt-abc123",
    "event": "tool_after_execute",
    "timestamp": "2026-04-23T10:05:00.000Z",
    "payload": {
      "toolName": "apex_analyze",
      "durationMs": 142,
      "status": "success"
    }
  }
]
```

### 入力例

```text
get_system_events:
  limit: 20
  event: "error_aggregate_detected"
```

---

## get_event_automation_config

### 概要

現在のイベント自動化設定（有効化状態・保護ツール・ルール・リトライ戦略）を返します。

### 入力パラメータ

なし

### 出力例

```json
{
  "enabled": true,
  "protectedTools": ["apply_resource_actions", "get_system_events"],
  "rules": {
    "errorAggregateDetected": { "autoDisableTool": false },
    "governanceThresholdExceeded": {
      "autoDisableRecommendedTools": false,
      "maxToolsPerRun": 3
    }
  },
  "retryStrategy": {
    "retryEnabled": true,
    "maxRetries": 2,
    "baseDelayMs": 100,
    "maxDelayMs": 2000,
    "retryablePatterns": ["timeout", "timed out"],
    "retryableCodes": ["ETIMEDOUT", "ECONNRESET", "429", "503", "504"]
  }
}
```

---

## update_event_automation_config

### 概要

イベント自動化の設定を更新します。部分更新（パッチ更新）に対応しており、指定しないフィールドは変更されません。

### 入力パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `enabled` | boolean | 自動化を有効化/無効化 |
| `protectedTools` | string[] | 自動無効化から保護するツール名 |
| `rules` | object | 自動化ルールの更新 |
| `retryStrategy` | object | リトライ戦略の更新 |

### rules オブジェクト

```typescript
{
  errorAggregateDetected?: {
    autoDisableTool?: boolean;  // エラー集積時にツールを自動無効化
  };
  governanceThresholdExceeded?: {
    autoDisableRecommendedTools?: boolean;
    maxToolsPerRun?: number;    // 一度の apply で最大何ツールを処理するか
  };
}
```

### retryStrategy オブジェクト

| フィールド | 型 | 説明 |
|---|---|---|
| `retryEnabled` | boolean | リトライを有効化 |
| `maxRetries` | number | 最大リトライ回数 |
| `baseDelayMs` | number | 初回リトライの待機時間（ミリ秒）。指数バックオフで増加 |
| `maxDelayMs` | number | リトライ待機時間の上限（ミリ秒） |
| `retryablePatterns` | string[] | エラーメッセージにマッチする場合にリトライ（部分一致） |
| `retryableCodes` | string[] | エラーコードにマッチする場合にリトライ（HTTP ステータスコード文字列または Node.js エラーコード） |

### 入力例（基本設定の変更）

```text
update_event_automation_config:
  enabled: true
  protectedTools: ["apply_resource_actions", "get_system_events"]
  rules:
    errorAggregateDetected:
      autoDisableTool: true
    governanceThresholdExceeded:
      autoDisableRecommendedTools: false
      maxToolsPerRun: 3
```

### 入力例（リトライ戦略の調整）

```text
update_event_automation_config:
  retryStrategy:
    retryEnabled: true
    maxRetries: 3
    baseDelayMs: 200
    maxDelayMs: 4000
    retryablePatterns: ["timeout", "timed out", "econnreset"]
    retryableCodes: ["ETIMEDOUT", "ECONNRESET", "429", "503", "504"]
```

---

## get_tool_execution_statistics

### 概要

ツール実行イベントから成功率・失敗率・無効化状況を集計します。
時系列ウィンドウ分析とバケット別タイムラインに対応しており、問題の発生パターンを時間軸で把握できます。

### 入力パラメータ

| パラメータ | 型 | デフォルト | 制約 | 説明 |
|---|---|---|---|---|
| `windowsMinutes` | number[] | `[60]` | 各要素 1〜10080、最大10件 | 集計対象のウィンドウ（分） |
| `bucketMinutes` | number | `60` | 5〜180 | タイムライン分割の粒度（分） |
| `limit` | number | `1000` | 10〜2000 | 解析するイベントの上限件数 |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `totals` | object | `{ total, success, failure, blockedByDisable }` — 全期間合計 |
| `rates` | object | `{ successRate, failureRate }` — 成功率・失敗率（%） |
| `disabledTools` | object | `{ count, names[] }` — 現在無効化されているツール |
| `perTool` | array | ツール別内訳 |
| `windows` | array | ウィンドウ別の集計（`windowMinutes`, `totals`, `rates`） |
| `timeline` | array | 時系列バケット（`bucketStart`, `bucketMinutes`, `totals`, `rates`） |

### 入力例（シンプル）

```text
get_tool_execution_statistics: {}
```

### 入力例（時系列分析）

```text
get_tool_execution_statistics:
  windowsMinutes: [60, 1440, 10080]
  bucketMinutes: 30
  limit: 2000
```

### 出力例（抜粋）

```json
{
  "totals": { "total": 240, "success": 228, "failure": 12, "blockedByDisable": 0 },
  "rates": { "successRate": 95.0, "failureRate": 5.0 },
  "disabledTools": { "count": 1, "names": ["run_tests"] },
  "windows": [
    { "windowMinutes": 60, "totals": { "total": 18, "success": 17, "failure": 1 }, "rates": { "successRate": 94.4 } },
    { "windowMinutes": 1440, "totals": { "total": 120, "success": 114, "failure": 6 }, "rates": { "successRate": 95.0 } }
  ],
  "timeline": [
    { "bucketStart": "2026-04-23T10:00:00.000Z", "bucketMinutes": 30, "totals": { "total": 8, "success": 8, "failure": 0 } }
  ]
}
```

---

## イベントログの管理

### ローテーション

ログファイル（`system-events.jsonl`）が最大サイズ（デフォルト 2MB）に達すると自動的にアーカイブされます。
アーカイブファイルは `outputs/events/system-events.<timestamp>.<nonce>.jsonl` として保存されます。

- 最大アーカイブ数: 30 ファイル（デフォルト）
- 保持期間: 30 日（デフォルト）

### 関連環境変数

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `EVENT_HISTORY_MAX` | `1000` | メモリ上に保持するイベントの最大件数 |
| `SF_AI_OUTPUTS_DIR` | `outputs/` | イベントログの親ディレクトリ |

---

## 推奨ワークフロー

### 障害調査フロー

```
1. get_system_events（event: "error_aggregate_detected"で絞り込み）
2. get_tool_execution_statistics（失敗率・失敗ツールを特定）
3. get_event_automation_config（リトライ設定を確認）
4. update_event_automation_config（retryStrategy を調整）
5. get_tool_execution_statistics（改善後の統計を確認）
```

---

## 関連ドキュメント

- [docs/features/09-resource-governance.md](./09-resource-governance.md) — ガバナンスとツール無効化
- [docs/features/11-metrics-benchmarks.md](./11-metrics-benchmarks.md) — メトリクス・ベンチマーク
- [docs/configuration.md](../configuration.md) — 環境変数一覧
