import type { RequestContext } from "../runtime/request-context.js";

export interface KnowledgeEntity {
  id: string;
  type: string;
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

export interface KnowledgeGraphHybridSearchResult {
  vectorResults: Array<{
    id: string;
    text: string;
    tags: string[];
    score?: number;
    updatedAt?: string;
  }>;
  seedEntities: KnowledgeEntity[];
  neighborEntities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
}

export interface KnowledgeGraphNeighbors {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
}

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

export interface KnowledgeGraphPort {
  ingestSummary(ctx: RequestContext, summary: string): Promise<{ entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }>;
  ingestSummary(summary: string): Promise<{ entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }>;
  listEntities(ctx: RequestContext): Promise<KnowledgeEntity[]>;
  listEntities(): Promise<KnowledgeEntity[]>;
  listRelations(ctx: RequestContext): Promise<KnowledgeRelation[]>;
  listRelations(): Promise<KnowledgeRelation[]>;
  searchEntities(ctx: RequestContext, query: string, limit?: number): Promise<KnowledgeEntity[]>;
  searchEntities(query: string, limit?: number): Promise<KnowledgeEntity[]>;
  getNeighbors(ctx: RequestContext, seedEntityIds: string[], options?: { hops?: number; limit?: number }): Promise<KnowledgeGraphNeighbors>;
  getNeighbors(seedEntityIds: string[], options?: { hops?: number; limit?: number }): Promise<KnowledgeGraphNeighbors>;
  searchHybrid(
    ctx: RequestContext,
    query: string,
    options?: { vectorK?: number; graphHops?: number; minScore?: number }
  ): Promise<KnowledgeGraphHybridSearchResult>;
  searchHybrid(
    query: string,
    options?: { vectorK?: number; graphHops?: number; minScore?: number }
  ): Promise<KnowledgeGraphHybridSearchResult>;
  inferTransitiveRelations(
    ctx: RequestContext,
    options?: { relationType?: string; maxDepth?: number; minConfidence?: number }
  ): Promise<TransitiveInference[]>;
  inferTransitiveRelations(options?: { relationType?: string; maxDepth?: number; minConfidence?: number }): Promise<TransitiveInference[]>;
  findSimilarEntities(ctx: RequestContext, entityId: string, options?: { limit?: number }): Promise<SimilarEntity[]>;
  findSimilarEntities(entityId: string, options?: { limit?: number }): Promise<SimilarEntity[]>;
  detectCommunities(ctx: RequestContext): Promise<GraphCommunity[]>;
  detectCommunities(): Promise<GraphCommunity[]>;
}
