import { existsSync, promises as fsPromises } from "fs";
import { dirname, join, relative } from "path";
import { z } from "zod";
import type { GovernanceState, GovernedResourceType } from "../core/governance/governance-state.js";
import type { ChatPreset, CustomToolDefinition, ResourceOperation } from "../core/types/index.js";
import type { RegisterGovToolDeps } from "./types.js";
import type { SystemEventRecord } from "../core/event/system-event-manager.js";
import type { HandlersStatistics } from "./statistics-manager.js";
import { buildResourceActivityIndex } from "./statistics-manager.js";
import { suggestCleanupResources } from "../tools/suggest-cleanup-resources.js";

type GovernanceActionType = "create" | "delete" | "disable" | "enable";

interface RegisterResourceActionToolsDeps extends RegisterGovToolDeps {
  root: string;
  presetsDir: string;
  toolProposalsDir: string;
  customToolsDir: string;
  governanceFile: string;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  ensureDir: (path: string) => Promise<void>;
  loadRecentOperations: () => Promise<ResourceOperation[]>;
  checkDailyLimitExceeded: (ops: ResourceOperation[], action: "create" | "delete", limit: number) => boolean;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  validateAndCreateSkillWithQuality: (name: string, content: string, state: GovernanceState) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreatePresetWithQuality: (name: string, preset: { description: string; agents: string[]; topic: string }, state: GovernanceState) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreateToolWithQuality: (name: string, description: string, state: GovernanceState) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  createPreset: (preset: ChatPreset) => Promise<void>;
  registerCustomTool: (tool: CustomToolDefinition) => void;
  unregisterCustomTool: (name: string) => void;
  refreshDisabledToolsCache: () => Promise<void>;
  appendOperationLog: (op: ResourceOperation) => Promise<void>;
  emitEvent: (event: { type: string; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  toPosixPath: (pathValue: string) => string;
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  handlersStatistics: HandlersStatistics;
}

export function registerResourceActionTools(deps: RegisterResourceActionToolsDeps): void {
  const {
    govTool,
    root,
    presetsDir,
    toolProposalsDir,
    customToolsDir,
    governanceFile,
    loadGovernanceState,
    saveGovernanceState,
    ensureDir,
    loadRecentOperations,
    checkDailyLimitExceeded,
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality,
    createPreset,
    registerCustomTool,
    unregisterCustomTool,
    refreshDisabledToolsCache,
    appendOperationLog,
    emitEvent,
    toPosixPath,
    loadSystemEvents,
    handlersStatistics
  } = deps;
  const auditFile = join(dirname(governanceFile), "audit", "resource-actions.jsonl");

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
    lines.push(`# Cleanup Suggestion Report`);
    lines.push("");
    lines.push(`- generatedAt: ${payload.generatedAt}`);
    lines.push(`- thresholdDays: ${payload.thresholdDays}`);
    lines.push(`- candidateCount: ${payload.candidates.length}`);
    lines.push("");
    lines.push(`| type | name | usage | lastUsedAt | firstSeenAt | confidence | reason |`);
    lines.push(`|---|---|---:|---|---|---|---|`);
    for (const row of payload.candidates) {
      lines.push(
        `| ${row.resourceType} | ${row.name} | ${row.usageCount} | ${row.lastUsedAt ?? "-"} | ${row.firstSeenAt ?? "-"} | ${row.confidence} | ${row.reason} |`
      );
    }
    return lines.join("\n");
  }

  govTool(
    "apply_resource_actions",
    {
      title: "リソース操作適用",
      description: "リソース操作の変更を適用します。",
      inputSchema: {
        dryRun: z.boolean().optional(),
        actions: z.array(z.object({
          resourceType: z.enum(["skills", "tools", "presets"]),
          action: z.enum(["create", "delete", "disable", "enable"]),
          name: z.string(),
          content: z.string().optional(),
          preset: z.object({
            name: z.string(),
            description: z.string(),
            topic: z.string(),
            agents: z.array(z.string()),
            skills: z.array(z.string()).optional(),
            persona: z.string().optional(),
            filePaths: z.array(z.string()).optional()
          }).optional(),
          toolConfig: z.object({
            agents: z.array(z.string()).optional(),
            skills: z.array(z.string()).optional(),
            persona: z.string().optional()
          }).optional()
        })).min(1).max(50)
      }
    },
    async ({ actions, dryRun }: {
      actions: Array<{
        resourceType: GovernedResourceType;
        action: GovernanceActionType;
        name: string;
        content?: string;
        preset?: ChatPreset;
        toolConfig?: { agents?: string[]; skills?: string[]; persona?: string };
      }>;
      dryRun?: boolean;
    }) => {
      const effectiveDryRun = dryRun ?? false;
      const state = await loadGovernanceState();
      await ensureDir(presetsDir);
      await ensureDir(join(root, "skills"));
      await ensureDir(toolProposalsDir);

      const results: Array<{ action: string; resourceType: string; name: string; result: string }> = [];
      const recentOps = await loadRecentOperations();

      for (const item of actions) {
        const { resourceType, action, name, content, preset, toolConfig } = item;

        const dailyCreateLimit = state.config.resourceLimits?.creationsPerDay ?? 5;
        const dailyDeleteLimit = state.config.resourceLimits?.deletionsPerDay ?? 3;
        if (action === "create" && checkDailyLimitExceeded(recentOps, "create", dailyCreateLimit)) {
          results.push({ action, resourceType, name, result: "daily_limit_exceeded (create: " + dailyCreateLimit + "/day)" });
          continue;
        }
        if (action === "delete" && checkDailyLimitExceeded(recentOps, "delete", dailyDeleteLimit)) {
          results.push({ action, resourceType, name, result: "daily_limit_exceeded (delete: " + dailyDeleteLimit + "/day)" });
          continue;
        }

        if (action === "disable") {
          if (!state.disabled[resourceType].includes(name)) {
            state.disabled[resourceType].push(name);
          }
          results.push({ action, resourceType, name, result: effectiveDryRun ? "disabled (dry-run)" : "disabled" });
          continue;
        }

        if (action === "enable") {
          state.disabled[resourceType] = state.disabled[resourceType].filter((entry: string) => entry !== name);
          results.push({ action, resourceType, name, result: effectiveDryRun ? "enabled (dry-run)" : "enabled" });
          continue;
        }

        if (resourceType === "skills") {
          const skillPath = join(root, "skills", toPosixPath(name).replace(/\.md$/, "") + ".md");
          if (action === "create") {
            const count = (await listSkillsCatalog()).length;
            if (count >= state.config.maxCounts.skills) {
              results.push({ action, resourceType, name, result: "max reached (" + count + ")" });
              continue;
            }

            const contentToWrite = content ?? ("# " + name + "\n\n(ここにスキル説明を記載)");
            const qualityValidation = await validateAndCreateSkillWithQuality(name, contentToWrite, state);

            if (!qualityValidation.success) {
              results.push({ action, resourceType, name, result: "quality_check_failed: " + qualityValidation.message });
              try {
                await emitEvent({
                  type: "quality_check_failed",
                  timestamp: new Date().toISOString(),
                  payload: {
                    resourceType: "skills",
                    name,
                    errors: [qualityValidation.message]
                  }
                });
              } catch {
                // ignore
              }
              continue;
            }

            if (!effectiveDryRun) {
              await ensureDir(dirname(skillPath));
              await fsPromises.writeFile(skillPath, contentToWrite);
            }
            results.push({ action, resourceType, name, result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + ")" + (effectiveDryRun ? " (dry-run)" : "") });

            if (!effectiveDryRun) {
              try {
                await emitEvent({
                  type: "resource_created",
                  timestamp: new Date().toISOString(),
                  payload: {
                    resourceType: "skills",
                    name,
                    source: "apply_resource_actions"
                  }
                });
              } catch {
                // ignore
              }
            }
            continue;
          }
          if (action === "delete") {
            if (existsSync(skillPath)) {
              if (!effectiveDryRun) {
                await fsPromises.unlink(skillPath);
              }
              results.push({ action, resourceType, name, result: "deleted" + (effectiveDryRun ? " (dry-run)" : "") });
            } else {
              results.push({ action, resourceType, name, result: "not-found" });
            }
            continue;
          }
        }

        if (resourceType === "presets") {
          const fileName = name.toLowerCase().replace(/\s+/g, "-");
          const presetPath = join(presetsDir, fileName + ".json");
          if (action === "create") {
            const count = (await listPresetsCatalog()).length;
            if (count >= state.config.maxCounts.presets) {
              results.push({ action, resourceType, name, result: "max reached (" + count + ")" });
              continue;
            }

            let presetToCreate: ChatPreset;
            if (preset) {
              presetToCreate = {
                ...preset,
                skills: preset.skills ?? []
              };
            } else {
              presetToCreate = {
                name,
                description: "自動生成プリセット",
                topic: name,
                agents: ["product-manager", "architect", "qa-engineer"],
                skills: []
              };
            }

            const qualityValidation = await validateAndCreatePresetWithQuality(
              name,
              {
                description: presetToCreate.description,
                agents: presetToCreate.agents,
                topic: presetToCreate.topic
              },
              state
            );

            if (!qualityValidation.success) {
              results.push({ action, resourceType, name, result: "quality_check_failed: " + qualityValidation.message });
              try {
                await emitEvent({
                  type: "quality_check_failed",
                  timestamp: new Date().toISOString(),
                  payload: {
                    resourceType: "presets",
                    name,
                    errors: [qualityValidation.message]
                  }
                });
              } catch {
                // ignore
              }
              continue;
            }

            if (!effectiveDryRun) {
              await createPreset(presetToCreate);
            }
            results.push({ action, resourceType, name, result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + ")" + (effectiveDryRun ? " (dry-run)" : "") });

            if (!effectiveDryRun) {
              try {
                await emitEvent({
                  type: "resource_created",
                  timestamp: new Date().toISOString(),
                  payload: {
                    resourceType: "presets",
                    name,
                    source: "apply_resource_actions"
                  }
                });
              } catch {
                // ignore
              }
            }
            continue;
          }
          if (action === "delete") {
            if (existsSync(presetPath)) {
              if (!effectiveDryRun) {
                await fsPromises.unlink(presetPath);
              }
              results.push({ action, resourceType, name, result: "deleted" + (effectiveDryRun ? " (dry-run)" : "") });
            } else {
              results.push({ action, resourceType, name, result: "not-found" });
            }
            continue;
          }
        }

        if (resourceType === "tools") {
          if (action === "create") {
            const count = listToolsCatalog(state).length;
            if (count >= state.config.maxCounts.tools) {
              results.push({ action, resourceType, name, result: "max reached (" + count + ")" });
              continue;
            }

            const toolDescription = content ?? ("カスタムツール: " + name);
            const qualityValidation = await validateAndCreateToolWithQuality(name, toolDescription, state);

            if (!qualityValidation.success) {
              results.push({ action, resourceType, name, result: "quality_check_failed: " + qualityValidation.message });
              try {
                await emitEvent({
                  type: "quality_check_failed",
                  timestamp: new Date().toISOString(),
                  payload: {
                    resourceType: "tools",
                    name,
                    errors: [qualityValidation.message]
                  }
                });
              } catch {
                // ignore
              }
              continue;
            }

            if (!effectiveDryRun) {
              await ensureDir(customToolsDir);
            }
            const toolDef: CustomToolDefinition = {
              name,
              description: toolDescription,
              agents: (toolConfig?.agents && toolConfig.agents.length > 0)
                ? toolConfig.agents
                : ["product-manager", "architect"],
              skills: toolConfig?.skills ?? [],
              persona: toolConfig?.persona,
              createdAt: new Date().toISOString()
            };
            const toolFileName = name.toLowerCase().replace(/\s+/g, "-");
            const toolPath = join(customToolsDir, toolFileName + ".json");
            if (!effectiveDryRun) {
              await fsPromises.writeFile(toolPath, JSON.stringify(toolDef, null, 2));
              registerCustomTool(toolDef);
            }
            results.push({
              action,
              resourceType,
              name,
              result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + "): " + toPosixPath(relative(root, toolPath)) + (effectiveDryRun ? " (dry-run)" : "")
            });

            if (!effectiveDryRun) {
              try {
                await emitEvent({
                  type: "resource_created",
                  timestamp: new Date().toISOString(),
                  payload: {
                    resourceType: "tools",
                    name,
                    source: "apply_resource_actions"
                  }
                });
              } catch {
                // ignore
              }
            }
            continue;
          }
          if (action === "delete") {
            const toolFileName = name.toLowerCase().replace(/\s+/g, "-");
            const customToolPath = join(customToolsDir, toolFileName + ".json");
            if (existsSync(customToolPath)) {
              if (!effectiveDryRun) {
                await fsPromises.unlink(customToolPath);
                unregisterCustomTool(name);
              }
              results.push({ action, resourceType, name, result: "deleted (custom tool file)" + (effectiveDryRun ? " (dry-run)" : "") });
            } else {
              if (!state.disabled.tools.includes(name)) {
                state.disabled.tools.push(name);
              }
              results.push({ action, resourceType, name, result: "disabled (built-in tool cannot be deleted)" + (effectiveDryRun ? " (dry-run)" : "") });
            }
            continue;
          }
        }

        results.push({ action, resourceType, name, result: "unsupported" });
      }

      if (!effectiveDryRun) {
        await saveGovernanceState(state);
        await refreshDisabledToolsCache();
      }

      for (const result of results) {
        if (!effectiveDryRun && (result.action === "create" || result.action === "delete") &&
            !result.result.startsWith("daily_limit_exceeded") &&
            !result.result.startsWith("max reached") &&
            !result.result.startsWith("not-found") &&
            !result.result.startsWith("quality_check_failed")) {
          await appendOperationLog({
            type: result.action as "create" | "delete",
            resourceType: result.resourceType as GovernedResourceType,
            name: result.name,
            timestamp: new Date().toISOString()
          });
        }
      }

      try {
        await ensureDir(dirname(auditFile));
        const timestamp = new Date().toISOString();
        const records = results.map((result) => JSON.stringify({
          timestamp,
          source: "apply_resource_actions",
          dryRun: effectiveDryRun,
          action: result.action,
          resourceType: result.resourceType,
          name: result.name,
          outcome: result.result
        }));
        if (records.length > 0) {
          await fsPromises.appendFile(auditFile, `${records.join("\n")}\n`, "utf-8");
        }
      } catch {
        // audit logging failures must not break tool execution
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              dryRun: effectiveDryRun,
              applied: results.length,
              results,
              governanceFile: toPosixPath(relative(root, governanceFile)),
              auditFile: toPosixPath(relative(root, auditFile))
            }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "suggest_cleanup_resources",
    {
      title: "クリーンアップ候補提案",
      description: "30日以上未使用のスキル・プリセット・カスタムツール候補を dry-run で提案します。",
      inputSchema: {
        daysUnused: z.number().int().min(1).max(365).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        resourceTypes: z.array(z.enum(["skills", "tools", "presets"])).min(1).max(3).optional(),
        eventLimit: z.number().int().min(50).max(5000).optional()
      }
    },
    async ({
      daysUnused,
      limit,
      resourceTypes,
      eventLimit
    }: {
      daysUnused?: number;
      limit?: number;
      resourceTypes?: Array<"skills" | "tools" | "presets">;
      eventLimit?: number;
    }) => {
      const state = await loadGovernanceState();
      const targetTypes = resourceTypes ?? ["skills", "tools", "presets"];

      const skills = targetTypes.includes("skills") ? await listSkillsCatalog() : [];
      const presets = targetTypes.includes("presets") ? await listPresetsCatalog() : [];

      const customTools: string[] = [];
      if (targetTypes.includes("tools") && existsSync(customToolsDir)) {
        const entries = await fsPromises.readdir(customToolsDir);
        for (const entry of entries) {
          if (!entry.endsWith(".json")) {
            continue;
          }
          try {
            const raw = await fsPromises.readFile(join(customToolsDir, entry), "utf-8");
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

      const events = await loadSystemEvents(eventLimit ?? 2000, "tool_before_execute");
      const activityIndex = buildResourceActivityIndex(handlersStatistics, events);

      const suggestion = suggestCleanupResources({
        daysUnused: daysUnused ?? 30,
        limit: limit ?? 50,
        usage: state.usage,
        bugSignals: state.bugSignals,
        catalogs: {
          skills,
          presets,
          customTools: [...toolSet]
        },
        activity: activityIndex
      });

      const outputsDir = dirname(governanceFile);
      const reportsDir = join(outputsDir, "reports");
      await ensureDir(reportsDir);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const jsonPath = join(reportsDir, `cleanup-suggestions-${stamp}.json`);
      const mdPath = join(reportsDir, `cleanup-suggestions-${stamp}.md`);

      await fsPromises.writeFile(jsonPath, JSON.stringify(suggestion, null, 2), "utf-8");
      await fsPromises.writeFile(mdPath, renderCleanupMarkdown(suggestion), "utf-8");

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              dryRun: true,
              thresholdDays: suggestion.thresholdDays,
              totalAnalyzed: suggestion.totalAnalyzed,
              candidateCount: suggestion.candidates.length,
              candidates: suggestion.candidates,
              reportJson: toPosixPath(jsonPath),
              reportMarkdown: toPosixPath(mdPath)
            }, null, 2)
          }
        ]
      };
    }
  );
}
