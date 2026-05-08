import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MemoryRecord } from "./vector-store-adapter.js";
import {
  extractEntitiesFromSummary,
  type ExtractedEntity,
  type ExtractedRelation,
  type KnowledgeEntityType
} from "./graph-extractor.js";
import { searchByKeywordAsync } from "./vector-store.js";

export interface KnowledgeEntity {
  id: string;
  type: KnowledgeEntityType;
  name: string;
  attributes: Record<string, unknown>;
  updatedAt: string;
}

export interface KnowledgeRelation {
  id: string;
  srcId: string;
  relationType: string;
  dstId: string;
  weight: number;
  evidence?: string;
  updatedAt: string;
}

interface PersistedKnowledgeGraph {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
}

export interface HybridSearchResult {
  vectorResults: Array<MemoryRecord & { score?: number }>;
  seedEntities: KnowledgeEntity[];
  neighborEntities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_GRAPH_FILE = join(ROOT, "outputs", "knowledge-graph.json");

let graphFilePath = process.env.SF_AI_KNOWLEDGE_GRAPH_FILE ?? DEFAULT_GRAPH_FILE;

const entities = new Map<string, KnowledgeEntity>();
const relations = new Map<string, KnowledgeRelation>();

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function slug(input: string): string {
  const compact = normalize(input)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return compact.length > 0 ? compact : "unknown";
}

function makeEntityId(type: KnowledgeEntityType, name: string): string {
  return `${type}:${slug(name)}`;
}

function makeRelationId(srcId: string, relationType: string, dstId: string): string {
  return `${srcId}|${normalize(relationType)}|${dstId}`;
}

function ensureStorageDir(): void {
  mkdirSync(dirname(graphFilePath), { recursive: true });
}

function saveGraphToDisk(): void {
  ensureStorageDir();
  const payload: PersistedKnowledgeGraph = {
    entities: Array.from(entities.values()),
    relations: Array.from(relations.values())
  };
  writeFileSync(graphFilePath, JSON.stringify(payload, null, 2), "utf-8");
}

function loadGraphFromDisk(): void {
  entities.clear();
  relations.clear();
  if (!existsSync(graphFilePath)) {
    return;
  }
  try {
    const raw = readFileSync(graphFilePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PersistedKnowledgeGraph>;
    for (const entity of parsed.entities ?? []) {
      if (!entity?.id || !entity?.name || !entity?.type) continue;
      entities.set(entity.id, {
        id: entity.id,
        name: entity.name,
        type: entity.type,
        attributes: entity.attributes ?? {},
        updatedAt: entity.updatedAt ?? new Date().toISOString()
      });
    }
    for (const relation of parsed.relations ?? []) {
      if (!relation?.id || !relation?.srcId || !relation?.dstId || !relation?.relationType) continue;
      relations.set(relation.id, {
        id: relation.id,
        srcId: relation.srcId,
        dstId: relation.dstId,
        relationType: relation.relationType,
        weight: Number.isFinite(relation.weight) ? relation.weight : 1,
        evidence: relation.evidence,
        updatedAt: relation.updatedAt ?? new Date().toISOString()
      });
    }
  } catch {
    // Keep runtime resilient; fall back to in-memory graph.
  }
}

function entityMatchesQuery(entity: KnowledgeEntity, query: string): boolean {
  const q = normalize(query);
  if (q.length === 0) return false;
  return normalize(entity.name).includes(q) || normalize(entity.type).includes(q);
}

function mergeAttributes(
  previous: Record<string, unknown>,
  next?: Record<string, unknown>
): Record<string, unknown> {
  if (!next) {
    return previous;
  }
  return { ...previous, ...next };
}

export function configureKnowledgeGraphStorageForTest(filePath: string): void {
  graphFilePath = filePath;
  loadGraphFromDisk();
}

export function clearKnowledgeGraph(): void {
  entities.clear();
  relations.clear();
  saveGraphToDisk();
}

export function upsertEntity(entity: ExtractedEntity): KnowledgeEntity {
  const now = new Date().toISOString();
  const id = makeEntityId(entity.type, entity.name);
  const existing = entities.get(id);
  const next: KnowledgeEntity = {
    id,
    type: entity.type,
    name: entity.name,
    attributes: mergeAttributes(existing?.attributes ?? {}, entity.attributes),
    updatedAt: now
  };
  entities.set(id, next);
  saveGraphToDisk();
  return next;
}

export function addRelation(relation: ExtractedRelation): KnowledgeRelation {
  const src = upsertEntity({ type: relation.srcType, name: relation.srcName });
  const dst = upsertEntity({ type: relation.dstType, name: relation.dstName });

  const now = new Date().toISOString();
  const id = makeRelationId(src.id, relation.relationType, dst.id);
  const existing = relations.get(id);

  const next: KnowledgeRelation = {
    id,
    srcId: src.id,
    dstId: dst.id,
    relationType: relation.relationType,
    weight: Math.max(1, (existing?.weight ?? 0) + (relation.weight ?? 1)),
    evidence: relation.evidence ?? existing?.evidence,
    updatedAt: now
  };
  relations.set(id, next);
  saveGraphToDisk();
  return next;
}

export function ingestKnowledgeSummary(summary: string): {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
} {
  const extracted = extractEntitiesFromSummary(summary);
  const persistedEntities = extracted.entities.map((entity) => upsertEntity(entity));
  const persistedRelations = extracted.relations.map((relation) => addRelation(relation));
  return { entities: persistedEntities, relations: persistedRelations };
}

export function listKnowledgeEntities(): KnowledgeEntity[] {
  return Array.from(entities.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function listKnowledgeRelations(): KnowledgeRelation[] {
  return Array.from(relations.values()).sort((a, b) => b.weight - a.weight);
}

export function searchKnowledgeEntities(query: string, limit = 10): KnowledgeEntity[] {
  return listKnowledgeEntities().filter((entity) => entityMatchesQuery(entity, query)).slice(0, limit);
}

export function getKnowledgeNeighbors(
  seedEntityIds: string[],
  options: { hops?: number; limit?: number } = {}
): { entities: KnowledgeEntity[]; relations: KnowledgeRelation[] } {
  const hops = Math.max(1, options.hops ?? 1);
  const limit = Math.max(1, options.limit ?? 50);

  const frontier = new Set(seedEntityIds);
  const seenEntities = new Set(seedEntityIds);
  const seenRelations = new Set<string>();

  for (let depth = 0; depth < hops; depth++) {
    const current = Array.from(frontier);
    frontier.clear();

    for (const relation of relations.values()) {
      if (!current.includes(relation.srcId) && !current.includes(relation.dstId)) {
        continue;
      }
      seenRelations.add(relation.id);
      if (!seenEntities.has(relation.srcId)) {
        seenEntities.add(relation.srcId);
        frontier.add(relation.srcId);
      }
      if (!seenEntities.has(relation.dstId)) {
        seenEntities.add(relation.dstId);
        frontier.add(relation.dstId);
      }
      if (seenRelations.size >= limit) {
        break;
      }
    }
    if (seenRelations.size >= limit) {
      break;
    }
  }

  const neighborEntities = Array.from(seenEntities)
    .map((id) => entities.get(id))
    .filter((value): value is KnowledgeEntity => Boolean(value))
    .slice(0, limit);
  const neighborRelations = Array.from(seenRelations)
    .map((id) => relations.get(id))
    .filter((value): value is KnowledgeRelation => Boolean(value))
    .slice(0, limit);

  return { entities: neighborEntities, relations: neighborRelations };
}

export async function searchHybrid(
  query: string,
  options: { vectorK?: number; graphHops?: number; minScore?: number } = {}
): Promise<HybridSearchResult> {
  const vectorResults = await searchByKeywordAsync(query, {
    limit: options.vectorK ?? 5,
    minScore: options.minScore ?? 0
  });

  const seeds = searchKnowledgeEntities(query, options.vectorK ?? 5);
  const seedById = new Map(seeds.map((entity) => [entity.id, entity]));

  for (const result of vectorResults) {
    const text = normalize(result.text);
    for (const entity of entities.values()) {
      if (text.includes(normalize(entity.name))) {
        seedById.set(entity.id, entity);
      }
    }
  }

  const seedEntities = Array.from(seedById.values());
  const neighbors = getKnowledgeNeighbors(
    seedEntities.map((entity) => entity.id),
    { hops: options.graphHops ?? 1, limit: 40 }
  );

  return {
    vectorResults,
    seedEntities,
    neighborEntities: neighbors.entities,
    relations: neighbors.relations
  };
}

loadGraphFromDisk();
