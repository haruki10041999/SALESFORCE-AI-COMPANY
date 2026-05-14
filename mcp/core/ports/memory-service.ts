import type { RequestContext } from "../runtime/request-context.js";
import type {
  HierarchicalIngestInput,
  HierarchicalIngestResult,
  HierarchicalMemoryPort,
  HierarchicalSearchInput,
  HierarchicalSearchOutput,
  VectorTier
} from "./hierarchical-memory-port.js";

export type {
  HierarchicalIngestInput,
  HierarchicalIngestResult,
  HierarchicalSearchInput,
  HierarchicalSearchOutput,
  VectorTier
};

export type HierarchicalStore = HierarchicalMemoryPort;

export interface MemoryReader {
  search(ctx: RequestContext, query: string): Promise<string[]>;
  search(query: string): Promise<string[]>;
  list(ctx: RequestContext): Promise<string[]>;
  list(): Promise<string[]>;
}

export interface MemoryWriter {
  add(ctx: RequestContext, text: string): Promise<void>;
  add(text: string): Promise<void>;
  clear(ctx: RequestContext): Promise<void>;
  clear(): Promise<void>;
}

export interface MemoryService extends MemoryReader, MemoryWriter {}
