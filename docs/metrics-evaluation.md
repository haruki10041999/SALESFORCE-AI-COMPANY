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
- SLA アラート JSON: `outputs/reports/metrics-alerts.json`
- SLA アラート Markdown: `outputs/reports/metrics-alerts.md`
- スキル満足度レポート: `outputs/reports/skill-rating.md`
- ベンチ実行: `npm run benchmark:run`
- ベンチ出力: `outputs/reports/benchmark-suite.json`
- GitHub Pages 公開: `Metrics Dashboard Publish` ワークフロー

## 6.1 通知先なし運用のアラート方針

Webhook 等の通知先が未設定でも運用できるよう、しきい値超過は次の方法で扱う。

- `metrics-dashboard` 実行時にローカルレポートへ記録
- GitHub Actions 実行時は `::warning` を出力し、Step Summary に集約
- 必要時のみ `--fail-on-alert` を指定して CI を失敗化

CI 既定ポリシー:

- `.github/workflows/metrics-dashboard-publish.yml` は既定で warning-only（失敗化しない）
- 手動実行時は `workflow_dispatch` の `fail_on_alert` を `true` にすると失敗化
- もしくはリポジトリ変数 `METRICS_FAIL_ON_ALERT=true` で常時失敗化モードに切り替え可能

主要オプション:

- `--max-p95-ms <number>`
- `--max-error-rate <0-100>`
- `--min-governance-rate <0-100>`
- `--fail-on-alert`

## 6.2 スキル満足度レーティング運用

スキル利用後の満足度（1〜5）は `record_skill_rating` で蓄積し、
`get_skill_rating_report` で再集計できます。

- 平均評価: スキル全期間の平均値
- 直近評価: `recentWindow` 件で集計
- 低下傾向: `trendDropThreshold` 以上の下落、または `lowRatingThreshold` 未満の評価をフラグ化

出力ファイル:

- `outputs/reports/skill-rating.jsonl`（生ログ）
- `outputs/reports/skill-rating.json`（集計JSON）
- `outputs/reports/skill-rating.md`（集計Markdown）

## 7. ベンチスイート評価

`benchmark-suite.json` では以下を確認する。

- `overallScore`: 総合スコア（0〜100）
- `grade`: `A/B/C/D` の評価ランク
- `metricsSnapshot.successRate`: 成功率
- `metricsSnapshot.p95DurationMs`: p95 遅延
- `recommendations`: 優先改善提案

運用目安:

- `grade` が `B` 未満になった場合は、失敗率増加と遅延増加のどちらが主因かを `metricsSnapshot` で切り分ける。
- `recommendations` に retry/timeout 見直しが出た場合は、外部依存呼び出しを優先して確認する。

## 8. 提案ログ学習フィードバック

`proposal_feedback_learn` は提案の採用/不採用を学習し、
`search_resources` / `auto_select_resources` のスコアへ補正を適用します。

評価指標:

- 採用率: $acceptRate = accepted / (accepted + rejected)$
- 補正値（平滑化あり）:
  $$
  adjustment = clamp\left((\frac{accepted+1}{accepted+rejected+2} - 0.5) \times 0.8 \times confidence, -0.3, 0.3\right)
  $$
- 信頼度: $confidence = min(1, total/10)$

適用ルール:

- `minSamples` 未満のサンプルしかないリソースは補正 0
- 最終スコアは `baseScore * multiplier`
- `multiplier = clamp(1 + resourceAdjustment + typeAdjustment * 0.5, 0.5, 1.5)`
