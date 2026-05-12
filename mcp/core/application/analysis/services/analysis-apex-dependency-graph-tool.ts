import { buildApexDependencyGraph } from "../../../../tools/apex-dependency-graph.js";
import { buildApexDependencyGraphIncremental } from "../../../../tools/apex-dependency-graph-incremental.js";

export async function executeApexDependencyGraphTool(args: {
  rootDir: string;
  includeTests?: boolean;
  sampleLimit?: number;
  includeFlows?: boolean;
  includePermissionSets?: boolean;
  includeIntegrations?: boolean;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = buildApexDependencyGraph({
    rootDir: args.rootDir,
    includeTests: args.includeTests,
    sampleLimit: args.sampleLimit,
    includeFlows: args.includeFlows,
    includePermissionSets: args.includePermissionSets,
    includeIntegrations: args.includeIntegrations
  });

  return {
    content: [
      { type: "text", text: JSON.stringify(result, null, 2) },
      { type: "text", text: `\`\`\`mermaid\n${result.mermaid}\n\`\`\`` }
    ]
  };
}

export async function executeApexDependencyGraphIncrementalTool(args: {
  rootDir: string;
  cacheFile: string;
  includeTests?: boolean;
  sampleLimit?: number;
  includeFlows?: boolean;
  includePermissionSets?: boolean;
  includeIntegrations?: boolean;
}): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = buildApexDependencyGraphIncremental({
    rootDir: args.rootDir,
    cacheFile: args.cacheFile,
    includeTests: args.includeTests,
    sampleLimit: args.sampleLimit,
    includeFlows: args.includeFlows,
    includePermissionSets: args.includePermissionSets,
    includeIntegrations: args.includeIntegrations
  });

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
  };
}
