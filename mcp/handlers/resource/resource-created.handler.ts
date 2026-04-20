/**
 * Resource Created Handler
 * 
 * resource_created イベントに応答して統計更新や通知を行う
 */

export interface ResourceCreatedEvent {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  source?: string; // "apply_resource_actions", "auto_suggestion", etc.
}

export interface CreatedResourceTracker {
  totalCreated: number;
  createdByType: Record<"skills" | "tools" | "presets", number>;
  createdBySource: Record<string, number>;
  lastCreatedResources: Array<{
    resourceType: string;
    name: string;
    timestamp: string;
    source?: string;
  }>;
}

/**
 * リソース作成履歴を初期化
 */
export function initializeCreatedResourceTracker(): CreatedResourceTracker {
  return {
    totalCreated: 0,
    createdByType: {
      skills: 0,
      tools: 0,
      presets: 0
    },
    createdBySource: {},
    lastCreatedResources: []
  };
}

/**
 * リソース作成イベントハンドラー
 */
export function handleResourceCreated(
  event: ResourceCreatedEvent,
  tracker: CreatedResourceTracker = initializeCreatedResourceTracker()
): CreatedResourceTracker {
  // リソースタイプ別統計を更新
  tracker.createdByType[event.resourceType]++;

  // ソース別統計を更新
  const source = event.source || "unknown";
  tracker.createdBySource[source] = (tracker.createdBySource[source] ?? 0) + 1;

  // 総数を更新
  tracker.totalCreated++;

  // 最新リソースを記録（最大20件保持）
  tracker.lastCreatedResources.unshift({
    resourceType: event.resourceType,
    name: event.name,
    timestamp: new Date().toISOString(),
    source: event.source
  });

  if (tracker.lastCreatedResources.length > 20) {
    tracker.lastCreatedResources.pop();
  }

  return tracker;
}

/**
 * 統計サマリーを生成
 */
export function generateCreationSummary(
  tracker: CreatedResourceTracker
): {
  totalCreated: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  recentCreations: string[];
} {
  return {
    totalCreated: tracker.totalCreated,
    byType: tracker.createdByType,
    bySource: tracker.createdBySource,
    recentCreations: tracker.lastCreatedResources
      .slice(0, 5)
      .map((r) => `${r.resourceType}:${r.name} (${r.source ?? "unknown"})`)
  };
}

/**
 * 1日の作成数をカウント
 */
export function countCreationsInLastDay(
  tracker: CreatedResourceTracker,
  withinLastHours: number = 24
): {
  total: number;
  byType: Record<string, number>;
} {
  const cutoff = new Date(Date.now() - withinLastHours * 60 * 60 * 1000);
  const recentCreations = tracker.lastCreatedResources.filter(
    (r) => new Date(r.timestamp) > cutoff
  );

  const byType: Record<string, number> = {
    skills: 0,
    tools: 0,
    presets: 0
  };

  for (const resource of recentCreations) {
    byType[resource.resourceType]++;
  }

  return {
    total: recentCreations.length,
    byType
  };
}
