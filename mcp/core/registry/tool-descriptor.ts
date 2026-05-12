import { zodToJsonSchema } from "zod-to-json-schema";
import type { ToolDefinition } from "./define-tool.js";

export interface ToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  rbac?: string[];
  estimatedCostUsd?: number;
  inputSchema?: Record<string, unknown>;
}

export function toToolDescriptor(definition: ToolDefinition): ToolDescriptor {
  const inputSchema = definition.inputSchemaZod
    ? (zodToJsonSchema(definition.inputSchemaZod, {
      name: `${definition.name}InputSchema`
    }) as unknown as Record<string, unknown>)
    : definition.inputSchema;

  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    tags: definition.tags,
    capabilities: definition.capabilities,
    rbac: definition.rbac,
    estimatedCostUsd: definition.estimatedCostUsd,
    inputSchema
  };
}
