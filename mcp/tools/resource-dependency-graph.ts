import { existsSync, promises as fsPromises } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

type ResourceType = "skills" | "agents" | "personas" | "presets";

export type ResourceDependencyGraphInput = {
  rootDir: string;
  presetsDir: string;
  outputsDir: string;
  includeTypes?: ResourceType[];
  includeIsolated?: boolean;
  impactTarget?: {
    type: ResourceType;
    name: string;
  };
  maxImpacts?: number;
  reportOutputDir?: string;
};

export type ResourceNode = {
  id: string;
  type: ResourceType;
  name: string;
  sourcePath: string;
};

export type ResourceEdge = {
  from: string;
  to: string;
  relation: "references" | "includes";
};

export type ResourceImpact = {
  target: { type: ResourceType; name: string; id: string };
  upstream: Array<{ id: string; type: ResourceType; name: string }>;
  downstream: Array<{ id: string; type: ResourceType; name: string }>;
};

export type ResourceDependencyGraphResult = {
  generatedAt: string;
  summary: {
    nodeCount: number;
    edgeCount: number;
    skills: number;
    agents: number;
    personas: number;
    presets: number;
  };
  nodes: ResourceNode[];
  edges: ResourceEdge[];
  mermaid: string;
  impact?: ResourceImpact;
  reportJsonPath: string;
  reportMarkdownPath: string;
};

type PresetFileShape = {
  name?: string;
  agents?: string[];
  skills?: string[];
  persona?: string;
};

