import {
  listKnowledgeEntities,
  listKnowledgeRelations,
  type KnowledgeEntity,
  type KnowledgeRelation
} from "../../../memory/knowledge-graph.js";

export interface TransitiveInference {
  srcId: string;
  dstId: string;
  relationType: string;
  via: string[];
  confidence: number;
}

export interface SimilarEntity {
  entityId: string;
  score: number;
  commonNeighborCount: number;
}

export interface GraphCommunity {
  communityId: string;
  members: KnowledgeEntity[];
  relationCount: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function buildAdjacency(relations: KnowledgeRelation[], relationType?: string): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relationType && relation.relationType !== relationType) {
      continue;
    }
    if (!graph.has(relation.srcId)) {
      graph.set(relation.srcId, new Set());
    }
    graph.get(relation.srcId)!.add(relation.dstId);
  }
  return graph;
}

export function inferTransitiveRelations(options?: {
  relationType?: string;
  maxDepth?: number;
  minConfidence?: number;
}): TransitiveInference[] {
  const relationType = options?.relationType ?? "relates_to";
  const maxDepth = Math.max(2, options?.maxDepth ?? 3);
  const minConfidence = clamp(options?.minConfidence ?? 0.25, 0, 1);

  const relations = listKnowledgeRelations();
  const adjacency = buildAdjacency(relations, relationType);
  const directPairs = new Set(relations.filter((r) => r.relationType === relationType).map((r) => `${r.srcId}->${r.dstId}`));

  const inferred: TransitiveInference[] = [];
  for (const srcId of adjacency.keys()) {
    const queue: Array<{ node: string; path: string[] }> = [{ node: srcId, path: [srcId] }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length > maxDepth) {
        continue;
      }

      const neighbors = adjacency.get(current.node);
      if (!neighbors) {
        continue;
      }

      for (const next of neighbors) {
        if (current.path.includes(next)) {
          continue;
        }

        const nextPath = [...current.path, next];
        if (nextPath.length >= 3) {
          const pair = `${srcId}->${next}`;
          if (!directPairs.has(pair)) {
            const hops = nextPath.length - 1;
            const confidence = clamp(1 / hops, 0.2, 0.95);
            if (confidence >= minConfidence) {
              inferred.push({
                srcId,
                dstId: next,
                relationType,
                via: nextPath.slice(1, -1),
                confidence
              });
            }
          }
        }

        queue.push({ node: next, path: nextPath });
      }
    }
  }

  const dedup = new Map<string, TransitiveInference>();
  for (const row of inferred) {
    const key = `${row.srcId}|${row.relationType}|${row.dstId}`;
    const prev = dedup.get(key);
    if (!prev || row.confidence > prev.confidence) {
      dedup.set(key, row);
    }
  }

  return Array.from(dedup.values()).sort((a, b) => b.confidence - a.confidence);
}

function neighborsOf(entityId: string, relations: KnowledgeRelation[]): Set<string> {
  const neighbors = new Set<string>();
  for (const relation of relations) {
    if (relation.srcId === entityId) {
      neighbors.add(relation.dstId);
    }
    if (relation.dstId === entityId) {
      neighbors.add(relation.srcId);
    }
  }
  return neighbors;
}

export function findSimilarEntities(entityId: string, options?: { limit?: number }): SimilarEntity[] {
  const limit = Math.max(1, options?.limit ?? 5);
  const relations = listKnowledgeRelations();
  const allEntities = listKnowledgeEntities();
  const target = neighborsOf(entityId, relations);
  if (target.size === 0) {
    return [];
  }

  const result: SimilarEntity[] = [];
  for (const entity of allEntities) {
    if (entity.id === entityId) {
      continue;
    }
    const peer = neighborsOf(entity.id, relations);
    if (peer.size === 0) {
      continue;
    }

    let intersection = 0;
    for (const n of peer) {
      if (target.has(n)) {
        intersection += 1;
      }
    }

    if (intersection === 0) {
      continue;
    }

    const union = new Set([...target, ...peer]).size;
    const score = union === 0 ? 0 : intersection / union;

    result.push({
      entityId: entity.id,
      score,
      commonNeighborCount: intersection
    });
  }

  return result.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function detectCommunities(): GraphCommunity[] {
  const entities = listKnowledgeEntities();
  const relations = listKnowledgeRelations();
  const undirected = new Map<string, Set<string>>();

  for (const entity of entities) {
    undirected.set(entity.id, new Set());
  }
  for (const relation of relations) {
    if (!undirected.has(relation.srcId)) undirected.set(relation.srcId, new Set());
    if (!undirected.has(relation.dstId)) undirected.set(relation.dstId, new Set());
    undirected.get(relation.srcId)!.add(relation.dstId);
    undirected.get(relation.dstId)!.add(relation.srcId);
  }

  const visited = new Set<string>();
  const communities: GraphCommunity[] = [];

  for (const entity of entities) {
    if (visited.has(entity.id)) {
      continue;
    }

    const queue = [entity.id];
    const members = new Set<string>();
    visited.add(entity.id);

    while (queue.length > 0) {
      const id = queue.shift()!;
      members.add(id);
      for (const next of undirected.get(id) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    const memberEntities = entities.filter((row) => members.has(row.id));
    const relationCount = relations.filter((row) => members.has(row.srcId) && members.has(row.dstId)).length;

    communities.push({
      communityId: `community-${communities.length + 1}`,
      members: memberEntities,
      relationCount
    });
  }

  return communities.sort((a, b) => b.members.length - a.members.length);
}
