/**
 * Tool Manifest Tests
 * Validates the auto-generated tool manifest for consistency and completeness
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

interface ToolMetadata {
  name: string;
  file: string;
  title: string;
  description: string;
  inputSchemaKeys?: string[];
  tags?: string[];
}

interface ToolManifest {
  version: string;
  generatedAt: string;
  toolCount: number;
  tools: ToolMetadata[];
}

test("Tool Manifest - file existence", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  assert.ok(existsSync(manifestPath), "tool-manifest.json should exist");
});

test("Tool Manifest - valid JSON structure", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const content = readFileSync(manifestPath, "utf-8");

  let manifest: ToolManifest = { version: "", generatedAt: "", toolCount: 0, tools: [] };
  assert.doesNotThrow(
    () => {
      manifest = JSON.parse(content);
    },
    "tool-manifest.json should be valid JSON"
  );

  assert.ok(manifest.version, "version field should exist");
  assert.ok(manifest.generatedAt, "generatedAt field should exist");
  assert.ok(typeof manifest.toolCount === "number", "toolCount should be a number");
  assert.ok(Array.isArray(manifest.tools), "tools should be an array");
});

test("Tool Manifest - tool count matches", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const content = readFileSync(manifestPath, "utf-8");
  const manifest: ToolManifest = JSON.parse(content);

  assert.strictEqual(
    manifest.toolCount,
    manifest.tools.length,
    "toolCount should match actual tools array length"
  );
});

test("Tool Manifest - all tools have required fields", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const content = readFileSync(manifestPath, "utf-8");
  const manifest: ToolManifest = JSON.parse(content);

  for (const tool of manifest.tools) {
    assert.ok(tool.name, `Tool should have a name: ${JSON.stringify(tool)}`);
    assert.ok(tool.file, `Tool ${tool.name} should have a file`);
    assert.ok(tool.title, `Tool ${tool.name} should have a title`);
    assert.ok(tool.description, `Tool ${tool.name} should have a description`);
    assert.ok(Array.isArray(tool.inputSchemaKeys), `Tool ${tool.name} inputSchemaKeys should be an array`);
    assert.ok(Array.isArray(tool.tags), `Tool ${tool.name} tags should be an array`);
  }
});

test("Tool Manifest - no duplicate tool names", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const content = readFileSync(manifestPath, "utf-8");
  const manifest: ToolManifest = JSON.parse(content);

  const names = manifest.tools.map((t) => t.name);
  const uniqueNames = new Set(names);

  assert.strictEqual(
    uniqueNames.size,
    names.length,
    `Duplicate tool names found: ${names.filter((name, idx) => names.indexOf(name) !== idx).join(", ")}`
  );
});

test("Tool Manifest - tool names are valid identifiers", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const content = readFileSync(manifestPath, "utf-8");
  const manifest: ToolManifest = JSON.parse(content);

  const validNamePattern = /^[a-z][a-z0-9_]*$/;

  for (const tool of manifest.tools) {
    assert.ok(
      validNamePattern.test(tool.name),
      `Tool name "${tool.name}" should match pattern [a-z][a-z0-9_]*`
    );
  }
});

test("Tool Manifest - input schema keys are valid identifiers", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const content = readFileSync(manifestPath, "utf-8");
  const manifest: ToolManifest = JSON.parse(content);

  const validKeyPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  for (const tool of manifest.tools) {
    for (const key of tool.inputSchemaKeys ?? []) {
      assert.ok(
        validKeyPattern.test(key),
        `Input key "${key}" in tool ${tool.name} should match pattern [a-zA-Z_][a-zA-Z0-9_]*`
      );
    }
  }
});

test("Tool Manifest - descriptions are not empty or placeholder", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const content = readFileSync(manifestPath, "utf-8");
  const manifest: ToolManifest = JSON.parse(content);

  for (const tool of manifest.tools) {
    assert.ok(
      tool.description.length > 5,
      `Tool ${tool.name} description is too short: "${tool.description}"`
    );
    assert.notStrictEqual(
      tool.description,
      "No description",
      `Tool ${tool.name} should not have default placeholder description`
    );
  }
});

test("Tool Manifest - Markdown file exists and is readable", async () => {
  const markdownPath = join(ROOT, "docs", "internal", "tool-manifest.md");
  assert.ok(existsSync(markdownPath), "tool-manifest.md should exist");

  const content = readFileSync(markdownPath, "utf-8");
  assert.ok(content.length > 0, "tool-manifest.md should not be empty");
  assert.ok(content.includes("# Tool Manifest"), "Markdown should have title");
  assert.ok(content.includes("| ツール名 |"), "Markdown table should have correct headers");
});

test("Tool Manifest - Markdown table row count matches tool count", async () => {
  const manifestPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  const markdownPath = join(ROOT, "docs", "internal", "tool-manifest.md");

  const manifestContent = readFileSync(manifestPath, "utf-8");
  const manifest: ToolManifest = JSON.parse(manifestContent);

  const markdownContent = readFileSync(markdownPath, "utf-8");
  // Count data rows (excluding header rows)
  const tableRows = markdownContent.split("\n").filter((line) => line.startsWith("|") && line.includes("`"));

  assert.strictEqual(
    tableRows.length,
    manifest.toolCount,
    `Markdown table should have ${manifest.toolCount} data rows`
  );
});
