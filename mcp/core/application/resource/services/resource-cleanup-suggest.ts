import { existsSync, promises as fsPromises } from "node:fs";
import { dirname, join } from "node:path";
import type { GovernanceState } from "../../../governance/governance-state.js";
import type { SystemEventRecord } from "../../../event/system-event-manager.js";
import { suggestCleanupResources } from "../../../../tools/suggest-cleanup-resources.js";
import type { GovernedResourceType } from "../../../governance/governance-state.js";
import type { OutputsPort } from "../../../ports/outputs-port.js";
import { withContextOutputsPort } from "../../../runtime/with-context.js";
import { LocalOutputsAdapter } from "../../../../infrastructure/outputs/local-outputs-adapter.js";

interface ResourceActivitySnapshot {
  lastUsedAt?: string;
  firstSeenAt?: string;
}

interface HandlersStatistics {
  created: {
    lastCreatedResources: Array<{
      resourceType: string;
      name: string;
      timestamp: string;
    }>;
  };
  deleted: {
    deletedResources: Array<{
      resourceType: string;
      name: string;
      timestamp: string;
    }>;
  };
}

function buildResourceActivityIndex(
  stats: HandlersStatistics,
  events: SystemEventRecord[]
): Record<GovernedResourceType, Record<string, ResourceActivitySnapshot>> {
  const index: Record<GovernedResourceType, Record<string, ResourceActivitySnapshot>> = {
    skills: {},
    tools: {},
    presets: {}
  };

  const observe = (type: GovernedResourceType, name: string, timestamp: string) => {
    const slot = index[type][name] ?? {};
    const observedAt = new Date(timestamp).toISOString();
    if (!slot.firstSeenAt || observedAt < slot.firstSeenAt) {
      slot.firstSeenAt = observedAt;
    }
    if (!slot.lastUsedAt || observedAt > slot.lastUsedAt) {
      slot.lastUsedAt = observedAt;
    }
    index[type][name] = slot;
  };

  for (const record of stats.created.lastCreatedResources) {
    const type = record.resourceType as GovernedResourceType;
    if (!(type in index)) {
      continue;
    }
    observe(type, record.name, record.timestamp);
  }

  for (const record of stats.deleted.deletedResources) {
    const type = record.resourceType as GovernedResourceType;
    if (!(type in index)) {
      continue;
    }
    observe(type, record.name, record.timestamp);
  }

  for (const event of events) {
    const payload = event.payload as Record<string, unknown>;
    const resourceType = payload.resourceType;
    const resourceName = payload.name;
    if (
      typeof resourceType !== "string" ||
      typeof resourceName !== "string" ||
      !(resourceType in index)
    ) {
      continue;
    }
    observe(resourceType as GovernedResourceType, resourceName, event.timestamp);
  }

  return index;
}

function renderCleanupMarkdown(payload: {
  generatedAt: string;
  thresholdDays: number;
  candidates: Array<{
    resourceType: string;
    name: string;
    usageCount: number;
    lastUsedAt: string | null;
    firstSeenAt: string | null;
    reason: string;
    confidence: string;
  }>;
}): string {
  const lines: string[] = [];
  lines.push("# Cleanup Suggestion Report");
  lines.push("");
  lines.push(`- generatedAt: ${payload.generatedAt}`);
  lines.push(`- thresholdDays: ${payload.thresholdDays}`);
  lines.push(`- candidateCount: ${payload.candidates.length}`);
  lines.push("");
  lines.push("| type | name | usage | lastUsedAt | firstSeenAt | confidence | reason |");
  lines.push("|---|---|---:|---|---|---|---|");
  for (const row of payload.candidates) {
    lines.push(
      `| ${row.resourceType} | ${row.name} | ${row.usageCount} | ${row.lastUsedAt ?? "-"} | ${row.firstSeenAt ?? "-"} | ${row.confidence} | ${row.reason} |`
    );
  }
  return lines.join("\n");
}

export async function executeSuggestCleanupResources(args: {
  daysUnused?: number;
  limit?: number;
  resourceTypes?: Array<"skills" | "tools" | "presets">;
  eventLimit?: number;
  customToolsDir: string;
  governanceFile: string;
  loadGovernanceState: () => Promise<GovernanceState>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  handlersStatistics: HandlersStatistics;
  toPosixPath: (pathValue: string) => string;
  outputsPort?: OutputsPort;
}): Promise<Record<string, unknown>> {
  const state = await args.loadGovernanceState();
  const targetTypes = args.resourceTypes ?? ["skills", "tools", "presets"];

  const skills = targetTypes.includes("skills") ? await args.listSkillsCatalog() : [];
  const presets = targetTypes.includes("presets") ? await args.listPresetsCatalog() : [];

  const customTools: string[] = [];
  if (targetTypes.includes("tools") && existsSync(args.customToolsDir)) {
    const entries = await fsPromises.readdir(args.customToolsDir);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      try {
        const raw = await fsPromises.readFile(join(args.customToolsDir, entry), "utf-8");
        const parsed = JSON.parse(raw) as { name?: unknown };
        if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
          customTools.push(parsed.name.trim());
        }
      } catch {
        // skip malformed custom tool file
      }
    }
  }

  const toolSet = new Set(customTools);

  const events = await args.loadSystemEvents(args.eventLimit ?? 2000, "tool_before_execute");
  const activityIndex = buildResourceActivityIndex(args.handlersStatistics, events);

  const suggestion = suggestCleanupResources({
    daysUnused: args.daysUnused ?? 30,
    limit: args.limit ?? 50,
    usage: state.usage,
    bugSignals: state.bugSignals,
    catalogs: {
      skills,
      presets,
      customTools: [...toolSet]
    },
    activity: activityIndex
  });

  const outputsDir = dirname(args.governanceFile);
  const reportsDir = join(outputsDir, "reports", "cleanup-suggestions");
  const jsonPath = join(reportsDir, "latest.json");
  const mdPath = join(reportsDir, "latest.md");

  const outputsPort = withContextOutputsPort(args.outputsPort ?? new LocalOutputsAdapter({ outputsDir }));
  await outputsPort.appendEvent("reports/cleanup-suggestions/runs.jsonl", suggestion);
  await outputsPort.writeArtifact("reports/cleanup-suggestions/latest.json", `${JSON.stringify(suggestion, null, 2)}\n`);
  await outputsPort.writeArtifact("reports/cleanup-suggestions/latest.md", renderCleanupMarkdown(suggestion));

  return {
    dryRun: true,
    thresholdDays: suggestion.thresholdDays,
    totalAnalyzed: suggestion.totalAnalyzed,
    candidateCount: suggestion.candidates.length,
    candidates: suggestion.candidates,
    reportJson: args.toPosixPath(jsonPath),
    reportMarkdown: args.toPosixPath(mdPath)
  };
}