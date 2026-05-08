export type KnowledgeEntityType =
  | "person"
  | "organization"
  | "project"
  | "tech_stack"
  | "decision"
  | "concept";

export interface ExtractedEntity {
  type: KnowledgeEntityType;
  name: string;
  attributes?: Record<string, unknown>;
}

export interface ExtractedRelation {
  srcName: string;
  srcType: KnowledgeEntityType;
  relationType: string;
  dstName: string;
  dstType: KnowledgeEntityType;
  weight?: number;
  evidence?: string;
}

export interface GraphExtractionResult {
  entities: ExtractedEntity[];
  relations: ExtractedRelation[];
}

const LINE_HINTS: Array<{ pattern: RegExp; type: KnowledgeEntityType }> = [
  { pattern: /^(?:project|proj)\s*:\s*(.+)$/i, type: "project" },
  { pattern: /^(?:org|organization|team|company)\s*:\s*(.+)$/i, type: "organization" },
  { pattern: /^(?:person|owner|author|lead)\s*:\s*(.+)$/i, type: "person" },
  { pattern: /^(?:tech|stack|technology)\s*:\s*(.+)$/i, type: "tech_stack" },
  { pattern: /^(?:decision|decide|adr)\s*:\s*(.+)$/i, type: "decision" }
];

function cleanName(value: string): string {
  return value
    .trim()
    .replace(/^[-*\s]+/, "")
    .replace(/[。.!;:,\s]+$/, "")
    .replace(/\s{2,}/g, " ");
}

function splitCompositeValues(value: string): string[] {
  return value
    .split(/[|,/]/)
    .map((part) => cleanName(part))
    .filter((part) => part.length >= 2);
}

export function extractEntitiesFromSummary(summary: string): GraphExtractionResult {
  const entities: ExtractedEntity[] = [];
  const relations: ExtractedRelation[] = [];
  const dedupe = new Set<string>();

  const lines = summary.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (line.length === 0) continue;
    for (const hint of LINE_HINTS) {
      const matched = line.match(hint.pattern);
      if (!matched) continue;
      const values = splitCompositeValues(matched[1]);
      for (const name of values) {
        const key = `${hint.type}:${name.toLowerCase()}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        entities.push({ type: hint.type, name });
      }
    }
  }

  const inlineCodePattern = /`([^`]{2,80})`/g;
  let inlineMatch: RegExpExecArray | null;
  while ((inlineMatch = inlineCodePattern.exec(summary)) !== null) {
    const name = cleanName(inlineMatch[1]);
    const key = `concept:${name.toLowerCase()}`;
    if (name.length < 2 || dedupe.has(key)) continue;
    dedupe.add(key);
    entities.push({ type: "concept", name });
  }

  const project = entities.find((entity) => entity.type === "project") ?? null;
  const organization = entities.find((entity) => entity.type === "organization") ?? null;
  const anchor = project ?? organization;

  if (anchor) {
    for (const entity of entities) {
      if (entity.name === anchor.name && entity.type === anchor.type) {
        continue;
      }
      relations.push({
        srcName: anchor.name,
        srcType: anchor.type,
        relationType: "relates_to",
        dstName: entity.name,
        dstType: entity.type,
        weight: 1,
        evidence: summary.slice(0, 240)
      });
    }
  }

  return { entities, relations };
}
