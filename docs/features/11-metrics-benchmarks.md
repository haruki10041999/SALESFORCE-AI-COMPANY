# メトリクス・ベンチマークツール

ツール実行のトレース（Trace Context）からリアルタイムにパフォーマンスメトリクスを収集・集計し、
ベンチマーク評価を行うツール群です。

OTel は deterministic sampling を使い、`OTEL_TRACES_SAMPLER_RATIO` で収集量を抑えます。
Prometheus は high-cardinality label を `_other` / `_unknown` へ丸めるガードを持ちます。

---

## Trace Context の仕組み

MCP サーバー内では、すべてのツール実行が以下のライフサイクルで追跡されます。

```
ツール呼び出し開始
  └── startTrace(traceId, toolName)   ← アクティブトレースに追加
      │
      ├── 実行中（status: "running"）
      │
      └── completeTrace(traceId, status, durationMs)  ← 完了トレースに移動
```

完了トレースはメモリ上の固定サイズのリングバッファに保持され、
`metrics_summary` / `benchmark_suite` でその統計を参照します。

---

## metrics_summary

### 概要

直近の完了トレースから成功率・平均レイテンシ・p95 遅延を集計します。
アクティブなトレース（実行中）の件数も返します。

### 入力パラメータ

| パラメータ | 型 | デフォルト | 制約 | 説明 |
|---|---|---|---|---|
| `limit` | number | `200` | 1〜1000 | 集計対象のトレース件数上限 |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `activeCount` | number | 現在実行中のツール数 |
| `completedCount` | number | 集計対象の完了トレース数 |
| `successRate` | number | 成功率（0〜1） |
| `errorRate` | number | 失敗率（0〜1） |
| `averageDurationMs` | number | 平均実行時間（ミリ秒） |
| `p95DurationMs` | number | 95パーセンタイル実行時間（ミリ秒） |
| `slowest` | array | 実行時間が長い上位10件（`traceId`, `toolName`, `durationMs`, `status`） |

### 入力例

```text
metrics_summary:
  limit: 200
```

### 出力例

```json
{
  "activeCount": 1,
  "completedCount": 87,
  "successRate": 0.954,
  "errorRate": 0.046,
  "averageDurationMs": 312,
  "p95DurationMs": 1240,
  "slowest": [
    { "traceId": "trace-abc", "toolName": "branch_diff_summary", "durationMs": 2840, "status": "success" },
    { "traceId": "trace-def", "toolName": "smart_chat", "durationMs": 1950, "status": "success" }
  ]
}
```

### 指標の解釈

| 指標 | 良好 | 要注意 | 危険 |
|---|---|---|---|
| `successRate` | 0.95 以上 | 0.80〜0.95 | 0.80 未満 |
| `p95DurationMs` | 2000ms 未満 | 2000〜5000ms | 5000ms 超 |
| `activeCount` | 0〜3 | 4〜10 | 10 超（処理詰まりの可能性） |

---

## benchmark_suite

### 概要

直近メトリクスを基に、指定したシナリオの疑似ベンチマーク評価を実行します。
信頼性（エラー率）・レイテンシ（p95）・スループット（平均レイテンシ）の3軸で加重スコアを算出し、
A〜D のグレードとして返します。

### スコアリング計算

```
reliabilityScore = (1 - errorRate) * 100          # 重み: 50%
latencyScore     = clamp(100 - p95DurationMs / 50, 0, 100)  # 重み: 30%
throughputScore  = clamp(100 - avgDurationMs / 25, 0, 100)  # 重み: 20%

baseScore = reliabilityScore * 0.5 + latencyScore * 0.3 + throughputScore * 0.2
```

### グレード基準

| グレード | スコア |
|---|---|
| A | 90 以上 |
| B | 75〜89 |
| C | 60〜74 |
| D | 60 未満 |

### 入力パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `scenarios` | string[] | `["Apex review","LWC optimization","Security delta scan","Release readiness"]` | 評価するシナリオ名 |
| `recentTraceLimit` | number | `300` | 集計対象のトレース件数上限 |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `overallScore` | number | 全シナリオの平均スコア（0〜100） |
| `grade` | string | グレード（`A`/`B`/`C`/`D`） |
| `metricsSnapshot` | object | `successRate`, `errorRate`, `averageDurationMs`, `p95DurationMs` |
| `cases` | array | シナリオ別スコア（`scenario`, `score`, `note`） |
| `recommendations` | string[] | 改善提案 |

