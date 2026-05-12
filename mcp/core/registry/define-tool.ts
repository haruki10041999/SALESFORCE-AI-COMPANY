import type { ZodTypeAny } from "zod";

export interface ToolDefinition {
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  rbac?: string[];
  estimatedCostUsd?: number;
  inputSchema?: Record<string, unknown>;
  inputSchemaZod?: ZodTypeAny;
}

export function defineTool(definition: ToolDefinition): ToolDefinition {
  const resolvedInputSchema = definition.inputSchema ?? (definition.inputSchemaZod as unknown as Record<string, unknown> | undefined);

  return Object.freeze({
    ...definition,
    inputSchema: resolvedInputSchema,
    tags: definition.tags ? [...definition.tags] : undefined,
    capabilities: definition.capabilities ? [...definition.capabilities] : undefined,
    rbac: definition.rbac ? [...definition.rbac] : undefined,
    inputSchemaZod: definition.inputSchemaZod
  });
}
