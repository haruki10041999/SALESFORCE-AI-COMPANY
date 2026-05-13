/**
 * T-OBS-02: Prometheus メトリクスエクスポート
 *
 * `prom-client` のレジストリにツール実行メトリクスを記録し、
 * Prometheus 形式テキストを返す。MCP ツール `get_prometheus_metrics`
 * から、または HTTP /metrics エンドポイント (将来) から公開する想定。
 *
 * 設計方針:
 *  - グローバル副作用を最小化するため、レジストリは module-private に保持
 *  - prom-client が未インストール / 起動失敗時は no-op で安全にフォールバック
 *  - 既存の {@link mcp/tools/metrics.ts} の `recordMetric` を fan-out 元として
 *    ここから呼ぶことで、両方の集計経路を維持する
 *
 * 観測指標:
 *  - sfai_tool_executions_total{tool, status}            counter
 *  - sfai_tool_duration_seconds{tool, status}            histogram (buckets: ms→s)
 *  - sfai_tool_failures_total{tool, code}                counter (status=error 時)
 */

import { createLogger } from "../logging/logger.js";

const logger = createLogger("PrometheusMetrics");

interface PromCounter {
  inc(labels: Record<string, string>, value?: number): void;
}

interface PromHistogram {
  observe(labels: Record<string, string>, value: number): void;
}

interface PromRegistry {
  metrics(): Promise<string>;
  contentType: string;
  resetMetrics(): void;
}

interface PromBundle {
  registry: PromRegistry;
  toolExec: PromCounter;
  toolDuration: PromHistogram;
  toolFailures: PromCounter;
  costUsdTotal: PromCounter;
  costBudgetExceededTotal: PromCounter;
}

let bundle: PromBundle | null = null;
let initAttempted = false;
let initPromise: Promise<PromBundle | null> | null = null;

function createCardinalityGuard(limit: number): (value: string) => string {
  const seen = new Set<string>();
  return (value: string) => {
    const normalized = value.trim().length > 0 ? value.trim() : "_unknown";
    if (seen.has(normalized)) {
      return normalized;
    }
    if (seen.size >= limit) {
      return "_other";
    }
    seen.add(normalized);
    return normalized;
  };
}

function createLabelGuards(): {
  tool: (value: string) => string;
  errorCode: (value: string) => string;
  actor: (value: string) => string;
  tenant: (value: string) => string;
  model: (value: string) => string;
} {
  return {
    tool: createCardinalityGuard(128),
    errorCode: createCardinalityGuard(32),
    actor: createCardinalityGuard(64),
    tenant: createCardinalityGuard(64),
    model: createCardinalityGuard(16)
  };
}

let labelGuards = createLabelGuards();

