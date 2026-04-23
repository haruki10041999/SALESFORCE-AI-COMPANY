# メトリクス評価指標の定義

このドキュメントは、メトリクスの算出方法と評価基準を定義します。

## 1. 共通前提

- 入力データ: `outputs/events/metrics-samples.jsonl`
- 1レコードに含まれる主な項目:
  - `toolName`
  - `startedAt`
  - `durationMs`
  - `status` (`success` / `error`)

## 2. 指標一覧

| 指標 | 算出式 | 評価観点 | しきい値の目安 |
|---|---|---|---|
| Total Calls | 期間内レコード件数 | ボリューム変動を把握 | 前週平均比 +30% 超で調査 |
| Error Count | `status = error` の件数 | 失敗回数の増減を把握 | 日次 5 件超で調査 |
| Success Rate | `(Total Calls - Error Count) / Total Calls` | 安定性の主要指標 | 95% 未満で警戒 |
| Overall p95 | 全 `durationMs` の 95 パーセンタイル | 体感遅延に近い遅延指標 | 200ms 超で警戒 |
| Tool p95 | ツール別 `durationMs` の 95 パーセンタイル | ボトルネックツール特定 | 300ms 超ツールを優先改善 |
| Avg Duration | 全 `durationMs` の平均値 | 全体傾向の補助指標 | 単独では判断せず p95 と併用 |

## 3. 95 パーセンタイルの考え方

- p95 は「速い順に並べたとき、95%地点の値」です。
- 外れ値 1 件だけで平均値が大きくぶれる問題を避けやすいため、
  実運用の遅延評価では平均値より優先して参照します。

## 4. 運用ルール

- 日次で確認するもの:
  - Success Rate
  - Overall p95
  - Error Count
- 週次で確認するもの:
  - Tool p95 上位
  - 呼び出し回数上位ツールのエラー傾向

## 5. 監視の優先順位

1. Success Rate 低下
2. Overall p95 増加
3. Tool p95 の突出
4. Error Count の局所増加

## 6. 参照先

- ローカル要約: `npm run metrics:report -- --top 10`
- ローカル可視化: `npm run metrics:dashboard`
- HTML 出力: `outputs/reports/metrics-dashboard.html`
- GitHub Pages 公開: `Metrics Dashboard Publish` ワークフロー
