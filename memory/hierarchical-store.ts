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
  useKnowledgeGraph?: boolean;
}

export interface KnowledgeGraphSearchOptions extends HierarchicalSearchOptions {
  useKnowledgeGraph?: boolean;
  kgMaxDepth?: number;
  kgMinCommunitySize?: number;
  kgReasoningWeight?: number; // 0-1, weight for KG results vs vector results
}

export interface HybridSearchResult extends HierarchicalSearchResult {
  inferredVia?: "vector" | "knowledge_graph" | "hybrid";
  kgConfidence?: number;
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

  /**
   * Search with KG reasoner integration (hybrid retrieval)
   * Combines vector search with knowledge graph transitive closure and community detection
   */
  async searchWithKnowledgeGraph(
    query: string,
    options: KnowledgeGraphSearchOptions = {}
  ): Promise<HybridSearchResult[]> {
    const { limit = 5, expandTo = "chunk", minScore = 0.5, withContext = false, 
            kgMaxDepth = 3, kgMinCommunitySize = 2, kgReasoningWeight = 0.4 } = options;

    // Step 1: Vector search for seed results
    const vectorResults = await this.search(query, { limit: limit * 2, expandTo, minScore, withContext });

    // Dynamic import of KG reasoner to avoid circular dependency
    let kgResults: HybridSearchResult[] = [];
    try {
      const { inferTransitiveRelations, detectCommunities } = await import("../mcp/core/memory/kg-reasoner.js");

      // Step 2: Use KG reasoner for transitive closure from seed documents
      const seedDocIds = new Set(vectorResults.map(r => r.documentId));
      const inferred = inferTransitiveRelations({ maxDepth: kgMaxDepth });
      const transitiveEntities = new Set<string>();
      
      // Collect all entities reachable from seed documents
      for (const rel of inferred) {
        if (seedDocIds.has(rel.srcId)) {
          transitiveEntities.add(rel.dstId);
        }
      }

      // Step 3: Detect communities in the knowledge graph
      const communities = detectCommunities();
      
      // Step 4: Re-score results by KG proximity to communities
      for (const result of vectorResults) {
        const inCommunity = communities.some(c => 
          c.members.some(m => m.id === result.documentId)
        );
        const score = result.score;
        const kgConfidence = inCommunity ? 0.8 : (transitiveEntities.has(result.documentId) ? 0.6 : 0.3);
        
        kgResults.push({
          ...result,
          score: (score * (1 - kgReasoningWeight)) + (kgConfidence * kgReasoningWeight),
          inferredVia: "hybrid",
          kgConfidence
        });
      }

      // Step 5: Blend in transitive closure entities not yet in results
      for (const entityId of transitiveEntities) {
        if (!kgResults.some(r => r.documentId === entityId)) {
          const relatedDocs = this.documents.get(entityId);
          if (relatedDocs) {
            kgResults.push({
              type: "document",
              sectionIndex: 0,
              score: 0.5 * kgReasoningWeight, // lower score for inferred-only results
              text: relatedDocs.sections[0]?.content || "",
              documentId: entityId,
              summary: relatedDocs.title,
              inferredVia: "knowledge_graph",
              kgConfidence: 0.5
            });
          }
        }
      }
    } catch (e) {
      // KG reasoner not available, fall back to pure vector results
      return vectorResults.map(r => ({
        ...r,
        inferredVia: "vector" as const
      }));
    }

    // Sort by hybrid score and return top-k
    kgResults.sort((a, b) => b.score - a.score);
    return kgResults.slice(0, limit);
  }

  /**
   * Classify document's memory tier (hot/warm/cold) for TTL policy
   */
  classifyDocumentTier(documentId: string): "hot" | "warm" | "cold" {
    const doc = this.documents.get(documentId);
    if (!doc) return "cold";

    const ageMs = Date.now() - doc.timestamp;
    const ageDays = ageMs / (24 * 60 * 60 * 1000);
    const sectionsCount = doc.sections.length;

    // Hot: recent (< 7 days), small (< 3 sections)
    if (ageDays <= 7 && sectionsCount < 3) return "hot";

    // Warm: medium age (7-90 days) or medium size (3-10 sections)
    if ((ageDays <= 90 && sectionsCount < 10) || (ageDays <= 30)) return "warm";

    // Cold: old (> 90 days) or large (> 10 sections)
    return "cold";
  }

  /**
   * Prune documents by TTL policy (remove cold documents older than maxAgeDays)
   */
  pruneColdDocuments(maxAgeDays: number = 365): number {
    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const [docId, doc] of this.documents) {
      const ageMs = now - doc.timestamp;
      const tier = this.classifyDocumentTier(docId);

      // Only prune cold-tier documents
      if (tier === "cold" && ageMs > maxAgeMs) {
        // Remove document vectors
        for (const key of this.vectors.keys()) {
          if (key.includes(`${docId}:`)) {
            this.vectors.delete(key);
          }
        }
        // Remove document
        this.documents.delete(docId);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Get tier statistics for observability
   */
  getTierStatistics(): { hot: number; warm: number; cold: number; totalDocuments: number; totalAge: number } {
    let hot = 0, warm = 0, cold = 0;
    let totalAge = 0;

    for (const docId of this.documents.keys()) {
      const tier = this.classifyDocumentTier(docId);
      const doc = this.documents.get(docId)!;
      totalAge += Date.now() - doc.timestamp;

      if (tier === "hot") hot++;
      else if (tier === "warm") warm++;
      else cold++;
    }

    return {
      hot,
      warm,
      cold,
      totalDocuments: this.documents.size,
      totalAge: Math.round(totalAge / this.documents.size)
    };
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
