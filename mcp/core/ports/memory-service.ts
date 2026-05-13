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

export interface HierarchicalStore {
  ingest(input: HierarchicalIngestInput): Promise<HierarchicalIngestResult>;
  search(input: HierarchicalSearchInput): Promise<HierarchicalSearchOutput[]>;
}

export interface MemoryService {
  add(text: string): Promise<void>;
  search(query: string): Promise<string[]>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
}
