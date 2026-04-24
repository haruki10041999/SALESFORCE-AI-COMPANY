import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";

type ApexNodeKind = "class" | "trigger";

export type ApexDependencyGraphInput = {
  rootDir: string;
  includeTests?: boolean;
  sampleLimit?: number;
};

export type ApexDependencyNode = {
  name: string;
  kind: ApexNodeKind;
  filePath: string;
  fanIn: number;
  fanOut: number;
};

export type ApexDependencyEdge = {
  from: string;
  to: string;
};

export type ApexDependencyGraphResult = {
  rootDir: string;
  summary: {
    totalFiles: number;
    classCount: number;
    triggerCount: number;
    edgeCount: number;
    isolatedCount: number;
    cycleCount: number;
    riskLevel: "low" | "medium" | "high";
  };
  nodes: ApexDependencyNode[];
  edges: ApexDependencyEdge[];
  cycles: string[][];
  topFanOut: string[];
  topFanIn: string[];
  mermaid: string;
  suggestions: string[];
};

type SourceFile = {
  absolutePath: string;
  relativePath: string;
  content: string;
  kind: ApexNodeKind;
  name: string;
};

function listApexFiles(rootDir: string): string[] {
  const results: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const nextPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(nextPath);
        continue;
      }
      if (/\.(cls|trigger)$/i.test(entry.name)) {
        results.push(nextPath);
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/'([^'\\]|\\.)*'/g, " ")
    .replace(/"([^"\\]|\\.)*"/g, " ");
}

function detectName(kind: ApexNodeKind, content: string, fallbackName: string): string {
  if (kind === "class") {
    const classMatch = content.match(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/i);
    if (classMatch?.[1]) return classMatch[1];
  } else {
    const triggerMatch = content.match(/\btrigger\s+([A-Za-z_][A-Za-z0-9_]*)\s+on\s+[A-Za-z_][A-Za-z0-9_]*\b/i);
    if (triggerMatch?.[1]) return triggerMatch[1];
  }
  return fallbackName;
}

function collectSourceFiles(rootDir: string, includeTests: boolean): SourceFile[] {
  const files = listApexFiles(rootDir);

  const results: SourceFile[] = [];
  for (const absolutePath of files) {
    const content = readFileSync(absolutePath, "utf-8");
    const isTest = /@IsTest\b/i.test(content) || /\btestMethod\b/i.test(content);
    if (!includeTests && isTest) {
      continue;
    }

    const kind: ApexNodeKind = /\.trigger$/i.test(absolutePath) ? "trigger" : "class";
    const fileName = absolutePath.replace(/^.*[\\/]/, "").replace(/\.(cls|trigger)$/i, "");
    results.push({
      absolutePath,
      relativePath: relative(rootDir, absolutePath).replace(/\\/g, "/"),
      content,
      kind,
      name: detectName(kind, content, fileName)
    });
  }

  return results;
}

function buildTokenSet(content: string): Set<string> {
  const stripped = stripCommentsAndStrings(content);
  const tokens = new Set<string>();

  for (const match of stripped.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
    const token = match[0];
    if (token) {
      tokens.add(token);
    }
  }

  return tokens;
}

function detectRiskLevel(edgeCount: number, cycleCount: number): "low" | "medium" | "high" {
  if (cycleCount >= 5 || edgeCount >= 120) return "high";
  if (cycleCount >= 1 || edgeCount >= 40) return "medium";
  return "low";
}

function buildMermaid(nodes: ApexDependencyNode[], edges: ApexDependencyEdge[]): string {
  const lines: string[] = ["graph LR"];

  if (nodes.length === 0) {
    lines.push("  Empty[\"No Apex classes/triggers found\"]");
    return lines.join("\n");
  }

  for (const node of nodes) {
    const id = `${node.kind}_${node.name}`;
    const label = `${node.name} (${node.kind})`;
    lines.push(`  ${id}[\"${label}\"]`);
  }

  for (const edge of edges) {
    const fromNode = nodes.find((node) => node.name === edge.from);
    const toNode = nodes.find((node) => node.name === edge.to);
    if (!fromNode || !toNode) continue;

    const fromId = `${fromNode.kind}_${fromNode.name}`;
    const toId = `${toNode.kind}_${toNode.name}`;
    lines.push(`  ${fromId} --> ${toId}`);
  }

  return lines.join("\n");
}

