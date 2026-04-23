/**
 * Handlers Auto-Initialization
 * 
 * すべてのハンドラーをイベントディスパッチャーに自動登録する
 * server.ts の main() 関数から呼び出す
 */

import type { SystemEvent } from "../core/event/event-dispatcher.js";
import { onEvent } from "../core/event/event-dispatcher.js";

import {
  handleResourceGapDetected,
  DEFAULT_HANDLER_CONFIG
} from "./resource/resource-gap.handler.js";

import {
  handleResourceCreated,
  initializeCreatedResourceTracker
} from "./resource/resource-created.handler.js";

import {
  recordResourceDeletion,
  initializeDeletedResourceTracker
} from "./resource/resource-deleted.handler.js";

import {
  recordToolError,
  initializeErrorAggregateTracker
} from "./governance/error-aggregate.handler.js";

import {
  recordQualityCheckFailure,
  initializeQualityCheckFailureTracker
} from "./governance/quality-check-failed.handler.js";
import {
  handleGovernanceThresholdExceeded,
  DEFAULT_THRESHOLD_CONFIG
} from "./governance/threshold.handler.js";
import { createLogger } from "../core/logging/logger.js";

const logger = createLogger("HandlersAutoInit");

/**
 * グローバルハンドラー状態（server.ts で管理）
 */
export interface HandlersState {
  createdTracker: ReturnType<typeof initializeCreatedResourceTracker>;
  deletedTracker: ReturnType<typeof initializeDeletedResourceTracker>;
  errorTracker: ReturnType<typeof initializeErrorAggregateTracker>;
  qualityTracker: ReturnType<typeof initializeQualityCheckFailureTracker>;
  registeredHandlers: number;
}

/**
 * ハンドラー状態を初期化
 */
export function initializeHandlersState(): HandlersState {
  return {
    createdTracker: initializeCreatedResourceTracker(),
    deletedTracker: initializeDeletedResourceTracker(),
    errorTracker: initializeErrorAggregateTracker(),
    qualityTracker: initializeQualityCheckFailureTracker(),
    registeredHandlers: 0
  };
}

/**
 * すべてのハンドラーを自動登録
 */
