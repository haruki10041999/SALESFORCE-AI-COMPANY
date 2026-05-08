# SLA / SLO + Error Budget ガイド

**更新日**: 2026-05-08  
**参照**: [T-34: SLA / SLO + Error Budget](docs/internal/persistent-runtime-task-list.md#t-34-sla--slo--error-budget)

## 概要

このドキュメントは Salesforce AI Company の Service Level Agreement (SLA) と Service Level Objective (SLO) を定義します。
SLI（Service Level Indicator）を測定し、error budget（公式 downtime）を管理することで、信頼性と機能開発のバランスを取ります。

## SLI（Service Level Indicator）

### 1. 成功率（Success Rate）

**定義**: `(successful_tool_executions) / (total_tool_executions)`

- 対象: 全 tool execution（governing flow を通るすべて）
- 分子: HTTP 2xx / 3xx / 5xx(retryable) を返した実行
- 分母: 開始した全実行（timeout / cancel 含む）

**計測**:
```promql
rate(tool_executions_success_total{le="5000"}[5m])
/
rate(tool_executions_total[5m])
```

### 2. レイテンシ（Latency）- p95

**定義**: `tool execution の 95 パーセンタイル応答時間`

- 対象: 成功した実行のみ
- 単位: ミリ秒
- window: 5 分集計

**計測**:
```promql
histogram_quantile(0.95, rate(tool_execution_duration_ms_bucket[5m]))
```

### 3. コスト効率（Cost per Chat）

**定義**: `(total_llm_tokens_used) / (successful_chats)`

- 対象: completed chat session（≥ 1 turn）
- 分子: all LLM provider prompt+completion tokens（各社レート換算後の USD）
- 分母: finished session count

**計測**:
```promql
rate(llm_cost_usd_total[24h])
/
rate(chat_sessions_completed_total[24h])
```

## SLO（Service Level Objective）

| SLI | 目標値 | ウィンドウ | alert threshold | Error Budget |
|---|---|---|---|---|
| 成功率 | 99.5% | 30日 rolling | <99.0% | 3.6時間/月 |
| p95 latency | ≤1000ms | 30日 rolling | >1500ms | 72時間/月 |
| Cost/Chat | ≤$0.50 | 30日 rolling | >$0.75 | N/A（soft limit） |

### SLO 解釈

**成功率 99.5%**:
- allowed downtime: 1 - 0.995 = 0.005 = 0.5%
- 30日換算: 0.5% × 30 × 24h = 3.6時間

**latency p95 ≤1000ms**:
- ユーザーが許容できる応答時間
- 1秒以上のレイテンシを <0.5% に制限

**コスト/Chat ≤$0.50**:
- LLM provider cost の抑制目標
- overage alert は $0.75 で発火

## Error Budget

### 定義

error budget = (1 - SLO) × measurement window

例）成功率 99.5%, 30日 rolling window の場合：
```
budget = (1 - 0.995) × 30 × 24 × 60 = 216 分 = 3.6 時間
```

### Burn Rate（予算消費速度）

burn rate = (current error rate) / (allowed error rate)

- **burn rate = 1.0**: budget は丁度 30 日で枯渇
- **burn rate > 10**: 未来 3 時間以内に枯渇予測 → 即座に alert

### Multi-Window Burn-Rate Alerting

Prometheus + Alertmanager で複数 window を監視：

| Alert | Burn Rate | Window | Response |
|---|---|---|---|
| 高緊急 | >14.4× | 5min | feature freeze，log escalation |
| 中緊急 | >1× | 1h | engineering review，optional pause |
| 低優先 | >0.5× | 1d | metrics dashboard notify |

例）5分間で 14.4 倍以上のエラー増加 = 予算を 1 時間で完全消費 → 危機的状況。

## Feature Release 凍結（Policy Gate）

error budget が以下の条件で自動凍結：

1. **高優先度 alert 発火**（burn rate > 10×）：
   - feature merge を CI で block
   - 既知 bug fix / security patch のみ可

2. **budget exhausted**（burn rate = 1.0）：
   - すべての change 凍結（read-only mode）
   - incident resolution priority

3. **予測枯渇**（burn rate > 0.5× かつ remaining budget < 1日）：
   - warning ラベル，engineer manual review 必須

## 運用フロー

### 日次確認（朝礼）

```bash
npm run ai -- metrics:report -- --slo-status
```

見るポイント：
- 成功率の直近 24h 平均
- p95 latency の trend
- error budget remaining（日数表示）

### 週次レビュー

```bash
npm run ai -- observability:dashboard -- --slo
```

見るポイント：
- burn rate の時系列（5min / 1h / 1d window）
- alert の発火頻度と原因
- latency distribution（p50 / p75 / p95 / p99）

### 新機能リリース前

1. budget status 確認
2. burn rate が 0.5× 未満の確認
3. feature gate（`SF_AI_AUTO_APPLY` 等）で段階的展開

### Incident 発生時

1. burn rate 急上昇 alert で即座に通知
2. incident commander が原因調査
3. budget 復帰まで feature freeze 継続

## 実装ガイド

### Prometheus Recording Rules

`infra/observability/slo-rules.yaml`:

```yaml
groups:
  - name: slo
    rules:
      - record: slo:success_rate:5m
        expr: rate(tool_executions_success_total[5m]) / rate(tool_executions_total[5m])
      - record: slo:latency_p95:5m
        expr: histogram_quantile(0.95, rate(tool_execution_duration_ms_bucket[5m]))
      - record: slo:cost_per_chat:1h
        expr: rate(llm_cost_usd_total[1h]) / rate(chat_sessions_completed_total[1h])
      - record: slo:error_rate:5m
        expr: 1 - slo:success_rate:5m
      - record: slo:error_budget_remaining:rolling
        expr: (0.005 - slo:error_rate:rolling30d) * 30 * 24 * 3600  # seconds
```

### Alert Rules

```yaml
alert: SloErrorBudgetCritical
expr: slo:error_rate:5m / 0.005 > 14.4
for: 5m
labels:
  severity: critical
  slo_budget: "budget_breach"
```

### Grafana Dashboard

`infra/observability/grafana-dashboards/slo.json`:
- success rate gauge
- latency p95 time-series
- burn rate multi-window heatmap
- error budget remaining bar
- alert timeline

### Database Schema

`db/schema/slo-burn.ts`:

```typescript
export const sloBurn = pgTable('slo_burn', {
  id: bigserial('id').primaryKey(),
  ts: timestamp('ts').defaultNow().notNull(),
  sloId: text('slo_id').notNull(),  // 'success_rate' | 'latency_p95' | 'cost_per_chat'
  sloTarget: real('slo_target').notNull(),  // 0.995, 1000, 0.5
  currentValue: real('current_value').notNull(),
  errorRate: real('error_rate').notNull(),
  burnRate: real('burn_rate').notNull(),
  budgetRemainingSec: integer('budget_remaining_sec').notNull(),
  window: text('window').notNull(),  // '5m' | '1h' | '1d' | '30d'
  alertFired: boolean('alert_fired').defaultValue(false)
});
```

### Migration

`drizzle/0015_slo_burn.sql`:

```sql
CREATE TABLE slo_burn (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  slo_id TEXT NOT NULL,
  slo_target REAL NOT NULL,
  current_value REAL NOT NULL,
  error_rate REAL NOT NULL,
  burn_rate REAL NOT NULL,
  budget_remaining_sec INT NOT NULL,
  window TEXT NOT NULL,
  alert_fired BOOLEAN DEFAULT FALSE
);
CREATE INDEX idx_slo_burn_ts ON slo_burn(ts DESC);
CREATE INDEX idx_slo_burn_slo_id ON slo_burn(slo_id);
```

## FAQ

**Q: budget が枯渇したら何をする？**  
A: incident response protocol に従い、原因調査と fix を優先。feature freeze は継続。

**Q: costing は $0.50/chat で hard limit？**  
A: soft limit。alert は $0.75 で発火するが、block はしない。cost optimization task として plan。

**Q: p95 < 1000ms を満たせない場合？**  
A: SLO relaxation proposal を submit。原因分析（DB / LLM latency）と改善計画を提示。

**Q: dev / staging の SLO は異なる？**  
A: 本番のみ SLO 適用。dev/staging は「参考値」として同じ指標を publish するが alert なし。

## 参照リンク

- T-34 実装計画: docs/internal/persistent-runtime-task-list.md
- Prometheus recording rules: infra/observability/slo-rules.yaml
- Grafana dashboard: infra/observability/grafana-dashboards/slo.json
- AlertManager configuration: infra/observability/alertmanager.yaml （別規格化予定）