function findCycles(adjacency: Map<string, Set<string>>): string[][] {
  const indexMap = new Map<string, number>();
  const lowMap = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  let index = 0;

  function strongConnect(node: string): void {
    indexMap.set(node, index);
    lowMap.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of adjacency.get(node) ?? []) {
      if (!indexMap.has(next)) {
        strongConnect(next);
        lowMap.set(node, Math.min(lowMap.get(node) ?? 0, lowMap.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowMap.set(node, Math.min(lowMap.get(node) ?? 0, indexMap.get(next) ?? 0));
      }
    }

    if ((lowMap.get(node) ?? -1) === (indexMap.get(node) ?? -2)) {
      const component: string[] = [];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) break;
        onStack.delete(current);
        component.push(current);
        if (current === node) break;
      }

      if (component.length > 1) {
        cycles.push(component.sort());
      } else {
        const only = component[0];
        if (only && adjacency.get(only)?.has(only)) {
          cycles.push(component);
        }
      }
    }
  }

  for (const node of adjacency.keys()) {
    if (!indexMap.has(node)) {
      strongConnect(node);
    }
  }

  return cycles.sort((a, b) => a.join(",").localeCompare(b.join(",")));
}

function toTopList(items: ApexDependencyNode[], pick: (node: ApexDependencyNode) => number, sampleLimit: number): string[] {
  return [...items]
    .sort((a, b) => pick(b) - pick(a) || a.name.localeCompare(b.name))
    .slice(0, sampleLimit)
    .map((node) => `${node.name}:${pick(node)}`);
}

export function buildApexDependencyGraph(input: ApexDependencyGraphInput): ApexDependencyGraphResult {
  const check = runSchemaValidation(SafeFilePathSchema, input.rootDir);
  if (!check.success) {
    throw new Error(`Invalid rootDir: ${check.errors.join(", ")}`);
  }

  const rootDir = resolve(input.rootDir);
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    throw new Error(`rootDir が存在しないかディレクトリではありません: ${rootDir}`);
  }

  const includeTests = input.includeTests ?? false;
  const sampleLimit = Number.isFinite(input.sampleLimit) ? Math.max(1, Math.floor(input.sampleLimit ?? 10)) : 10;

  const sourceFiles = collectSourceFiles(rootDir, includeTests);
  const classNames = new Set(sourceFiles.filter((file) => file.kind === "class").map((file) => file.name));

  const edgesSet = new Set<string>();
  const adjacency = new Map<string, Set<string>>();
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();

  for (const file of sourceFiles) {
    adjacency.set(file.name, new Set<string>());
    fanIn.set(file.name, 0);
    fanOut.set(file.name, 0);
  }

  for (const file of sourceFiles) {
    const tokens = buildTokenSet(file.content);
    const deps = new Set<string>();

    for (const token of tokens) {
      if (classNames.has(token) && token !== file.name) {
        deps.add(token);
      }
    }

    for (const dep of deps) {
      const key = `${file.name}->${dep}`;
      if (edgesSet.has(key)) continue;
      edgesSet.add(key);
      adjacency.get(file.name)?.add(dep);
      fanOut.set(file.name, (fanOut.get(file.name) ?? 0) + 1);
      fanIn.set(dep, (fanIn.get(dep) ?? 0) + 1);
    }
  }

  const nodes: ApexDependencyNode[] = sourceFiles
    .map((file) => ({
      name: file.name,
      kind: file.kind,
      filePath: file.relativePath,
      fanIn: fanIn.get(file.name) ?? 0,
      fanOut: fanOut.get(file.name) ?? 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const edges: ApexDependencyEdge[] = [...edgesSet]
    .map((key) => {
      const [from, to] = key.split("->");
      return { from: from ?? "", to: to ?? "" };
    })
    .filter((edge) => edge.from && edge.to)
    .sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`));

  const cycles = findCycles(adjacency);
  const isolatedCount = nodes.filter((node) => node.fanIn === 0 && node.fanOut === 0).length;
  const riskLevel = detectRiskLevel(edges.length, cycles.length);

  const suggestions: string[] = [];
  if (cycles.length > 0) {
    suggestions.push("循環依存が検出されました。Facade/Service分離や依存逆転で分解を検討してください。");
  }
  if (edges.length >= 40) {
    suggestions.push("依存辺が多いため、ドメイン単位の責務分割と公開APIの縮小を検討してください。");
  }
  if (isolatedCount > Math.max(5, Math.floor(nodes.length * 0.3))) {
    suggestions.push("孤立ノードが多いため、不要クラスの整理または命名と責務の再確認を推奨します。");
  }
  if (suggestions.length === 0) {
    suggestions.push("重大な構造リスクは検出されませんでした。継続的に差分監視してください。");
  }

  return {
    rootDir,
    summary: {
      totalFiles: sourceFiles.length,
      classCount: nodes.filter((node) => node.kind === "class").length,
      triggerCount: nodes.filter((node) => node.kind === "trigger").length,
      edgeCount: edges.length,
      isolatedCount,
      cycleCount: cycles.length,
      riskLevel
    },
    nodes,
    edges,
    cycles,
    topFanOut: toTopList(nodes, (node) => node.fanOut, sampleLimit),
    topFanIn: toTopList(nodes, (node) => node.fanIn, sampleLimit),
    mermaid: buildMermaid(nodes, edges),
    suggestions
  };
}
