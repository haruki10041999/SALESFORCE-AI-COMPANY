/**
 * Hierarchical Memory Store
 *
 * Provides hierarchical retrieval: chunk → section → document
 * Complements flat memory_records for better long-document handling
 */

import type { MemoryChunker, ChunkedDocument } from "./chunker.js";
import { createEmbeddingProvider, type VectorEmbeddingProvider } from "../mcp/core/llm/embedding-provider.js";

export interface HierarchicalSearchResult {
  type: "chunk" | "section" | "document";
  sectionIndex: number;
  chunkIndex?: number;
  score: number;
  text: string;
  documentId: string;
  summary?: string;
  context?: {
    prevChunk?: string;
    nextChunk?: string;
    sectionSummary?: string;
  };
}

export interface HierarchicalSearchOptions {
  limit?: number;
  expandTo?: "chunk" | "section" | "document";
  minScore?: number;
  withContext?: boolean;
}

/**
 * In-memory implementation of hierarchical memory store
 * (For production, migrate to Postgres with pgvector)
 */
export class HierarchicalMemoryStore {
  private documents: Map<string, ChunkedDocument & { id: string; timestamp: number }> = new Map();
  private vectors: Map<string, number[]> = new Map(); // chunk/section vectors
  private readonly embeddingProvider: VectorEmbeddingProvider;

  constructor(private chunker: MemoryChunker, embeddingProvider?: VectorEmbeddingProvider) {
    this.embeddingProvider = embeddingProvider ?? createEmbeddingProvider({
      env: {
        ...process.env,
        EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER ?? "ngram"
      }
    });
  }

  /**
   * Ingest a document (chunk + embed sections)
   */
  async ingestDocument(
    id: string,
    content: string,
    title: string,
    isMarkdown: boolean = true
  ): Promise<{ documentId: string; sections: number; chunks: number }> {
    const chunked = isMarkdown
      ? this.chunker.chunkMarkdown(content, title)
      : this.chunker.chunkPlainText(content, title);

    const doc = {
      ...chunked,
      id,
      timestamp: Date.now(),
    };

    this.documents.set(id, doc);

    // Register vectors (placeholder for actual embedding)
    let totalChunks = 0;
    for (const [sIdx, section] of doc.sections.entries()) {
      // Generate summary if not present
      if (!section.summary && section.content) {
        section.summary = this.generateSectionSummary(section.content);
      }

      // Vector for section summary
      const sectionKey = `section:${id}:${sIdx}`;
      const summary = section.summary || section.content.substring(0, 100);
      this.vectors.set(sectionKey, await this.embedText(summary));

      // Vectors for chunks
      for (const [cIdx, chunk] of section.chunks.entries()) {
        const chunkKey = `chunk:${id}:${sIdx}:${cIdx}`;
        this.vectors.set(chunkKey, await this.embedText(chunk.text));
        totalChunks++;
      }
    }

    return {
      documentId: id,
      sections: doc.sections.length,
      chunks: totalChunks,
    };
  }

