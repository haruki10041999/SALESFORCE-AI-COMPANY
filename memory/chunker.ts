/**
 * Memory Chunker
 *
 * Converts large documents into hierarchical chunks for better retrieval.
 * Supports markdown and plain text with configurable token limits.
 */

interface ChunkConfig {
  maxTokensPerChunk?: number; // default: 256
  overlapTokens?: number; // default: 50
  minChunkTokens?: number; // default: 20
}

interface Section {
  heading: string; // e.g., "## Introduction"
  level: number; // 1-6 for markdown, 1 for plain
  content: string;
  summary?: string;
}

interface Chunk {
  text: string;
  startToken: number;
  endToken: number;
  sectionIndex: number;
}

export interface ChunkedDocument {
  title: string;
  sections: (Section & { chunks: Chunk[] })[];
  estimatedTokens: number;
}

export class MemoryChunker {
  private config: Required<ChunkConfig>;

  constructor(config: ChunkConfig = {}) {
    this.config = {
      maxTokensPerChunk: config.maxTokensPerChunk ?? 256,
      overlapTokens: config.overlapTokens ?? 50,
      minChunkTokens: config.minChunkTokens ?? 20,
    };
  }

  /**
   * Chunk a markdown document into sections and chunks
   */
  chunkMarkdown(content: string, title: string = "Untitled"): ChunkedDocument {
    const sections = this.parseMarkdownSections(content);
    const withChunks = sections.map((section) => ({
      ...section,
      chunks: this.chunkText(section.content),
    }));

    const totalTokens = withChunks.reduce(
      (sum, s) => sum + s.chunks.reduce((s2, c) => s2 + (c.endToken - c.startToken), 0),
      0
    );

    return {
      title,
      sections: withChunks,
      estimatedTokens: totalTokens,
    };
  }

  /**
   * Chunk plain text
   */
  chunkPlainText(content: string, title: string = "Untitled"): ChunkedDocument {
    return {
      title,
      sections: [
        {
          heading: "",
          level: 1,
          content,
          chunks: this.chunkText(content),
        },
      ],
      estimatedTokens: this.estimateTokens(content),
    };
  }

  /**
   * Parse markdown into sections by heading level
   */
  private parseMarkdownSections(content: string): Section[] {
    const sections: Section[] = [];
    const lines = content.split("\n");
    let currentSection: { heading: string; level: number; lines: string[] } | null = null;

    for (const line of lines) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (headingMatch) {
        // Save previous section
        if (currentSection) {
          sections.push({
            heading: currentSection.heading,
            level: currentSection.level,
            content: currentSection.lines.join("\n").trim(),
          });
        }

        // Start new section
        currentSection = {
          heading: line,
          level: headingMatch[1].length,
          lines: [],
        };
      } else if (currentSection) {
        currentSection.lines.push(line);
      } else {
        // Content before first heading
        if (!sections[0]) {
          sections.push({ heading: "", level: 0, content: "" });
        }
        if (sections[0].content) {
          sections[0].content += "\n" + line;
        } else {
          sections[0].content = line;
        }
      }
    }

    // Save last section
    if (currentSection) {
      sections.push({
        heading: currentSection.heading,
        level: currentSection.level,
        content: currentSection.lines.join("\n").trim(),
      });
    }

    return sections.filter((s) => s.content.length > 0);
  }

  /**
   * Split text into token-bounded chunks with overlap
   */
  private chunkText(text: string): Chunk[] {
    if (!text || text.trim().length === 0) return [];

    const chunks: Chunk[] = [];
    const sentences = this.splitIntoSentences(text);

    if (sentences.length === 0) return [];

    let currentChunk: string[] = [];
    let currentTokens = 0;
    let chunkStartToken = 0;
    let overallTokenCount = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokens(sentence);

      // If adding this sentence would exceed limit and we have content
      if (currentTokens + sentenceTokens > this.config.maxTokensPerChunk && currentChunk.length > 0) {
        // Save chunk if it meets minimum size
        if (currentTokens >= this.config.minChunkTokens) {
          const chunkText = currentChunk.join(" ");
          chunks.push({
            text: chunkText,
            startToken: chunkStartToken,
            endToken: overallTokenCount,
            sectionIndex: 0,
          });
        }

        // Keep last few sentences for overlap
        const overlap = Math.min(this.config.overlapTokens, Math.floor(currentTokens / 2));
        let overlapTokens = 0;
        let overlapIdx = currentChunk.length;

        for (let i = currentChunk.length - 1; i >= 0; i--) {
          overlapTokens += this.estimateTokens(currentChunk[i]);
          overlapIdx = i;
          if (overlapTokens >= overlap) break;
        }

        chunkStartToken = overallTokenCount - overlapTokens;
        currentChunk = currentChunk.slice(overlapIdx);
        currentTokens = overlapTokens;
      }

      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
      overallTokenCount += sentenceTokens;
    }

    // Final chunk
    if (currentChunk.length > 0 && currentTokens >= this.config.minChunkTokens) {
      chunks.push({
        text: currentChunk.join(" "),
        startToken: chunkStartToken,
        endToken: overallTokenCount,
        sectionIndex: 0,
      });
    }

    // If no chunks were created but text exists, create one anyway if text is meaningful
    if (chunks.length === 0 && overallTokenCount > 0) {
      chunks.push({
        text: text.substring(0, 500), // limit to 500 chars
        startToken: 0,
        endToken: overallTokenCount,
        sectionIndex: 0,
      });
    }

    return chunks;
  }

  /**
   * Split text into sentences (basic)
   */
  private splitIntoSentences(text: string): string[] {
    // Simple sentence splitting on . ! ?
    const regex = /[^.!?]+[.!?]+/g;
    const matches = text.match(regex) || [];
    return matches
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.replace(/\s+/g, " "));
  }

  /**
   * Estimate token count (rough approximation: 1 token ≈ 4 chars)
   */
  private estimateTokens(text: string): number {
    // Simple heuristic: ~4 chars per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate summary for a section (placeholder)
   */
  generateSectionSummary(section: Section): string {
    const words = section.content.split(/\s+/).slice(0, 50);
    return words.join(" ") + (words.length < 50 ? "" : "...");
  }
}
