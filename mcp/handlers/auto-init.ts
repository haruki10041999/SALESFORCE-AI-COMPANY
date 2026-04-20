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

/**
 * グローバルハンドラー状態（server.ts で管理）
 */
export interface HandlersState {
  createdTracker: ReturnType<typeof initializeCreatedResourceTracker>;
  deletedTracker: ReturnType<typeof initializeDeletedResourceTracker>;
  errorTracker: ReturnType<typeof initializeErrorAggregateTracker>;
  qualityTracker: ReturnType<typeof initializeQualityCheckFailureTracker>;
}

/**
 * ハンドラー状態を初期化
 */
export function initializeHandlersState(): HandlersState {
  return {
    createdTracker: initializeCreatedResourceTracker(),
    deletedTracker: initializeDeletedResourceTracker(),
    errorTracker: initializeErrorAggregateTracker(),
    qualityTracker: initializeQualityCheckFailureTracker()
  };
}

/**
 * すべてのハンドラーを自動登録
 */
export function autoInitializeHandlers(
  handlersState: HandlersState
): void {
  console.error("[Handlers] 自動初期化を開始しています...");

  // ============================================================
  // resource_gap_detected ハンドラー
  // ============================================================
  onEvent("resource_gap_detected", async (event: SystemEvent) => {
    console.error(`[Handler] resource_gap_detected: ${event.payload.topic}`);

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
      console.error(`[Handler] 提案: ${result.suggestion.name} (${result.suggestion.priority})`);
    }
  });

  // ============================================================
  // resource_created ハンドラー
  // ============================================================
  onEvent("resource_created", async (event: SystemEvent) => {
    console.error(
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
  onEvent("resource_deleted", async (event: SystemEvent) => {
    console.error(
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
  onEvent("error_aggregate_detected", async (event: SystemEvent) => {
    console.error(`[Handler] error_aggregate_detected: ${event.payload.toolName}`);

    recordToolError(
      handlersState.errorTracker,
      event.payload.toolName as string,
      event.payload.error as string || "Unknown error"
    );
  });

  // ============================================================
  // quality_check_failed ハンドラー
  // ============================================================
  onEvent("quality_check_failed", async (event: SystemEvent) => {
    console.error(
      `[Handler] quality_check_failed: ${event.payload.resourceType}:${event.payload.name}`
    );

    recordQualityCheckFailure(
      handlersState.qualityTracker,
      event.payload.resourceType as "skills" | "tools" | "presets",
      event.payload.name as string,
      (event.payload.errors as string[]) || []
    );
  });

  console.error("[Handlers] 6個のハンドラーを登録完了");
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
    registeredHandlers: 6,
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
