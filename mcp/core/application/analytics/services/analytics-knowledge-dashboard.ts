import { escapeMermaidId, trimForNodeLabel } from "./analytics-formatters.js";
import type { OutputsPort } from "../../../ports/outputs-port.js";
import { withContextOutputsPort } from "../../../runtime/with-context.js";

interface DashboardEntity {
  id: string;
  name: string;
  type: string;
}

interface DashboardRelation {
  srcId: string;
  dstId: string;
  relationType: string;
  weight: number;
}

export interface KnowledgeDashboardPayload {
  entities: number;
  relations: number;
  markdown: string;
  mermaid: string;
}

export function buildKnowledgeDashboardPayload(
  entities: DashboardEntity[],
  relations: DashboardRelation[]
): KnowledgeDashboardPayload {
  const entityMap = new Map(entities.map((entity) => [entity.id, entity]));

  const mermaidLines = ["graph LR"];
  for (const entity of entities) {
    const nodeId = `n_${escapeMermaidId(entity.id)}`;
    const label = `${trimForNodeLabel(entity.name)} (${entity.type})`;
    mermaidLines.push(`  ${nodeId}[\"${label}\"]`);
  }

  for (const relation of relations) {
    if (!entityMap.has(relation.srcId) || !entityMap.has(relation.dstId)) {
      continue;
    }
    const srcId = `n_${escapeMermaidId(relation.srcId)}`;
    const dstId = `n_${escapeMermaidId(relation.dstId)}`;
    const edgeLabel = trimForNodeLabel(`${relation.relationType} (${relation.weight})`, 36);
    mermaidLines.push(`  ${srcId} -- \"${edgeLabel}\" --> ${dstId}`);
  }

  const topEntities = entities
    .slice(0, 10)
    .map((entity) => `- ${entity.name} [${entity.type}]`)
    .join("\n");
  const markdown = [
    "# Knowledge Graph Dashboard",
    "",
    `- Entities: ${entities.length}`,
    `- Relations: ${relations.length}`,
    "",
    "## Top Entities",
    topEntities || "- (none)",
    "",
    "## Mermaid",
    "```mermaid",
    ...mermaidLines,
    "```",
    ""
  ].join("\n");

  return {
    entities: entities.length,
    relations: relations.length,
    markdown,
    mermaid: mermaidLines.join("\n")
  };
}

export async function executeKnowledgeGraphDashboard(args: {
  limitEntities?: number;
  limitRelations?: number;
  write?: boolean;
  listKnowledgeEntities: () => DashboardEntity[];
  listKnowledgeRelations: () => DashboardRelation[];
  outputsPort: OutputsPort;
}): Promise<Record<string, unknown>> {
  const entityLimit = args.limitEntities ?? 60;
  const relationLimit = args.limitRelations ?? 120;

  const entities = args.listKnowledgeEntities().slice(0, entityLimit);
  const relations = args.listKnowledgeRelations().slice(0, relationLimit);
  const payload = buildKnowledgeDashboardPayload(entities, relations);
  const outputsPort = withContextOutputsPort(args.outputsPort);

  let outputPath: string | null = null;
  if (args.write ?? false) {
    outputPath = "dashboards/knowledge-graph.md";
    await outputsPort.writeArtifact(outputPath, payload.markdown, { contentType: "text/markdown" });
  }

  return {
    entities: payload.entities,
    relations: payload.relations,
    outputPath,
    markdown: payload.markdown,
    mermaid: payload.mermaid
  };
}
