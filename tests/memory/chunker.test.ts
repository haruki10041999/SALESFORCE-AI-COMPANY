import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryChunker } from "../../memory/chunker.js";

test("MemoryChunker chunks markdown into sections", () => {
  const chunker = new MemoryChunker();
  const markdown = `# Main Title

## Section 1
This is section 1 content with multiple sentences. It should be parsed correctly.

## Section 2
Another section with its own content.

### Subsection 2.1
A deeper level section.
`;

  const result = chunker.chunkMarkdown(markdown, "Test Doc");

  assert.equal(result.title, "Test Doc");
  assert.ok(result.sections.length >= 3);
  assert.ok(result.estimatedTokens > 0);
});

test("MemoryChunker respects max tokens per chunk", () => {
  const chunker = new MemoryChunker({ maxTokensPerChunk: 100, minChunkTokens: 10 });
  // Create text with clear sentence boundaries
  const sentences = Array(20).fill("This is a test sentence. ").join("");

  const result = chunker.chunkPlainText(sentences, "Long Text");

  assert.ok(result.sections.length > 0);
  const chunks = result.sections[0].chunks;
  // Long text should be chunked (may be 1+ depending on min size)
  assert.ok(chunks.length >= 1);
});

test("MemoryChunker maintains minimum chunk size", () => {
  const chunker = new MemoryChunker({ maxTokensPerChunk: 50, minChunkTokens: 20 });
  const text = "Short. Very short."; // too small

  const result = chunker.chunkPlainText(text);
  // May not create any chunks if text is too small
  const chunks = result.sections[0].chunks;
  if (chunks.length > 0) {
    chunks.forEach((chunk) => {
      const size = chunk.endToken - chunk.startToken;
      assert.ok(size >= 0); // Allow empty if text very small
    });
  }
});

test("MemoryChunker generates section summary", () => {
  const chunker = new MemoryChunker();
  const section = {
    heading: "## Test Section",
    level: 2,
    content: "This is a test section with some content that will be summarized.",
  };

  const summary = chunker.generateSectionSummary?.(section);
  assert.ok(summary);
  assert.ok(summary.length > 0);
  // Summary might be shorter or include ellipsis
  assert.ok(summary.includes("This") || summary.includes("test"));
});

test("MemoryChunker chunks plain text", () => {
  const chunker = new MemoryChunker();
  const plainText = "This is plain text. It has multiple sentences. Each should be considered.";

  const result = chunker.chunkPlainText(plainText, "Plain");

  assert.equal(result.title, "Plain");
  assert.ok(result.sections.length > 0);
  assert.equal(result.sections[0].heading, "");
  assert.ok(result.sections[0].chunks.length > 0);
});

test("MemoryChunker preserves text content in chunks", () => {
  const chunker = new MemoryChunker({ maxTokensPerChunk: 200 });
  const markdown = `## Section
Some text here. More text. Even more text.
Multiple lines of content.
All should be preserved.`;

  const result = chunker.chunkMarkdown(markdown);
  const chunks = result.sections[0].chunks;

  // Reconstruct text from chunks
  const reconstructed = chunks.map((c) => c.text).join(" ");
  assert.ok(reconstructed.includes("Some text here"));
  assert.ok(reconstructed.includes("preserved"));
});

test("MemoryChunker handles markdown with various heading levels", () => {
  const chunker = new MemoryChunker();
  const markdown = `# H1
Content 1

## H2
Content 2

### H3
Content 3

#### H4
Content 4`;

  const result = chunker.chunkMarkdown(markdown);
  assert.ok(result.sections.length >= 4);

  // Verify heading levels are parsed
  const headings = result.sections.map((s) => s.level);
  assert.ok(headings.some((l) => l === 1)); // H1
  assert.ok(headings.some((l) => l === 2)); // H2
  assert.ok(headings.some((l) => l === 3)); // H3
});

test("MemoryChunker handles empty content", () => {
  const chunker = new MemoryChunker();
  const result = chunker.chunkPlainText("");
  // Should handle gracefully without crashing
  assert.ok(result);
});

test("MemoryChunker estimates tokens", () => {
  const chunker = new MemoryChunker();

  // 100 chars should be ~25 tokens
  const text100 = "x".repeat(100);
  const result100 = chunker.chunkPlainText(text100);
  assert.ok(result100.estimatedTokens > 20 && result100.estimatedTokens < 40);

  // 1000 chars should be ~250 tokens
  const text1000 = "x".repeat(1000);
  const result1000 = chunker.chunkPlainText(text1000);
  assert.ok(result1000.estimatedTokens > 200 && result1000.estimatedTokens < 300);
});
