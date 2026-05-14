import type { ToolDefinition } from "../core/application/catalog/tool-catalog.js";
import {
  resolveToolCatalogMetadata,
  type ToolCategory as ToolCatalogCategory
} from "../core/application/catalog/tool-catalog.js";

export interface ToolCatalogEntry {
  name: string;
  category: ToolCatalogCategory;
  capability: string;
  owner?: string;
  since?: string;
  deprecatedAt?: string;
  replacedBy?: string;
}

export class ToolCatalog {
  private readonly entries = new Map<string, ToolCatalogEntry>();

  upsert(definition: ToolDefinition): ToolCatalogEntry {
    const resolved = resolveToolCatalogMetadata({
      name: definition.name,
      capabilities: definition.capabilities,
      category: definition.category,
      owner: definition.owner,
      since: definition.since,
      deprecatedAt: definition.deprecatedAt,
      replacedBy: definition.replacedBy
    });

    const entry: ToolCatalogEntry = {
      name: definition.name,
      category: resolved.category,
      capability: resolved.capability,
      owner: resolved.owner,
      since: resolved.since,
      deprecatedAt: resolved.deprecatedAt,
      replacedBy: resolved.replacedBy
    };

    this.entries.set(entry.name, entry);
    return entry;
  }

  list(): ToolCatalogEntry[] {
    return [...this.entries.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(name: string): ToolCatalogEntry | undefined {
    return this.entries.get(name);
  }
}

export function createToolCatalog(): ToolCatalog {
  return new ToolCatalog();
}
