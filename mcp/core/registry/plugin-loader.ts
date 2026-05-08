import { promises as fsPromises } from "node:fs";
import { resolve, relative, basename } from "node:path";
import { parseDocument, Document } from "yaml";
import type { PluginManifest, PluginKind } from "./plugin-manifest.js";
import { validateManifest, parsePluginRef } from "./plugin-manifest.js";
import type { PluginRegistry } from "./plugin-registry.js";

/**
 * Plugin Loader
 *
 * Scans directories for manifest files and loads them into the registry.
 * Supports YAML frontmatter (for .md files) and JSON manifests.
 */
export class PluginLoader {
  constructor(private registry: PluginRegistry) {}

  /**
   * Load all plugins from a directory
   */
  async loadFromDirectory(dir: string, kind?: PluginKind): Promise<PluginManifest[]> {
    const loaded: PluginManifest[] = [];
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively load from subdirectories
        const subLoaded = await this.loadFromDirectory(fullPath, kind);
        loaded.push(...subLoaded);
      } else if (entry.isFile()) {
        try {
          const manifest = await this.loadFile(fullPath);
          if (kind && manifest.kind !== kind) {
            continue; // Skip if kind filter doesn't match
          }
          this.registry.register(manifest);
          loaded.push(manifest);
        } catch (err) {
          // Log and continue on parse errors
          console.warn(`Failed to load plugin from ${fullPath}:`, err);
        }
      }
    }

    return loaded;
  }

  /**
   * Load a single file (manifest or frontmatter)
   */
  async loadFile(filePath: string): Promise<PluginManifest> {
    const content = await fsPromises.readFile(filePath, "utf-8");

    if (filePath.endsWith(".json")) {
      return validateManifest(JSON.parse(content));
    }

    if (filePath.endsWith(".md")) {
      return this.extractFromMarkdown(content, filePath);
    }

    // Try YAML
    if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
      return validateManifest(parseDocument(content).toJS());
    }

    throw new Error(`Unsupported file format: ${filePath}`);
  }

  /**
   * Extract manifest from YAML frontmatter in markdown file
   */
  private extractFromMarkdown(content: string, filePath: string): PluginManifest {
    const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
    const match = content.match(frontmatterRegex);

    if (!match) {
      throw new Error(`No YAML frontmatter found in ${filePath}`);
    }

    const frontmatterYaml = match[1];
    const doc = parseDocument(frontmatterYaml);
    const data = doc.toJS();

    // Ensure minimal manifest structure if compatibilityMode
    const manifest = this.ensureManifest(data, filePath);
    return validateManifest(manifest);
  }

  /**
   * Convert legacy frontmatter to v1 manifest (compatibility mode)
   */
  private ensureManifest(data: Record<string, unknown>, filePath: string): Record<string, unknown> {
    // If already has apiVersion, assume it's a valid manifest
    if (data.apiVersion) {
      return data;
    }

    // Legacy conversion
    const nameStr = String(data.name || basename(filePath, ".md"));
    const versionStr = String(data.version || "1.0.0");
    const kind = (data.kind || this.inferKindFromPath(filePath)) as PluginKind;

    return {
      apiVersion: "sfai.io/v1",
      kind,
      metadata: {
        name: nameStr.toLowerCase().replace(/\s+/g, "-"),
        version: versionStr,
        vendor: String(data.vendor || "sfai"),
        description: String(data.description || "Migrated from legacy frontmatter"),
      },
      spec: {
        role: data.role,
        expertise: data.expertise || data.skills,
        systemPrompt: data.systemPrompt,
        dependencies: data.dependencies,
        capabilities: data.capabilities,
        compatibilityMode: true,
        ...(typeof data.spec === "object" && data.spec !== null ? data.spec : {}),
      },
    };
  }

  /**
   * Infer plugin kind from file path
   */
  private inferKindFromPath(filePath: string): PluginKind {
    // Normalize path separators for cross-platform compatibility
    const normalized = filePath.replace(/\\/g, "/");
    if (normalized.includes("/agents/")) return "Agent";
    if (normalized.includes("/skills/")) return "Skill";
    if (normalized.includes("/personas/")) return "Persona";
    return "ToolPack"; // default
  }

  /**
   * Bootstrap plugin system from standard directories
   */
  async bootstrap(baseDir: string): Promise<{ agents: PluginManifest[]; skills: PluginManifest[]; personas: PluginManifest[] }> {
    const agents = await this.loadFromDirectory(resolve(baseDir, "agents"), "Agent");
    const skills = await this.loadFromDirectory(resolve(baseDir, "skills"), "Skill");
    const personas = await this.loadFromDirectory(resolve(baseDir, "personas"), "Persona");

    return { agents, skills, personas };
  }
}

/**
 * Load plugin manifest with default registry
 */
export async function loadPluginManifests(
  registry: PluginRegistry,
  baseDir: string = process.cwd()
): Promise<{ agents: PluginManifest[]; skills: PluginManifest[]; personas: PluginManifest[] }> {
  const loader = new PluginLoader(registry);
  return loader.bootstrap(baseDir);
}
