import type { ZodTypeAny } from "zod";
import { resolveToolCatalogMetadata } from "./tool-catalog-metadata.js";

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  category?: string;
  owner?: string;
  since?: string;
  deprecatedAt?: string;
  replacedBy?: string;
  rbac?: string[];
  estimatedCostUsd?: number;
  inputSchema?: Record<string, unknown>;
  inputSchemaZod?: ZodTypeAny;
}

export function defineTool(definition: ToolDefinition): ToolDefinition {
  const resolvedInputSchema = definition.inputSchema ?? (definition.inputSchemaZod as unknown as Record<string, unknown> | undefined);
  const resolvedCatalog = resolveToolCatalogMetadata({
    name: definition.name,
    capabilities: definition.capabilities,
    category: definition.category,
    owner: definition.owner,
    since: definition.since,
    deprecatedAt: definition.deprecatedAt,
    replacedBy: definition.replacedBy
  });

  return Object.freeze({
    ...definition,
    inputSchema: resolvedInputSchema,
    tags: definition.tags ? [...definition.tags] : undefined,
    capabilities: resolvedCatalog.capabilities,
    category: resolvedCatalog.category,
    owner: resolvedCatalog.owner,
    since: resolvedCatalog.since,
    deprecatedAt: resolvedCatalog.deprecatedAt,
    replacedBy: resolvedCatalog.replacedBy,
    rbac: definition.rbac ? [...definition.rbac] : undefined,
    inputSchemaZod: definition.inputSchemaZod
  });
}