### 入力例

```text
benchmark_suite:
  recentTraceLimit: 300
  scenarios: ["Apex review", "LWC optimization", "Release readiness"]
```

### 出力例

```json
{
  "overallScore": 82,
  "grade": "B",
  "metricsSnapshot": {
    "successRate": 0.954,
    "errorRate": 0.046,
    "averageDurationMs": 312,
    "p95DurationMs": 1240
  },
  "cases": [
    { "scenario": "Apex review", "score": 84, "note": "安定" },
    { "scenario": "LWC optimization", "score": 82, "note": "安定" },
    { "scenario": "Release readiness", "score": 80, "note": "安定" }
  ],
  "recommendations": [
    "現状は良好です。定期的な負荷ベンチを CI に組み込むと品質を維持できます。"
  ]
}
```

---

## メトリクス永続化

ツール実行サンプルは `SF_AI_METRICS_FILE` で指定したファイルに JSONL 形式で保存されます。
サーバー起動時にファイルから読み込まれ、メモリ上のサンプルバッファに復元されます。

### 関連環境変数

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `SF_AI_METRICS_FILE` | `outputs/events/metrics-samples.jsonl` | メトリクスサンプルの保存先 |
| `METRICS_SAMPLES_MAX` | `2000` | メモリ上に保持するサンプルの最大件数 |
| `TRACE_HISTORY_MAX` | `500` | 完了トレースの保持件数 |

---

## 学習メトリクス自動更新（Task 8）

`metrics_summary` / `benchmark_suite` が「直近トレースの観測」に主眼を置くのに対し、
Task 8 のランナーは「学習系の集計スナップショット更新」を担当します。

### 実行コマンド

```bash
# 学習ダッシュボード更新のみ
npm run metrics:update

# drift / regression 検知を同時実行
npm run metrics:update:drift
```

補足:

- `metrics:update:drift` は `--with-drift` フラグで実行されます。
- `cross-env` 依存は不要で、Windows / Unix のどちらでも同じコマンドで実行できます。

### 主な出力

| 出力 | 既定パス | 説明 |
|---|---|---|
| Learning dashboard | `outputs/dashboards/learning-progress.json` | 報酬・提案・reputation などの学習進捗スナップショット |
| Drift report (JSONL) | `outputs/reports/drift-regression.jsonl` | reward drift / agent regression 検知結果の追記ログ |

### 関連環境変数（Task 8）

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `SF_AI_METRICS_REPORTING_HOURS` | `24` | 学習ダッシュボード更新時の集計ウィンドウ（時間） |
| `SF_AI_METRICS_WITH_DRIFT` | `false` | メトリクス更新時に drift / regression 検知を同時実行するか |
| `SF_AI_DRIFT_BASELINE_HOURS` | `168` | drift 比較の baseline ウィンドウ（時間） |
| `SF_AI_DRIFT_RECENT_HOURS` | `24` | drift 比較の recent ウィンドウ（時間） |
| `SF_AI_DRIFT_MIN_REWARD_SAMPLES` | `20` | drift 判定に必要な recent reward の最小件数 |
| `SF_AI_DRIFT_MIN_REPUTATION_SAMPLES` | `3` | regression 判定に必要な reputation の最小件数（各窓） |
| `SF_AI_DRIFT_THRESHOLD` | `0.15` | reward drift 判定しきい値 |
| `SF_AI_REGRESSION_THRESHOLD` | `0.1` | agent regression 判定しきい値 |
| `SF_AI_DRIFT_REPORT_PATH` | `outputs/reports/drift-regression.jsonl` | drift レポート JSONL の保存先 |

---

## 推奨ワークフロー

### パフォーマンス監視フロー

```
1. metrics_summary          # 現在の成功率・レイテンシを確認
2. benchmark_suite          # 総合評価スコアとグレードを取得
3. get_tool_execution_statistics（docs/features/10-event-automation.md）
                            # ツール別の詳細統計と時系列分析
4. update_event_automation_config
                            # 問題があればリトライ戦略を調整
```

---

## 関連ドキュメント

- [docs/features/10-event-automation.md](./10-event-automation.md) — イベント統計・リトライ設定
- [docs/configuration.md](../configuration.md) — 環境変数一覧