  /**
   * Search with hierarchical expansion
   */
  async search(
    query: string,
    options: HierarchicalSearchOptions = {}
  ): Promise<HierarchicalSearchResult[]> {
    const { limit = 5, expandTo = "chunk", minScore = 0.5, withContext = false } = options;

    const results: HierarchicalSearchResult[] = [];
    const queryVector = await this.embedText(query);

    // Search all chunks
    for (const [key, vector] of this.vectors) {
      if (!key.startsWith("chunk:")) continue;

      const score = this.cosineSimilarity(queryVector, vector);
      if (score < minScore) continue;

      const [, docId, sIdx, cIdx] = key.split(":");
      const doc = this.documents.get(docId);
      if (!doc) continue;

      const section = doc.sections[parseInt(sIdx)];
      const chunk = section.chunks[parseInt(cIdx)];

      const result: HierarchicalSearchResult = {
        type: "chunk",
        sectionIndex: parseInt(sIdx),
        chunkIndex: parseInt(cIdx),
        score,
        text: chunk.text,
        documentId: docId,
      };

      if (withContext) {
        result.context = {
          sectionSummary: section.summary,
        };

        // Add prev/next chunk context
        const chunks = section.chunks;
        const cIdxNum = parseInt(cIdx);
        if (cIdxNum > 0) {
          result.context.prevChunk = chunks[cIdxNum - 1].text.substring(0, 200);
        }
        if (cIdxNum < chunks.length - 1) {
          result.context.nextChunk = chunks[cIdxNum + 1].text.substring(0, 200);
        }
      }

      results.push(result);
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    // Expand if requested
    if (expandTo === "section") {
      return this.expandToSections(results.slice(0, limit));
    }

    if (expandTo === "document") {
      return this.expandToDocuments(results.slice(0, limit));
    }

    return results.slice(0, limit);
  }

  /**
   * Expand chunk results to full sections
   */
  private expandToSections(chunks: HierarchicalSearchResult[]): HierarchicalSearchResult[] {
    const sectionMap = new Map<string, HierarchicalSearchResult>();

    for (const chunk of chunks) {
      const key = `${chunk.documentId}:${chunk.sectionIndex}`;
      if (sectionMap.has(key)) continue; // Already added

      const doc = this.documents.get(chunk.documentId);
      if (!doc) continue;

      const section = doc.sections[chunk.sectionIndex];
      const sectionText = section.chunks.map((chunk: any) => chunk.text).join("\n");

      sectionMap.set(key, {
        type: "section",
        sectionIndex: chunk.sectionIndex,
        score: chunk.score,
        text: sectionText,
        documentId: chunk.documentId,
        summary: section.summary,
      });
    }

    return Array.from(sectionMap.values());
  }

  /**
   * Expand chunk results to full documents
   */
  private expandToDocuments(chunks: HierarchicalSearchResult[]): HierarchicalSearchResult[] {
    const docMap = new Map<string, HierarchicalSearchResult>();

    for (const chunk of chunks) {
      const docId = chunk.documentId;
      if (docMap.has(docId)) continue; // Already added

      const doc = this.documents.get(docId);
      if (!doc) continue;

      const fullText = doc.sections.map((section: any) => section.content).join("\n\n");

      docMap.set(docId, {
        type: "document",
        sectionIndex: -1,
        score: chunk.score,
        text: fullText,
        documentId: docId,
        summary: doc.title,
      });
    }

    return Array.from(docMap.values());
  }

  /**
   * Get document by ID
   */
  getDocument(id: string): ChunkedDocument | undefined {
    const doc = this.documents.get(id);
    return doc ? { title: doc.title, sections: doc.sections, estimatedTokens: doc.estimatedTokens } : undefined;
  }

  /**
   * List all documents
   */
  listDocuments() {
    return Array.from(this.documents.values()).map((d) => ({
      id: d.id,
      title: d.title,
      sections: d.sections.length,
      estimatedTokens: d.estimatedTokens,
      timestamp: d.timestamp,
    }));
  }

  /**
   * Clear store
   */
  clear(): void {
    this.documents.clear();
    this.vectors.clear();
  }

  // Helpers

  private generateSectionSummary(text: string): string {
    const words = text.split(/\s+/).slice(0, 50);
    return words.join(" ") + (words.length < 50 ? "" : "...");
  }

  private async embedText(text: string): Promise<number[]> {
    const targetDim = this.embeddingProvider.dimension ?? 768;
    const embedded = await this.embeddingProvider.embed(text);
    if (embedded.length === targetDim) {
      return embedded;
    }
    if (embedded.length > targetDim) {
      return embedded.slice(0, targetDim);
    }
    return [...embedded, ...Array(targetDim - embedded.length).fill(0)];
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let magA = 0;
    let magB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    const mag = Math.sqrt(magA) * Math.sqrt(magB);
    return mag === 0 ? 0 : dotProduct / mag;
  }
}
