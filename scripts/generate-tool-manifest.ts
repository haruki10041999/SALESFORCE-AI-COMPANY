/**
 * Tool Manifest Generator (Descriptor-based)
 * Generates docs/generated/internal/tool-manifest.json from runtime registry descriptors
 * while preserving legacy manifest fields used by tests/compat tooling.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { ToolDescriptor } from "../mcp/core/registry/tool-descriptor.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

interface ToolMetadata {
  name: string;
  file: string;
  title: string;
  description: string;
  inputSchemaKeys: string[];
  inputSchemaTypes: Record<string, string>;
  tags?: string[];
}

interface ToolManifest {
  version: string;
  generatedAt: string;
  toolCount: number;
  tools: ToolMetadata[];
}

type LegacyManifest = {
  tools?: Array<{ name?: string; file?: string }>;
};

function loadLegacyFileMap(): Map<string, string> {
  const manifestPath = join(ROOT, "docs", "generated", "internal", "tool-manifest.json");
  if (!existsSync(manifestPath)) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as LegacyManifest;
    const map = new Map<string, string>();
    for (const tool of parsed.tools ?? []) {
      if (tool?.name && tool?.file) {
        map.set(tool.name, tool.file);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function getSchemaProperties(inputSchema: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const props = inputSchema["properties"];
  if (!props || typeof props !== "object") {
    return {};
  }
  return props as Record<string, Record<string, unknown>>;
}

function getRequiredKeys(inputSchema: Record<string, unknown>): Set<string> {
  const required = inputSchema["required"];
  if (!Array.isArray(required)) {
    return new Set();
  }
  return new Set(required.filter((v): v is string => typeof v === "string"));
}

function inferBaseType(schema: Record<string, unknown>): string {
  if (Array.isArray(schema["enum"])) {
    return "enum";
  }

  const schemaType = schema["type"];
  if (typeof schemaType === "string") {
    return schemaType;
  }

  if (Array.isArray(schemaType)) {
    const nonNull = schemaType.filter((t): t is string => typeof t === "string" && t !== "null");
    if (nonNull.length === 1) {
      return nonNull[0];
    }
    if (nonNull.length > 1) {
      return nonNull.join("|");
    }
  }

  const anyOf = schema["anyOf"];
  if (Array.isArray(anyOf) && anyOf.length > 0) {
    const labels = anyOf
      .map((candidate) => (candidate && typeof candidate === "object" ? inferBaseType(candidate as Record<string, unknown>) : "unknown"))
      .filter((label) => label !== "unknown");
    if (labels.length === 1) {
      return labels[0];
    }
    if (labels.length > 1) {
      return [...new Set(labels)].join("|");
    }
  }

  return "unknown";
}

function inferInputSchemaMetadata(inputSchema?: Record<string, unknown>): {
  inputSchemaKeys: string[];
  inputSchemaTypes: Record<string, string>;
} {
  if (!inputSchema) {
    return { inputSchemaKeys: [], inputSchemaTypes: {} };
  }

  const properties = getSchemaProperties(inputSchema);
  const required = getRequiredKeys(inputSchema);
  const keys = Object.keys(properties);
  const types: Record<string, string> = {};

  for (const key of keys) {
    const propSchema = properties[key] ?? {};
    const base = inferBaseType(propSchema);
    types[key] = required.has(key) ? base : `${base}?`;
  }

  return {
    inputSchemaKeys: keys,
    inputSchemaTypes: types
  };
}

/**
 * Generate tool manifest from runtime registry descriptors
 */
async function generateManifest(): Promise<ToolManifest> {
  // Dynamic import to load registry from compiled mcp/server
  const registryModuleUrl = pathToFileURL(join(ROOT, "dist", "mcp", "core", "registry", "tool-registry.js")).href;
  const { createBuiltinToolRegistry } = await import(
    registryModuleUrl
  );

  const registry = createBuiltinToolRegistry();
  const descriptors = registry.listDescriptors();
  const legacyFileMap = loadLegacyFileMap();

  const tools: ToolMetadata[] = descriptors
    .map((desc: ToolDescriptor) => {
      const { inputSchemaKeys, inputSchemaTypes } = inferInputSchemaMetadata(desc.inputSchema);
      return {
        name: desc.name,
        file: legacyFileMap.get(desc.name) ?? "registry",
        title: desc.title ?? "Untitled Tool",
        description: desc.description ?? "Description unavailable",
        inputSchemaKeys,
        inputSchemaTypes,
        tags: desc.tags ?? []
      };
    })
    .sort((a: ToolMetadata, b: ToolMetadata) => a.name.localeCompare(b.name));

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    toolCount: tools.length,
    tools
  };
}

/**
 * Generate Markdown table representation
 */
function generateMarkdownTable(manifest: ToolManifest): string {
  const lines: string[] = [
    "<!-- AUTOGENERATED: do not edit -->",
    "",
    "# Tool Manifest",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Total Tools: ${manifest.toolCount}`,
    "",
    "| ツール名 | ファイル | タイトル | 説明 | 入力キー |",
    "|--------|---------|--------|------|---------|"
  ];

  for (const tool of manifest.tools) {
    const keys = tool.inputSchemaKeys.length > 0 ? tool.inputSchemaKeys.join(", ") : "-";
    const desc = (tool.description || "").replace(/\|/g, "\\|");

    lines.push(`| \`${tool.name}\` | ${tool.file} | ${tool.title || "-"} | ${desc.substring(0, 60)} | ${keys.substring(0, 50)} |`);
  }

  return lines.join("\n");
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    console.log("Generating tool manifest from runtime descriptors...");

    const manifest = await generateManifest();
    console.log(`Found ${manifest.toolCount} tools`);

    const outDir = join(ROOT, "docs", "generated", "internal");
    mkdirSync(outDir, { recursive: true });

    const jsonPath = join(outDir, "tool-manifest.json");
    writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));
    console.log(`✓ JSON manifest written to ${jsonPath}`);

    const mdPath = join(outDir, "tool-manifest.md");
    const markdown = generateMarkdownTable(manifest);
    writeFileSync(mdPath, markdown);
    console.log(`✓ Markdown manifest written to ${mdPath}`);

    console.log("Tool manifest generation complete");
  } catch (error) {
    console.error("Failed to generate tool manifest:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
