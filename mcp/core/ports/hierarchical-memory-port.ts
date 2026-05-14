import type { RequestContext } from "../runtime/request-context.js";

export interface HierarchicalIngestInput {
  id: string;
  content: string;
  title: string;
  isMarkdown?: boolean;
}

export interface HierarchicalIngestResult {
  documentId: string;
  sections: number;
  chunks: number;
}

export type VectorTier = "hot" | "warm" | "cold";

export interface HierarchicalSearchInput {
  query: string;
  limit?: number;
  expandTo?: "chunk" | "section" | "document";
  minScore?: number;
  withContext?: boolean;
}

export interface HierarchicalSearchOutput {
  type: "chunk" | "section" | "document";
  sectionIndex: number;
  chunkIndex?: number;
  score: number;
  text: string;
  documentId: string;
  summary?: string;
  tier?: VectorTier;
  context?: {
    prevChunk?: string;
    nextChunk?: string;
    sectionSummary?: string;
  };
}

export interface HierarchicalMemoryPort {
  ingest(ctx: RequestContext, input: HierarchicalIngestInput): Promise<HierarchicalIngestResult>;
  ingest(input: HierarchicalIngestInput): Promise<HierarchicalIngestResult>;
  search(ctx: RequestContext, input: HierarchicalSearchInput): Promise<HierarchicalSearchOutput[]>;
  search(input: HierarchicalSearchInput): Promise<HierarchicalSearchOutput[]>;
}