export function autoInitializeHandlers(
  handlersState: HandlersState
): void {
  logger.info("自動初期化を開始しています...");

  const register = (
    eventType: SystemEvent["type"],
    listener: (event: SystemEvent) => Promise<void>
  ) => {
    onEvent(eventType, listener);
    handlersState.registeredHandlers += 1;
  };

  // ============================================================
  // resource_gap_detected ハンドラー
  // ============================================================
  register("resource_gap_detected", async (event: SystemEvent) => {
    logger.info(`resource_gap_detected: ${event.payload.topic}`);

    const gap = {
      detected: true,
      resourceType: event.payload.resourceType as "skills" | "tools" | "presets",
      topic: event.payload.topic as string,
      topScore: event.payload.topScore as number,
      threshold: event.payload.threshold as number,
      gapSeverity: event.payload.gapSeverity as "low" | "medium" | "high",
      timestamp: event.timestamp
    };

    // ハンドラー実行（現在は提案のみ）
    const result = await handleResourceGapDetected(gap, [], DEFAULT_HANDLER_CONFIG);

    if (result.suggestion) {
      logger.info(`提案: ${result.suggestion.name} (${result.suggestion.priority})`);
    }
  });

  // ============================================================
  // resource_created ハンドラー
  // ============================================================
  register("resource_created", async (event: SystemEvent) => {
    logger.info(
      `[Handler] resource_created: ${event.payload.resourceType}:${event.payload.name}`
    );

    handleResourceCreated(
      {
        resourceType: event.payload.resourceType as "skills" | "tools" | "presets",
        name: event.payload.name as string,
        source: event.payload.source as string | undefined
      },
      handlersState.createdTracker
    );
  });

  // ============================================================
  // resource_deleted ハンドラー
  // ============================================================
  register("resource_deleted", async (event: SystemEvent) => {
    logger.info(
      `[Handler] resource_deleted: ${event.payload.resourceType}:${event.payload.name}`
    );

    recordResourceDeletion(
      handlersState.deletedTracker,
      event.payload.resourceType as "skills" | "tools" | "presets",
      event.payload.name as string
    );
  });

  // ============================================================
  // error_aggregate_detected ハンドラー
  // ============================================================
  register("error_aggregate_detected", async (event: SystemEvent) => {
    logger.warn(`error_aggregate_detected: ${event.payload.toolName}`);

    recordToolError(
      handlersState.errorTracker,
      event.payload.toolName as string,
      event.payload.error as string || "Unknown error"
    );
  });

  // ============================================================
  // quality_check_failed ハンドラー
  // ============================================================
  register("quality_check_failed", async (event: SystemEvent) => {
    logger.warn(
      `[Handler] quality_check_failed: ${event.payload.resourceType}:${event.payload.name}`
    );

    recordQualityCheckFailure(
      handlersState.qualityTracker,
      event.payload.resourceType as "skills" | "tools" | "presets",
      event.payload.name as string,
      (event.payload.errors as string[]) || []
    );
  });

  // ============================================================
  // governance_threshold_exceeded ハンドラー
  // ============================================================
  register("governance_threshold_exceeded", async (event: SystemEvent) => {
    const counts = (event.payload.counts as Record<string, number> | undefined) ?? {};
    const maxCounts = (event.payload.maxCounts as Record<string, number> | undefined) ?? {};
    const recommendations = (event.payload.recommendations as Array<{
      resourceType: "skills" | "tools" | "presets";
      name: string;
      usage: number;
      bugSignals: number;
      score: number;
    }> | undefined) ?? [];

    for (const resourceType of ["skills", "tools", "presets"] as const) {
      const currentCount = counts[resourceType] ?? 0;
      const maxCount = maxCounts[resourceType] ?? 0;
      const candidates = recommendations
        .filter((r) => r.resourceType === resourceType)
        .map((r) => ({
          name: r.name,
          usage: r.usage,
          bugSignals: r.bugSignals,
          score: r.score,
          riskLevel: (r.bugSignals > 5
            ? "high"
            : r.bugSignals > 2
              ? "medium"
              : "low") as "high" | "medium" | "low"
        }));

      await handleGovernanceThresholdExceeded(
        resourceType,
        currentCount,
        maxCount,
        candidates,
        DEFAULT_THRESHOLD_CONFIG
      );
    }
  });

  logger.info(`${handlersState.registeredHandlers}個のハンドラーを登録完了`);
}

/**
 * ハンドラー状態をダッシュボード用に生成
 */
export function generateHandlersDashboard(
  handlersState: HandlersState
): {
  registeredHandlers: number;
  statistics: {
    created: number;
    deleted: number;
    errorDetections: number;
    qualityFailures: number;
  };
  recentActivities: Array<{
    type: string;
    count: number;
    timestamp: string;
  }>;
} {
  return {
    registeredHandlers: handlersState.registeredHandlers,
    statistics: {
      created: handlersState.createdTracker.totalCreated,
      deleted: handlersState.deletedTracker.deletedResources.length,
      errorDetections: handlersState.errorTracker.toolErrors.size,
      qualityFailures: handlersState.qualityTracker.failures.length
    },
    recentActivities: [
      {
        type: "resource_created",
        count: handlersState.createdTracker.totalCreated,
        timestamp: new Date().toISOString()
      },
      {
        type: "resource_deleted",
        count: handlersState.deletedTracker.deletedResources.length,
        timestamp: new Date().toISOString()
      },
      {
        type: "error_detected",
        count: handlersState.errorTracker.toolErrors.size,
        timestamp: new Date().toISOString()
      },
      {
        type: "quality_failed",
        count: handlersState.qualityTracker.failures.length,
        timestamp: new Date().toISOString()
      }
    ]
  };
}
