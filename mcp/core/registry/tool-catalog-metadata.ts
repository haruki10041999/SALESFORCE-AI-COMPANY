export type ToolCategory =
  | "chat"
  | "memory"
  | "governance"
  | "observability"
  | "analysis"
  | "deployment"
  | "resource"
  | "other";

export interface ToolCatalogMetadataInput {
  name: string;
  capabilities?: string[];
  category?: string;
  owner?: string;
  since?: string;
  deprecatedAt?: string;
  replacedBy?: string;
}

export interface ResolvedToolCatalogMetadata {
  category: ToolCategory;
  capability: string;
  capabilities: string[];
  owner: string;
  since: string;
  deprecatedAt?: string;
  replacedBy?: string;
}

export function inferToolCategory(name: string, capabilities: string[]): ToolCategory {
  const lowerName = name.toLowerCase();

  if (capabilities.includes("chat") || lowerName.includes("chat")) return "chat";
  if (capabilities.includes("memory") || lowerName.includes("memory")) return "memory";
  if (capabilities.includes("governance") || lowerName.includes("governance")) return "governance";
  if (capabilities.includes("observability") || lowerName.includes("trace") || lowerName.includes("event")) return "observability";
  if (capabilities.includes("deployment") || lowerName.includes("deploy")) return "deployment";
  if (capabilities.includes("analysis") || lowerName.includes("analyze")) return "analysis";
  if (lowerName.includes("resource") || lowerName.includes("proposal")) return "resource";

  return "other";
}

export function inferPrimaryCapability(name: string, capabilities: string[]): string {
  if (capabilities.length > 0) {
    return capabilities[0];
  }

  const category = inferToolCategory(name, capabilities);
  return category === "other" ? "general" : category;
}

function normalizeCapabilities(value: string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function resolveToolCatalogMetadata(input: ToolCatalogMetadataInput): ResolvedToolCatalogMetadata {
  const capabilities = normalizeCapabilities(input.capabilities);
  const category = (input.category as ToolCategory | undefined) ?? inferToolCategory(input.name, capabilities);
  const capability = inferPrimaryCapability(input.name, capabilities);

  return {
    category,
    capability,
    capabilities: capabilities.length > 0 ? capabilities : [capability],
    owner: input.owner?.trim() || "runtime",
    since: input.since?.trim() || "legacy",
    deprecatedAt: input.deprecatedAt?.trim() || undefined,
    replacedBy: input.replacedBy?.trim() || undefined
  };
}
