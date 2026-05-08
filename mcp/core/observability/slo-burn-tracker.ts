/**
 * T-34: SLO Burn Rate calculator and reporter
 * 
 * Tracks SLO metrics and calculates burn rates for error budget management.
 */

import { promises as fsPromises } from "fs";
import { dirname, resolve } from "path";

export interface SloMetrics {
  successRate: number; // 0.0 - 1.0
  latencyP95Ms: number; // milliseconds
  costPerChat: number; // USD
  timestamp: string;
}

export interface SloBurnResult {
  sloId: "success_rate" | "latency_p95" | "cost_per_chat";
  sloTarget: number;
  currentValue: number;
  errorRate: number;
  burnRate: number;
  budgetRemainingSec: number;
  window: "5m" | "1h" | "1d" | "30d";
  alertLevel: "none" | "warning" | "critical";
}

// SLO targets and thresholds
const SLO_TARGETS = {
  success_rate: { target: 0.995, allowed_error: 0.005 },
  latency_p95: { target: 1000, allowed_error: 500 }, // ms
  cost_per_chat: { target: 0.5, allowed_error: 0.25 } // USD
};

const ALERT_THRESHOLDS = {
  critical: 14.4, // budget consumed in ~1 hour
  warning: 1.0    // budget consumed in rolling window
};

export function calculateSloBurn(
  metrics: SloMetrics,
  window: "5m" | "1h" | "1d" | "30d" = "30d"
): SloBurnResult[] {
  const results: SloBurnResult[] = [];

  // Success Rate SLO
  {
    const target = SLO_TARGETS.success_rate.target;
    const allowed = SLO_TARGETS.success_rate.allowed_error;
    const errorRate = 1 - metrics.successRate;
    const burnRate = errorRate / allowed;
    const windowSec = getWindowSeconds(window);
    const budgetSec = allowed * windowSec;
    const consumedSec = errorRate * windowSec;
    const remaining = Math.max(0, budgetSec - consumedSec);

    results.push({
      sloId: "success_rate",
      sloTarget: target,
      currentValue: metrics.successRate,
      errorRate,
      burnRate,
      budgetRemainingSec: Math.floor(remaining),
      window,
      alertLevel: getAlertLevel(burnRate)
    });
  }

  // Latency P95 SLO
  {
    const target = SLO_TARGETS.latency_p95.target;
    const allowed = SLO_TARGETS.latency_p95.allowed_error;
    const errorRate = Math.max(0, metrics.latencyP95Ms - target); // only excess latency
    const burnRate = errorRate > 0 ? errorRate / allowed : 0;
    const windowSec = getWindowSeconds(window);
    const budgetSec = allowed * windowSec;
    const consumedSec = errorRate;
    const remaining = Math.max(0, budgetSec - consumedSec);

    results.push({
      sloId: "latency_p95",
      sloTarget: target,
      currentValue: metrics.latencyP95Ms,
      errorRate,
      burnRate,
      budgetRemainingSec: Math.floor(remaining),
      window,
      alertLevel: getAlertLevel(burnRate)
    });
  }

  // Cost per Chat SLO
  {
    const target = SLO_TARGETS.cost_per_chat.target;
    const allowed = SLO_TARGETS.cost_per_chat.allowed_error;
    const errorRate = Math.max(0, metrics.costPerChat - target); // only excess cost
    const burnRate = errorRate > 0 ? errorRate / allowed : 0;
    const windowSec = getWindowSeconds(window);
    const budgetSec = allowed * windowSec;
    const consumedSec = errorRate;
    const remaining = Math.max(0, budgetSec - consumedSec);

    results.push({
      sloId: "cost_per_chat",
      sloTarget: target,
      currentValue: metrics.costPerChat,
      errorRate,
      burnRate,
      budgetRemainingSec: Math.floor(remaining),
      window,
      alertLevel: getAlertLevel(burnRate)
    });
  }

  return results;
}

function getWindowSeconds(window: "5m" | "1h" | "1d" | "30d"): number {
  switch (window) {
    case "5m": return 5 * 60;
    case "1h": return 60 * 60;
    case "1d": return 24 * 60 * 60;
    case "30d": return 30 * 24 * 60 * 60;
  }
}

function getAlertLevel(burnRate: number): "none" | "warning" | "critical" {
  if (burnRate > ALERT_THRESHOLDS.critical) {
    return "critical";
  } else if (burnRate > ALERT_THRESHOLDS.warning) {
    return "warning";
  }
  return "none";
}

export function formatSloBurnResult(result: SloBurnResult): string {
  const budgetHours = result.budgetRemainingSec / 3600;
  const budgetDays = budgetHours / 24;
  
  const budgetDisplay = budgetDays >= 1 
    ? `${budgetDays.toFixed(1)}d`
    : `${budgetHours.toFixed(1)}h`;

  return (
    `${result.sloId}: ` +
    `${result.currentValue.toFixed(2)} (target ${result.sloTarget}) | ` +
    `burn rate ${result.burnRate.toFixed(2)}× | ` +
    `budget remaining ${budgetDisplay} | ` +
    `[${result.alertLevel.toUpperCase()}]`
  );
}

export async function persistSloBurnRecord(
  result: SloBurnResult,
  timestamp: string,
  outputPath = resolve("outputs", "reports", "slo-burn.jsonl")
): Promise<void> {
  const record = {
    timestamp,
    ...result
  };

  try {
    await fsPromises.mkdir(dirname(outputPath), { recursive: true });
    const line = JSON.stringify(record);
    await fsPromises.appendFile(outputPath, `${line}\n`, "utf-8");
  } catch (error) {
    console.error(`Failed to persist SLO burn record: ${error}`);
  }
}
