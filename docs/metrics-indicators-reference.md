# Metrics 評価指標リファレンス

このドキュメントは、運用・品質評価で使う metrics 指標について、
目的、計算方法、解釈、注意点を統一定義するための参照資料です。

## 1. 対象データと共通ルール

- 主データソース: Postgres `metrics_samples`
- フォールバック: `outputs/events/metrics-samples.jsonl`
- 主な入力フィールド:
  - `toolName`
  - `startedAt`
  - `durationMs`
  - `status` (`success` / `error`)

共通ルール:

- 集計期間は UTC の時刻で閉区間 `[from, to]` を用いる。
- `durationMs < 0` は不正値として除外する。
- `status` が `success` でも `durationMs` 欠損時は遅延系指標から除外する。
- 分母が 0 の比率指標は `null`（未定義）として扱い、0% に丸めない。

## 2. 指標一覧（概要）

| 指標 | 概要 | 主用途 |
|---|---|---|
| Total Calls | 期間内の総呼び出し数 | トラフィック変動の監視 |
| Error Count | 失敗 (`status=error`) 件数 | 障害量の監視 |
| Error Rate | 呼び出しに占める失敗率 | 品質劣化の早期検知 |
| Success Rate | 呼び出しに占める成功率 | 安定性の主要 KPI |
| Overall p50 | 全体の中央値遅延 | 典型的体感速度の確認 |
| Overall p95 | 全体の 95 パーセンタイル遅延 | 悪化兆候の検知 |
| Overall p99 | 全体の 99 パーセンタイル遅延 | テール遅延の監視 |
| Avg Duration | 全体の平均遅延 | 傾向把握の補助 |
| Tool p95 | ツール別 p95 遅延 | ボトルネック特定 |
| Slow Call Ratio | 閾値超過呼び出し率 | SLO 逸脱の管理 |

## 3. 各指標の計算方法

### 3.1 Total Calls

- 定義: 集計期間内レコード件数
- 計算式:

$$
TotalCalls = N
$$

ここで $N$ は対象レコード数。

### 3.2 Error Count

- 定義: `status=error` の件数
- 計算式:

$$
ErrorCount = \sum_{i=1}^{N} I(status_i = error)
$$

### 3.3 Error Rate

- 定義: 呼び出し全体に占める失敗割合
- 計算式:

$$
ErrorRate = \frac{ErrorCount}{TotalCalls}
$$

- 表示は百分率（%）に変換してよい。

### 3.4 Success Rate

- 定義: 呼び出し全体に占める成功割合
- 計算式:

$$
SuccessRate = \frac{SuccessCount}{TotalCalls} = 1 - ErrorRate
$$

- `TotalCalls=0` の場合は `null`。

### 3.5 Overall p50 / p95 / p99

- 定義: 全ツールを対象にした遅延の分位点
- 対象集合:
  - `durationMs` が存在し、かつ `durationMs >= 0` のレコード
- 計算手順:
  1. `durationMs` を昇順ソート
  2. 位置を $k=\lceil p \times M \rceil$ とする（$M$ は有効件数, $p \in \{0.50,0.95,0.99\}$）
  3. ソート後の $k$ 番目を分位値とする

$$
pXX = sortedDuration[\lceil p \times M \rceil]
$$

- 実装上の補足:
  - DB 側で `percentile_cont` を使う場合は連続補間になるため、離散定義とわずかに差が出る。

### 3.6 Avg Duration

- 定義: 有効 `durationMs` の算術平均
- 計算式:

$$
AvgDuration = \frac{1}{M}\sum_{j=1}^{M} duration_j
$$

- 外れ値の影響が大きいため、単独判断は避ける。

### 3.7 Tool p95

- 定義: 各 `toolName` 単位での p95 遅延
- 計算式:

$$
ToolP95(tool) = p95(\{duration_i \mid toolName_i = tool\})
$$

- 推奨運用:
  - 期間内件数が少ないツール（例: 20 件未満）は参考値として扱う。

### 3.8 Slow Call Ratio

- 定義: 閾値 `T_ms` を超える呼び出し割合
- 計算式:

$$
SlowCallRatio(T_{ms}) = \frac{\sum I(duration_i > T_{ms})}{M}
$$

- 例: `T_ms=300` で「300ms 超過率」を算出。

## 4. 評価基準（推奨初期値）

| 指標 | Good | Warning | Critical |
|---|---|---|---|
| Success Rate | >= 99.0% | >= 97.0% かつ < 99.0% | < 97.0% |
| Overall p95 | <= 200ms | > 200ms かつ <= 350ms | > 350ms |
| Overall p99 | <= 500ms | > 500ms かつ <= 800ms | > 800ms |
| Slow Call Ratio (300ms) | <= 5% | > 5% かつ <= 10% | > 10% |
| Error Count (日次) | <= 3 | 4-10 | > 10 |

注意:

- この閾値は初期値であり、業務特性・時間帯・環境（local/stg/prod）で調整する。
- 一時的スパイクより、3 日移動平均や週次トレンドを優先して判断する。

## 5. SQL サンプル

### 5.1 期間集計（全体）

```sql
select
  count(*) as total_calls,
  sum(case when status = 'error' then 1 else 0 end) as error_count,
  avg(duration_ms) filter (where duration_ms is not null and duration_ms >= 0) as avg_duration_ms,
  percentile_cont(0.95) within group (order by duration_ms)
    filter (where duration_ms is not null and duration_ms >= 0) as p95_duration_ms
from metrics_samples
where started_at >= $1 and started_at <= $2;
```

### 5.2 ツール別 p95

```sql
select
  tool_name,
  count(*) as total_calls,
  percentile_cont(0.95) within group (order by duration_ms)
    filter (where duration_ms is not null and duration_ms >= 0) as p95_duration_ms,
  sum(case when status = 'error' then 1 else 0 end) as error_count
from metrics_samples
where started_at >= $1 and started_at <= $2
group by tool_name
order by p95_duration_ms desc nulls last;
```

## 6. 参照ドキュメント

- 全体方針: [metrics-evaluation.md](./metrics-evaluation.md)
- 運用手順: [operations-guide.md](./operations-guide.md)
- 機能仕様: [features/11-metrics-benchmarks.md](./features/11-metrics-benchmarks.md)