function toPosix(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function nodeId(type: ResourceType, name: string): string {
  return `${type}:${name}`;
}

function labelFor(type: ResourceType, name: string): string {
  return `${type.slice(0, -1)}:${name}`;
}

function sanitizeMermaidId(id: string): string {
  return id.replace(/[^A-Za-z0-9_]/g, "_");
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = await fsPromises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
      } else {
        results.push(nextPath);
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function extractMarkdownLinks(markdown: string): string[] {
  const links: string[] = [];
  const regex = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(regex)) {
    const raw = (match[1] ?? "").trim();
    if (raw) {
      links.push(raw);
    }
  }
  return links;
}

function findImpact(
  targetId: string,
  nodesById: Map<string, ResourceNode>,
  outgoing: Map<string, Set<string>>,
  incoming: Map<string, Set<string>>,
  maxItems: number
): ResourceImpact | undefined {
  const target = nodesById.get(targetId);
  if (!target) return undefined;

  const walk = (adjacency: Map<string, Set<string>>): string[] => {
    const seen = new Set<string>();
    const queue = [targetId];

    while (queue.length > 0 && seen.size < maxItems) {
      const current = queue.shift();
      if (!current) continue;

      for (const next of adjacency.get(current) ?? []) {
        if (next === targetId || seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }

    return [...seen].sort((a, b) => a.localeCompare(b));
  };

  const upstreamIds = walk(incoming);
  const downstreamIds = walk(outgoing);

  return {
    target: {
      id: target.id,
      type: target.type,
      name: target.name
    },
    upstream: upstreamIds
      .map((id) => nodesById.get(id))
      .filter((node): node is ResourceNode => Boolean(node))
      .map((node) => ({ id: node.id, type: node.type, name: node.name })),
    downstream: downstreamIds
      .map((id) => nodesById.get(id))
      .filter((node): node is ResourceNode => Boolean(node))
      .map((node) => ({ id: node.id, type: node.type, name: node.name }))
  };
}

function buildMermaid(nodes: ResourceNode[], edges: ResourceEdge[]): string {
  const lines: string[] = ["graph LR"];

  if (nodes.length === 0) {
    lines.push("  Empty[\"No resources found\"]");
    return lines.join("\n");
  }

  for (const node of nodes) {
    lines.push(`  ${sanitizeMermaidId(node.id)}[\"${labelFor(node.type, node.name)}\"]`);
  }

  for (const edge of edges) {
    const connector = edge.relation === "includes" ? "==>" : "-->";
    lines.push(`  ${sanitizeMermaidId(edge.from)} ${connector} ${sanitizeMermaidId(edge.to)}`);
  }

  return lines.join("\n");
}

function toMarkdown(result: {
  summary: ResourceDependencyGraphResult["summary"];
  nodes: ResourceNode[];
  edges: ResourceEdge[];
  mermaid: string;
  impact?: ResourceImpact;
}): string {
  const lines: string[] = [];
  lines.push("# Resource Dependency Graph");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Nodes: ${result.summary.nodeCount}`);
  lines.push(`- Edges: ${result.summary.edgeCount}`);
  lines.push(`- Skills: ${result.summary.skills}`);
  lines.push(`- Agents: ${result.summary.agents}`);
  lines.push(`- Personas: ${result.summary.personas}`);
  lines.push(`- Presets: ${result.summary.presets}`);
  lines.push("");

  if (result.impact) {
    lines.push("## Impact");
    lines.push("");
    lines.push(`- Target: ${result.impact.target.type}/${result.impact.target.name}`);
    lines.push(`- Upstream dependents: ${result.impact.upstream.length}`);
    lines.push(`- Downstream dependencies: ${result.impact.downstream.length}`);
    lines.push("");
  }

  lines.push("## Mermaid");
  lines.push("");
  lines.push("```mermaid");
  lines.push(result.mermaid);
  lines.push("```");
  lines.push("");

  lines.push("## Edges");
  lines.push("");
  for (const edge of result.edges) {
    lines.push(`- ${edge.from} ${edge.relation} ${edge.to}`);
  }

  return lines.join("\n");
}

export async function buildResourceDependencyGraph(
  input: ResourceDependencyGraphInput
): Promise<ResourceDependencyGraphResult> {
  const rootDir = resolve(input.rootDir);
  const presetsDir = resolve(input.presetsDir);
  const outputsDir = resolve(input.outputsDir);
  const reportDir = input.reportOutputDir
    ? resolve(input.reportOutputDir)
    : join(outputsDir, "reports", "resource-graph");
  const includeTypes = new Set<ResourceType>(input.includeTypes ?? ["skills", "agents", "personas", "presets"]);
  const includeIsolated = input.includeIsolated !== false;
  const maxImpacts = Number.isFinite(input.maxImpacts) ? Math.max(1, Math.floor(input.maxImpacts ?? 50)) : 50;

  const nodesById = new Map<string, ResourceNode>();
  const edgesByKey = new Map<string, ResourceEdge>();
  const outgoing = new Map<string, Set<string>>();
  const incoming = new Map<string, Set<string>>();

  const registerNode = (type: ResourceType, name: string, sourcePath: string): ResourceNode => {
    const trimmedName = name.trim();
    const id = nodeId(type, trimmedName);
    if (!nodesById.has(id)) {
      nodesById.set(id, {
        id,
        type,
        name: trimmedName,
        sourcePath: toPosix(relative(rootDir, sourcePath))
      });
      outgoing.set(id, new Set<string>());
      incoming.set(id, new Set<string>());
    }
    return nodesById.get(id)!;
  };

  const registerEdge = (from: string, to: string, relation: "references" | "includes"): void => {
    if (from === to) return;
    const key = `${from}->${to}:${relation}`;
    if (edgesByKey.has(key)) return;
    edgesByKey.set(key, { from, to, relation });
    outgoing.get(from)?.add(to);
    incoming.get(to)?.add(from);
  };

  const skillByFile = new Map<string, string>();
  const skillFiles = (await listFilesRecursive(join(rootDir, "skills"))).filter((file) => file.endsWith(".md"));
  for (const file of skillFiles) {
    const rel = toPosix(relative(join(rootDir, "skills"), file)).replace(/\.md$/i, "");
    skillByFile.set(rel.toLowerCase(), rel);
    if (includeTypes.has("skills")) {
      registerNode("skills", rel, file);
    }
  }

  const personaByFile = new Map<string, string>();
  const personaFiles = (await listFilesRecursive(join(rootDir, "personas"))).filter((file) => file.endsWith(".md"));
  for (const file of personaFiles) {
    const name = basename(file, ".md");
    personaByFile.set(name.toLowerCase(), name);
    if (includeTypes.has("personas")) {
      registerNode("personas", name, file);
    }
  }

  const agentByFile = new Map<string, string>();
  const agentFiles = (await listFilesRecursive(join(rootDir, "agents"))).filter((file) => file.endsWith(".md"));
  for (const file of agentFiles) {
    const name = basename(file, ".md");
    agentByFile.set(name.toLowerCase(), name);
    if (includeTypes.has("agents")) {
      registerNode("agents", name, file);
    }
  }

  const presetFiles = (await listFilesRecursive(presetsDir)).filter((file) => file.endsWith(".json"));
  for (const file of presetFiles) {
    const raw = await fsPromises.readFile(file, "utf-8");
    let parsed: PresetFileShape | null = null;
    try {
      parsed = JSON.parse(raw) as PresetFileShape;
    } catch {
      parsed = null;
    }

    if (!parsed || !parsed.name || !includeTypes.has("presets")) {
      continue;
    }

    const presetNode = registerNode("presets", parsed.name, file);

    for (const agentName of parsed.agents ?? []) {
      const normalized = agentName.trim();
      const agentNode = registerNode("agents", normalized, join(rootDir, "agents", `${normalized}.md`));
      registerEdge(presetNode.id, agentNode.id, "includes");
    }

    for (const skillName of parsed.skills ?? []) {
      const normalizedSkill = skillName.trim();
      const skillPath = join(rootDir, "skills", `${normalizedSkill}.md`);
      const skillNode = registerNode("skills", normalizedSkill, skillPath);
      registerEdge(presetNode.id, skillNode.id, "includes");
    }

    if (parsed.persona) {
      const personaName = parsed.persona.trim();
      const personaNode = registerNode("personas", personaName, join(rootDir, "personas", `${personaName}.md`));
      registerEdge(presetNode.id, personaNode.id, "includes");
    }
  }

  for (const agentFile of agentFiles) {
    const agentName = basename(agentFile, ".md");
    const agentNode = registerNode("agents", agentName, agentFile);
    const raw = await fsPromises.readFile(agentFile, "utf-8");
    const links = extractMarkdownLinks(raw);

    for (const link of links) {
      const cleaned = toPosix(link).replace(/^\.\//, "").replace(/^\.\.\//, "").replace(/\.md$/i, "");
      if (cleaned.startsWith("skills/")) {
        const key = cleaned.slice("skills/".length).toLowerCase();
        const skillName = skillByFile.get(key) ?? cleaned.slice("skills/".length);
        const skillNode = registerNode("skills", skillName, join(rootDir, "skills", `${skillName}.md`));
        registerEdge(agentNode.id, skillNode.id, "references");
      }
      if (cleaned.startsWith("personas/")) {
        const key = cleaned.slice("personas/".length).toLowerCase();
        const personaName = personaByFile.get(key) ?? cleaned.slice("personas/".length);
        const personaNode = registerNode("personas", personaName, join(rootDir, "personas", `${personaName}.md`));
        registerEdge(agentNode.id, personaNode.id, "references");
      }
    }
  }

  const allNodes = [...nodesById.values()]
    .filter((node) => includeTypes.has(node.type))
    .sort((a, b) => a.id.localeCompare(b.id));
  const allowedNodeIds = new Set(allNodes.map((node) => node.id));

  let allEdges = [...edgesByKey.values()]
    .filter((edge) => allowedNodeIds.has(edge.from) && allowedNodeIds.has(edge.to))
    .sort((a, b) => `${a.from}:${a.to}:${a.relation}`.localeCompare(`${b.from}:${b.to}:${b.relation}`));

  const connectedIds = new Set<string>();
  for (const edge of allEdges) {
    connectedIds.add(edge.from);
    connectedIds.add(edge.to);
  }

  const nodes = includeIsolated ? allNodes : allNodes.filter((node) => connectedIds.has(node.id));
  const includedIds = new Set(nodes.map((node) => node.id));
  allEdges = allEdges.filter((edge) => includedIds.has(edge.from) && includedIds.has(edge.to));

  const summary = {
    nodeCount: nodes.length,
    edgeCount: allEdges.length,
    skills: nodes.filter((node) => node.type === "skills").length,
    agents: nodes.filter((node) => node.type === "agents").length,
    personas: nodes.filter((node) => node.type === "personas").length,
    presets: nodes.filter((node) => node.type === "presets").length
  };

  const impactTargetId = input.impactTarget ? nodeId(input.impactTarget.type, input.impactTarget.name) : undefined;
  const impact = impactTargetId ? findImpact(impactTargetId, nodesById, outgoing, incoming, maxImpacts) : undefined;
  const mermaid = buildMermaid(nodes, allEdges);

  await fsPromises.mkdir(reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const reportJsonPath = join(reportDir, `resource-dependency-graph-${timestamp}.json`);
  const reportMarkdownPath = join(reportDir, `resource-dependency-graph-${timestamp}.md`);

  const result: ResourceDependencyGraphResult = {
    generatedAt: new Date().toISOString(),
    summary,
    nodes,
    edges: allEdges,
    mermaid,
    impact,
    reportJsonPath,
    reportMarkdownPath
  };

  await fsPromises.writeFile(reportJsonPath, JSON.stringify(result, null, 2), "utf-8");
  await fsPromises.writeFile(
    reportMarkdownPath,
    toMarkdown({
      summary,
      nodes,
      edges: allEdges,
      mermaid,
      impact
    }),
    "utf-8"
  );

  return result;
}