async function initBundle(): Promise<PromBundle | null> {
  if (bundle) return bundle;
  if (initPromise) return initPromise;
  if (initAttempted) return bundle;
  initAttempted = true;
  initPromise = (async () => {
    try {
      // dynamic import で prom-client 未インストール環境でも no-op を許容する
      const mod = (await import("prom-client")) as unknown as {
        Registry: new () => PromRegistry;
        Counter: new (cfg: {
          name: string;
          help: string;
          labelNames: string[];
          registers: PromRegistry[];
        }) => PromCounter;
        Histogram: new (cfg: {
          name: string;
          help: string;
          labelNames: string[];
          buckets: number[];
          registers: PromRegistry[];
        }) => PromHistogram;
        collectDefaultMetrics: (cfg: { register: PromRegistry }) => void;
      };

      const registry = new mod.Registry();
      mod.collectDefaultMetrics({ register: registry });

      const toolExec = new mod.Counter({
        name: "sfai_tool_executions_total",
        help: "Total MCP tool invocations grouped by tool name and status.",
        labelNames: ["tool", "status"],
        registers: [registry]
      });
      const toolDuration = new mod.Histogram({
        name: "sfai_tool_duration_seconds",
        help: "MCP tool execution duration in seconds.",
        labelNames: ["tool", "status"],
        // 1 ms から 30 s をカバー
        buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
        registers: [registry]
      });
      const toolFailures = new mod.Counter({
        name: "sfai_tool_failures_total",
        help: "Total MCP tool failures by error code.",
        labelNames: ["tool", "code"],
        registers: [registry]
      });
      const costUsdTotal = new mod.Counter({
        name: "sfai_cost_usd_total",
        help: "Estimated cost usage in USD by actor, tenant and model.",
        labelNames: ["actor", "tenant", "model"],
        registers: [registry]
      });
      const costBudgetExceededTotal = new mod.Counter({
        name: "sfai_cost_budget_exceeded_total",
        help: "Number of blocked executions due to cost budget limits.",
        labelNames: ["actor", "tenant", "tool"],
        registers: [registry]
      });

      bundle = { registry, toolExec, toolDuration, toolFailures, costUsdTotal, costBudgetExceededTotal };
      return bundle;
    } catch (err) {
      logger.debug("prom-client not available, prometheus export disabled", err);
      bundle = null;
      return null;
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export interface ToolExecutionMetric {
  toolName: string;
  status: "success" | "error";
  durationMs: number;
  errorCode?: string;
}

export interface CostBudgetMetric {
  actorId: string;
  tenantId?: string;
  model: string;
  usd: number;
  toolName: string;
  exceeded?: boolean;
}

/**
 * ツール実行 1 件を Prometheus に記録する。
 * 同期インタフェースを保つため await せず fire-and-forget で初期化を起動。
 */
export function recordToolExecutionForPrometheus(metric: ToolExecutionMetric): void {
  void initBundle().then((b) => {
    if (!b) return;
    try {
      const labels = { tool: labelGuards.tool(metric.toolName), status: metric.status };
      b.toolExec.inc(labels, 1);
      b.toolDuration.observe(labels, metric.durationMs / 1000);
      if (metric.status === "error") {
        b.toolFailures.inc({ tool: labelGuards.tool(metric.toolName), code: labelGuards.errorCode(metric.errorCode ?? "UNKNOWN") }, 1);
      }
    } catch (err) {
      logger.debug("prometheus record failure", err);
    }
  });
}

export function recordCostBudgetForPrometheus(metric: CostBudgetMetric): void {
  void initBundle().then((b) => {
    if (!b) return;
    try {
      const tenant = labelGuards.tenant(metric.tenantId && metric.tenantId.length > 0 ? metric.tenantId : "_none");
      b.costUsdTotal.inc(
        { actor: labelGuards.actor(metric.actorId), tenant, model: labelGuards.model(metric.model) },
        Number.isFinite(metric.usd) && metric.usd > 0 ? metric.usd : 0
      );
      if (metric.exceeded) {
        b.costBudgetExceededTotal.inc({ actor: labelGuards.actor(metric.actorId), tenant, tool: labelGuards.tool(metric.toolName) }, 1);
      }
    } catch (err) {
      logger.debug("prometheus cost record failure", err);
    }
  });
}

/**
 * Prometheus テキスト形式 (text/plain; version=0.0.4) を返す。
 * 失敗時は空文字を返す。
 */
export async function getPrometheusMetricsText(): Promise<{ contentType: string; text: string }> {
  const b = await initBundle();
  if (!b) return { contentType: "text/plain; version=0.0.4", text: "" };
  try {
    return { contentType: b.registry.contentType, text: await b.registry.metrics() };
  } catch (err) {
    logger.debug("prometheus metrics() failure", err);
    return { contentType: "text/plain; version=0.0.4", text: "" };
  }
}

/** テスト用: registry をリセット */
export async function _resetPrometheusForTest(): Promise<void> {
  const b = await initBundle();
  b?.registry.resetMetrics();
  bundle = null;
  initAttempted = false;
  initPromise = null;
  labelGuards = createLabelGuards();
}
