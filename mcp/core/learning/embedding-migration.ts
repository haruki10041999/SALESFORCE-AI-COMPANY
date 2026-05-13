import type { VectorEmbeddingProvider } from "../llm/embedding-provider.js";

export interface EmbeddingRecordRow {
  id: string;
  tenantId: string | null;
  text: string;
  tags: string[];
  embeddingModel: string;
  embeddingDim: number;
}

export interface EmbeddingMigrationTarget {
  profileId: string;
  dimension: number;
}

export interface EmbeddingMigrationPlan {
  target: EmbeddingMigrationTarget;
  totalRows: number;
  rowsToMigrate: number;
  rowsAlreadyCurrent: number;
}

export function getEmbeddingProfileId(provider: Pick<VectorEmbeddingProvider, "name" | "dimension" | "profileId">): string {
  return provider.profileId ?? `${provider.name}:${provider.dimension}`;
}

export function buildEmbeddingMigrationPlan(
  rows: EmbeddingRecordRow[],
  provider: Pick<VectorEmbeddingProvider, "name" | "dimension" | "profileId">
): EmbeddingMigrationPlan {
  const target = {
    profileId: getEmbeddingProfileId(provider),
    dimension: provider.dimension
  };
  const rowsToMigrate = rows.filter((row) => row.embeddingModel !== target.profileId || row.embeddingDim !== target.dimension).length;
  return {
    target,
    totalRows: rows.length,
    rowsToMigrate,
    rowsAlreadyCurrent: rows.length - rowsToMigrate
  };
}

export function selectRowsForMigration(
  rows: EmbeddingRecordRow[],
  provider: Pick<VectorEmbeddingProvider, "name" | "dimension" | "profileId">,
  limit?: number
): EmbeddingRecordRow[] {
  const target = getEmbeddingProfileId(provider);
  const filtered = rows.filter((row) => row.embeddingModel !== target || row.embeddingDim !== provider.dimension);
  return typeof limit === "number" && Number.isFinite(limit) ? filtered.slice(0, Math.max(0, limit)) : filtered;
}