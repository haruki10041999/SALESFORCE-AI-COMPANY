export interface DagNode {
  id: string;
  dependsOn?: string[];
}

export interface DagValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * DAG をトポロジカルレイヤーに分解する。
 * 同一レイヤーのノードは並列実行可能。
 */
export function buildDagExecutionLayers(nodes: DagNode[]): string[][] {
  const validation = validateDag(nodes);
  if (!validation.ok) {
    throw new Error(`invalid dag: ${validation.errors.join("; ")}`);
  }

  const byId = new Map<string, DagNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn ?? []) {
      indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      outgoing.get(dep)?.push(node.id);
    }
  }

  const layers: string[][] = [];
  let current = nodes
    .map((node) => node.id)
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort();

  let visited = 0;
  while (current.length > 0) {
    layers.push(current);
    visited += current.length;

    const nextSet = new Set<string>();
    for (const id of current) {
      for (const child of outgoing.get(id) ?? []) {
        const rest = (indegree.get(child) ?? 0) - 1;
        indegree.set(child, rest);
        if (rest === 0) {
          nextSet.add(child);
        }
      }
    }
    current = [...nextSet].sort();
  }

  if (visited !== byId.size) {
    throw new Error("invalid dag: cycle detected");
  }

  return layers;
}

export function validateDag(nodes: DagNode[]): DagValidationResult {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const node of nodes) {
    if (!node.id || node.id.trim().length === 0) {
      errors.push("node id is required");
      continue;
    }
    if (ids.has(node.id)) {
      errors.push(`duplicate node id: ${node.id}`);
    }
    ids.add(node.id);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn ?? []) {
      if (!ids.has(dep)) {
        errors.push(`missing dependency: ${node.id} -> ${dep}`);
      }
      if (dep === node.id) {
        errors.push(`self dependency is not allowed: ${node.id}`);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  try {
    detectCycle(nodes);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function detectCycle(nodes: DagNode[]): void {
  const byId = new Map<string, DagNode>();
  for (const node of nodes) {
    byId.set(node.id, node);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(id: string): void {
    if (visited.has(id)) {
      return;
    }
    if (visiting.has(id)) {
      throw new Error(`cycle detected at: ${id}`);
    }

    visiting.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn ?? []) {
      dfs(dep);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const node of nodes) {
    dfs(node.id);
  }
}
