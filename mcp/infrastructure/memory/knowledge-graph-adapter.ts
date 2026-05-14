import {
  getKnowledgeNeighbors,
  ingestKnowledgeSummary,
  listKnowledgeEntities,
  listKnowledgeRelations,
  searchHybrid,
  searchKnowledgeEntities
} from "../../../memory/knowledge-graph.js";
import {
  detectCommunities,
  findSimilarEntities,
  inferTransitiveRelations
} from "../../core/memory/kg-reasoner.js";
import type {
  GraphCommunity,
  KnowledgeEntity,
  KnowledgeGraphHybridSearchResult,
  KnowledgeGraphNeighbors,
  KnowledgeGraphPort,
  KnowledgeRelation,
  SimilarEntity,
  TransitiveInference
} from "../../core/ports/knowledge-graph-port.js";
import type { RequestContext } from "../../core/runtime/request-context.js";

export class KnowledgeGraphAdapter implements KnowledgeGraphPort {
  public async ingestSummary(
    _ctx: RequestContext,
    summary: string
  ): Promise<{ entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }>;
  public async ingestSummary(summary: string): Promise<{ entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }>;
  public async ingestSummary(
    ctxOrSummary: RequestContext | string,
    maybeSummary?: string
  ): Promise<{ entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }> {
    const summary = typeof ctxOrSummary === "string" ? ctxOrSummary : (maybeSummary ?? "");
    const result = ingestKnowledgeSummary(summary);
    return {
      entities: result.entities as KnowledgeEntity[],
      relations: result.relations as KnowledgeRelation[]
    };
  }

  public async listEntities(_ctx: RequestContext): Promise<KnowledgeEntity[]>;
  public async listEntities(): Promise<KnowledgeEntity[]>;
  public async listEntities(): Promise<KnowledgeEntity[]> {
    return listKnowledgeEntities() as KnowledgeEntity[];
  }

  public async listRelations(_ctx: RequestContext): Promise<KnowledgeRelation[]>;
  public async listRelations(): Promise<KnowledgeRelation[]>;
  public async listRelations(): Promise<KnowledgeRelation[]> {
    return listKnowledgeRelations() as KnowledgeRelation[];
  }

  public async searchEntities(_ctx: RequestContext, query: string, limit?: number): Promise<KnowledgeEntity[]>;
  public async searchEntities(query: string, limit?: number): Promise<KnowledgeEntity[]>;
  public async searchEntities(
    ctxOrQuery: RequestContext | string,
    queryOrLimit?: string | number,
    maybeLimit?: number
  ): Promise<KnowledgeEntity[]> {
    const query = typeof ctxOrQuery === "string" ? ctxOrQuery : String(queryOrLimit ?? "");
    const limit = typeof ctxOrQuery === "string" ? (queryOrLimit as number | undefined) : maybeLimit;
    return searchKnowledgeEntities(query, limit) as KnowledgeEntity[];
  }

  public async getNeighbors(_ctx: RequestContext, seedEntityIds: string[], options?: { hops?: number; limit?: number }): Promise<KnowledgeGraphNeighbors>;
  public async getNeighbors(seedEntityIds: string[], options?: { hops?: number; limit?: number }): Promise<KnowledgeGraphNeighbors>;
  public async getNeighbors(
    ctxOrSeedEntityIds: RequestContext | string[],
    seedEntityIdsOrOptions?: string[] | { hops?: number; limit?: number },
    maybeOptions?: { hops?: number; limit?: number }
  ): Promise<KnowledgeGraphNeighbors> {
    const seedEntityIds = Array.isArray(ctxOrSeedEntityIds)
      ? ctxOrSeedEntityIds
      : (seedEntityIdsOrOptions as string[]);
    const options = Array.isArray(ctxOrSeedEntityIds)
      ? (seedEntityIdsOrOptions as { hops?: number; limit?: number } | undefined)
      : maybeOptions;
    const neighbors = getKnowledgeNeighbors(seedEntityIds, options);
    return {
      entities: neighbors.entities as KnowledgeEntity[],
      relations: neighbors.relations as KnowledgeRelation[]
    };
  }

  public async searchHybrid(
    _ctx: RequestContext,
    query: string,
    options?: { vectorK?: number; graphHops?: number; minScore?: number }
  ): Promise<KnowledgeGraphHybridSearchResult>;
  public async searchHybrid(
    query: string,
    options?: { vectorK?: number; graphHops?: number; minScore?: number }
  ): Promise<KnowledgeGraphHybridSearchResult>;
  public async searchHybrid(
    ctxOrQuery: RequestContext | string,
    queryOrOptions?: string | { vectorK?: number; graphHops?: number; minScore?: number },
    maybeOptions?: { vectorK?: number; graphHops?: number; minScore?: number }
  ): Promise<KnowledgeGraphHybridSearchResult> {
    const query = typeof ctxOrQuery === "string" ? ctxOrQuery : String(queryOrOptions ?? "");
    const options = typeof ctxOrQuery === "string"
      ? (queryOrOptions as { vectorK?: number; graphHops?: number; minScore?: number } | undefined)
      : maybeOptions;
    const result = await searchHybrid(query, options);
    return {
      vectorResults: result.vectorResults,
      seedEntities: result.seedEntities as KnowledgeEntity[],
      neighborEntities: result.neighborEntities as KnowledgeEntity[],
      relations: result.relations as KnowledgeRelation[]
    };
  }

  public async inferTransitiveRelations(
    _ctx: RequestContext,
    options?: { relationType?: string; maxDepth?: number; minConfidence?: number }
  ): Promise<TransitiveInference[]>;
  public async inferTransitiveRelations(
    options?: { relationType?: string; maxDepth?: number; minConfidence?: number }
  ): Promise<TransitiveInference[]>;
  public async inferTransitiveRelations(
    ctxOrOptions?: RequestContext | { relationType?: string; maxDepth?: number; minConfidence?: number },
    maybeOptions?: { relationType?: string; maxDepth?: number; minConfidence?: number }
  ): Promise<TransitiveInference[]> {
    const options = (typeof (ctxOrOptions as RequestContext | undefined)?.actorId === "string"
      ? maybeOptions
      : ctxOrOptions) as { relationType?: string; maxDepth?: number; minConfidence?: number } | undefined;
    return inferTransitiveRelations(options) as TransitiveInference[];
  }

  public async findSimilarEntities(_ctx: RequestContext, entityId: string, options?: { limit?: number }): Promise<SimilarEntity[]>;
  public async findSimilarEntities(entityId: string, options?: { limit?: number }): Promise<SimilarEntity[]>;
  public async findSimilarEntities(
    ctxOrEntityId: RequestContext | string,
    entityIdOrOptions?: string | { limit?: number },
    maybeOptions?: { limit?: number }
  ): Promise<SimilarEntity[]> {
    const entityId = typeof ctxOrEntityId === "string" ? ctxOrEntityId : String(entityIdOrOptions ?? "");
    const options = typeof ctxOrEntityId === "string" ? (entityIdOrOptions as { limit?: number } | undefined) : maybeOptions;
    return findSimilarEntities(entityId, options) as SimilarEntity[];
  }

  public async detectCommunities(_ctx: RequestContext): Promise<GraphCommunity[]>;
  public async detectCommunities(): Promise<GraphCommunity[]>;
  public async detectCommunities(): Promise<GraphCommunity[]> {
    return detectCommunities() as GraphCommunity[];
  }
}

export function createKnowledgeGraphAdapter(): KnowledgeGraphPort {
  return new KnowledgeGraphAdapter();
}
