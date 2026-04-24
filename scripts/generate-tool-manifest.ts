/**
 * Tool Manifest Generator
 * Automatically extracts tool metadata from register-*.ts files
 * and generates tool-manifest.json and tool-manifest.md
 */

import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

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

/**
 * Extract tool metadata from a register-*.ts file using regex patterns
 * Handles multiline govTool() calls
 */
function extractToolsFromFile(filePath: string, fileName: string): ToolMetadata[] {
  const content = readFileSync(filePath, "utf-8");
  const tools: ToolMetadata[] = [];

  // Split into chunks by govTool calls
  const govToolPattern = /govTool\s*\(\s*["']([^"']+)["']/g;
  let match;

  while ((match = govToolPattern.exec(content)) !== null) {
    const toolName = match[1];
    const startPos = match.index;

    // Find the config object after the tool name
    // Look for the next { and matching }
    let braceCount = 0;
    let inConfig = false;
    let configStart = -1;
    let configEnd = -1;

    for (let i = startPos + match[0].length; i < content.length; i++) {
      const char = content[i];

      if (char === "{" && !inConfig) {
        inConfig = true;
        configStart = i;
        braceCount = 1;
      } else if (inConfig) {
        if (char === "{") braceCount++;
        else if (char === "}") {
          braceCount--;
          if (braceCount === 0) {
            configEnd = i;
            break;
          }
        }
      }
    }

    if (configStart !== -1 && configEnd !== -1) {
      const configContent = content.substring(configStart + 1, configEnd);

      // Extract title
      const titleMatch = configContent.match(/title\s*:\s*["']([^"']+)["']/);
      const title = titleMatch ? titleMatch[1] : `Tool: ${toolName}`;

      // Extract description
      const descMatch = configContent.match(/description\s*:\s*["']([^"']+)["']/);
      const description = descMatch ? descMatch[1] : "No description";

      // Extract inputSchema keys more carefully
      // Pattern: "key": z.xxx or key: z.xxx
      const schemaMatch = configContent.match(/inputSchema\s*:\s*\{([^}]*?)\}/s);
      const inputSchemaKeys: string[] = [];
      
      if (schemaMatch) {
        const schemaContent = schemaMatch[1];
        // Extract all key names before : (quoted or unquoted)
        const keyMatches = schemaContent.matchAll(/["']?([a-zA-Z_][a-zA-Z0-9_]*?)["']?\s*:/g);
        for (const keyMatch of keyMatches) {
          const key = keyMatch[1].trim();
          if (key && !key.startsWith("z") && key !== "") {
            inputSchemaKeys.push(key);
          }
        }
      }

      // Extract tags if present
      const tagsMatch = configContent.match(/tags\s*:\s*\[([^\]]+)\]/);
      const tags = tagsMatch
        ? tagsMatch[1]
            .split(",")
            .map((t) => t.trim().replace(/["']/g, ""))
            .filter((t) => t.length > 0)
        : [];

      tools.push({
        name: toolName,
        file: fileName,
        title,
        description,
        inputSchemaKeys,
        tags
      });
    }
  }

  return tools;
}

/**
 * Generate tool manifest from all register-*.ts files
 */
function generateManifest(): ToolManifest {
  const handlersDir = join(ROOT, "mcp", "handlers");
  const registerFiles = readdirSync(handlersDir)
    .filter((f) => f.startsWith("register-") && f.endsWith(".ts"))
    .sort();

  const allTools: ToolMetadata[] = [];

  for (const fileName of registerFiles) {
    const filePath = join(handlersDir, fileName);
    const tools = extractToolsFromFile(filePath, fileName);
    allTools.push(...tools);
  }

  // Sort by tool name
  allTools.sort((a, b) => a.name.localeCompare(b.name));

  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    toolCount: allTools.length,
    tools: allTools
  };
}

/**
 * Generate Markdown table representation
 */
function generateMarkdownTable(manifest: ToolManifest): string {
  const lines: string[] = [
    "# Tool Manifest",
    "",
    `Generated: ${manifest.generatedAt}`,
    `Total Tools: ${manifest.toolCount}`,
    "",
    "| ツール名 | ファイル | タイトル | 説明 | 入力キー |",
    "|--------|---------|--------|------|---------|"
  ];

  for (const tool of manifest.tools) {
    // Format input keys: join with ", " but limit display length
    let inputKeysStr = "-";
    if (tool.inputSchemaKeys && tool.inputSchemaKeys.length > 0) {
      inputKeysStr = tool.inputSchemaKeys.join(", ");
      // Truncate if too long for table readability
      if (inputKeysStr.length > 50) {
        inputKeysStr = inputKeysStr.substring(0, 47) + "...";
      }
    }
    
    // Escape pipe characters in descriptions for Markdown
    const escaped = tool.description.replace(/\|/g, "\\|");
    lines.push(
      `| \`${tool.name}\` | ${tool.file} | ${tool.title} | ${escaped} | ${inputKeysStr} |`
    );
  }

  return lines.join("\n");
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log("🔍 Generating tool manifest...");

  const manifest = generateManifest();
  console.log(`✓ Found ${manifest.toolCount} tools`);

  // Write JSON manifest
  const jsonPath = join(ROOT, "docs", "internal", "tool-manifest.json");
  writeFileSync(jsonPath, JSON.stringify(manifest, null, 2));
  console.log(`✓ JSON manifest written to ${jsonPath}`);

  // Write Markdown manifest
  const mdPath = join(ROOT, "docs", "internal", "tool-manifest.md");
  const markdown = generateMarkdownTable(manifest);
  writeFileSync(mdPath, markdown);
  console.log(`✓ Markdown manifest written to ${mdPath}`);

  console.log("✅ Tool manifest generation complete!");
}

main().catch((error) => {
  console.error("❌ Error:", error.message);
  process.exit(1);
});
