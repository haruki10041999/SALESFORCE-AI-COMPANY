/**
 * Event Dispatcher
 * 
 * システムイベントを管理・発火・リスニング
 */

import { createLogger } from "../logging/logger.js";

const logger = createLogger("EventDispatcher");

export type SystemEventType =
  | "resource_gap_detected"
  | "resource_created"
  | "resource_deleted"
  | "error_aggregate_detected"
  | "governance_threshold_exceeded"
  | "quality_check_failed";

export interface SystemEvent {
  type: SystemEventType;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type EventListener = (event: SystemEvent) => Promise<void>;

export interface EventDispatcherConfig {
  maxListeners?: number;
}

interface ListenerFailureState {
  failureCount: number;
  consecutiveFailures: number;
  lastError: string;
  lastFailedAt: string;
  disabled: boolean;
}

export interface ListenerFailureStat {
  eventType: SystemEventType;
  listenerName: string;
  failureCount: number;
  consecutiveFailures: number;
  lastError: string;
  lastFailedAt: string;
  disabled: boolean;
}

/**
 * イベントディスパッチャー
 */
export class EventDispatcher {
  private listeners: Map<SystemEventType, Set<EventListener>> = new Map();
  private eventHistory: SystemEvent[] = [];
    private maxHistorySize: number;
  private listenerFailures: Map<SystemEventType, Map<EventListener, ListenerFailureState>> = new Map();

    constructor(config?: EventDispatcherConfig) {
      const envMax = Number.parseInt(process.env.EVENT_HISTORY_MAX ?? "1000", 10);
      this.maxHistorySize = Number.isFinite(envMax) && envMax > 0 ? envMax : 1000;
      if (config?.maxListeners) {
        // 必要に応じて max listeners チェック
      }
    }

  /**
   * イベントリスナーを登録
   */
  public on(eventType: SystemEventType, listener: EventListener): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(listener);

    if (!this.listenerFailures.has(eventType)) {
      this.listenerFailures.set(eventType, new Map());
    }
    this.listenerFailures.get(eventType)!.set(listener, {
      failureCount: 0,
      consecutiveFailures: 0,
      lastError: "",
      lastFailedAt: "",
      disabled: false
    });
  }

  /**
   * イベントリスナーを登録解除
   */
  public off(eventType: SystemEventType, listener: EventListener): void {
    this.listeners.get(eventType)?.delete(listener);
    this.listenerFailures.get(eventType)?.delete(listener);
  }

  /**
   * イベントを発火
   */
  public async emit(event: SystemEvent): Promise<void> {
    // 履歴に記録
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // リスナーを実行
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;

    const failureMap = this.listenerFailures.get(event.type) ?? new Map<EventListener, ListenerFailureState>();

    const promises = Array.from(listeners)
      .filter((listener) => {
        const state = failureMap.get(listener);
        return !state?.disabled;
      })
      .map((listener) =>
        listener(event)
          .then(() => {
            const state = failureMap.get(listener);
            if (state) {
              state.consecutiveFailures = 0;
            }
          })
          .catch((err) => {
            const now = new Date().toISOString();
            const state = failureMap.get(listener);
            if (state) {
              state.failureCount += 1;
              state.consecutiveFailures += 1;
              state.lastError = err instanceof Error ? err.message : String(err);
              state.lastFailedAt = now;
              if (state.consecutiveFailures >= 3) {
                state.disabled = true;
              }
            }
            logger.error(`Error in event listener for ${event.type}:`, err);
          })
      );

    if (!this.listenerFailures.has(event.type)) {
      this.listenerFailures.set(event.type, failureMap);
    }

    await Promise.all(promises);
  }

  /**
   * 条件付きイベント発火
   */
  public async emitIf(
    shouldEmit: boolean,
    event: SystemEvent
  ): Promise<void> {
    if (shouldEmit) {
      await this.emit(event);
    }
  }

  /**
   * イベント履歴を取得
   */
  public getHistory(
    eventType?: SystemEventType,
    limit: number = 100
  ): SystemEvent[] {
    let filtered = [...this.eventHistory];
    if (eventType) {
      filtered = filtered.filter((e) => e.type === eventType);
    }
    return filtered.slice(-limit);
  }

  /**
   * 履歴をクリア
   */
  public clearHistory(): void {
    this.eventHistory = [];
  }

  public getListenerFailureStats(eventType?: SystemEventType): ListenerFailureStat[] {
    const stats: ListenerFailureStat[] = [];
    const types = eventType ? [eventType] : Array.from(this.listenerFailures.keys());

    for (const type of types) {
      const failures = this.listenerFailures.get(type);
      if (!failures) {
        continue;
      }

      for (const [listener, state] of failures.entries()) {
        if (state.failureCount === 0) {
          continue;
        }
        stats.push({
          eventType: type,
          listenerName: listener.name || "anonymous-listener",
          failureCount: state.failureCount,
          consecutiveFailures: state.consecutiveFailures,
          lastError: state.lastError,
          lastFailedAt: state.lastFailedAt,
          disabled: state.disabled
        });
      }
    }

    return stats;
  }

  /**
   * リスナー数を取得
   */
  public getListenerCount(eventType: SystemEventType): number {
    return this.listeners.get(eventType)?.size ?? 0;
  }

  /**
   * 登録されているイベントタイプを一覧
   */
  public getRegisteredEventTypes(): SystemEventType[] {
    return Array.from(this.listeners.keys());
  }
}

/**
 * グローバルディスパッチャー（シングルトン）
 */
let globalDispatcher: EventDispatcher | null = null;

/**
 * グローバルディスパッチャーを取得・初期化
 */
export function getGlobalDispatcher(): EventDispatcher {
  if (!globalDispatcher) {
    globalDispatcher = new EventDispatcher({ maxListeners: 100 });
  }
  return globalDispatcher;
}

/**
 * イベントリスナーを登録
 */
export function onEvent(
  eventType: SystemEventType,
  listener: EventListener
): void {
  getGlobalDispatcher().on(eventType, listener);
}

/**
 * イベント発火
 */
export async function emitEvent(event: SystemEvent): Promise<void> {
  await getGlobalDispatcher().emit(event);
}

/**
 * イベント履歴を取得
 */
export function getEventHistory(
  eventType?: SystemEventType,
  limit?: number
): SystemEvent[] {
  return getGlobalDispatcher().getHistory(eventType, limit);
}

/**
 * ファクトリ関数：イベントを簡単に作成
 */
export function createEvent(
  type: SystemEventType,
  payload: Record<string, unknown>
): SystemEvent {
  return {
    type,
    timestamp: new Date().toISOString(),
    payload
  };
}

/**
 * リソースギャップイベントを作成
 */
export function createGapDetectedEvent(payload: {
  resourceType: "skills" | "tools" | "presets";
  topic: string;
  topScore: number;
  threshold: number;
  gapSeverity: string;
}): SystemEvent {
  return createEvent("resource_gap_detected", payload);
}

/**
 * リソース作成イベントを作成
 */
export function createResourceCreatedEvent(payload: {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  source?: string;
}): SystemEvent {
  return createEvent("resource_created", payload);
}

/**
 * リソース削除イベントを作成
 */
export function createResourceDeletedEvent(payload: {
  resourceType: "skills" | "tools" | "presets";
  name: string;
}): SystemEvent {
  return createEvent("resource_deleted", payload);
}

/**
 * 品質チェック失敗イベント
 */
export function createQualityCheckFailedEvent(payload: {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  errors: string[];
}): SystemEvent {
  return createEvent("quality_check_failed", payload);
}
