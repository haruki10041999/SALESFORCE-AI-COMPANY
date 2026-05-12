import { existsSync, promises as fsPromises } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { GovernanceState, GovernedResourceType } from "../../../governance/governance-state.js";
import type { SystemEventType } from "../../../event/event-dispatcher.js";
import type { ChatPreset, CustomToolDefinition, ResourceOperation } from "../../../types/index.js";
import { evaluateCascadeDeletion, renderCascadeImpactMarkdown, type CascadeMode } from "../../../resource/cascading-delete.js";
import { OutputsArtifactWriter } from "../../../persistence/outputs-artifact-writer.js";

type GovernanceActionType = "create" | "delete" | "disable" | "enable";

export interface ApplyResourceActionItem {
  resourceType: GovernedResourceType;
  action: GovernanceActionType;
  name: string;
  content?: string;
  preset?: ChatPreset;
  toolConfig?: { agents?: string[]; skills?: string[]; persona?: string };
}

function isOperationLoggable(result: { action: string; result: string }): boolean {
  return (result.action === "create" || result.action === "delete")
    && !result.result.startsWith("daily_limit_exceeded")
    && !result.result.startsWith("max reached")
    && !result.result.startsWith("not-found")
    && !result.result.startsWith("quality_check_failed");
}

export async function executeApplyResourceActions(args: {
  actions: ApplyResourceActionItem[];
  dryRun?: boolean;
  cascadeMode?: CascadeMode;
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
  emitEvent: (event: { type: SystemEventType; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  toPosixPath: (pathValue: string) => string;
}): Promise<Record<string, unknown>> {
  const effectiveDryRun = args.dryRun ?? false;
  const effectiveCascadeMode: CascadeMode = args.cascadeMode ?? "block";
  const state = await args.loadGovernanceState();
  await args.ensureDir(args.presetsDir);
  await args.ensureDir(join(args.root, "skills"));
  await args.ensureDir(args.toolProposalsDir);

  const results: Array<{ action: string; resourceType: string; name: string; result: string }> = [];
  const recentOps = await args.loadRecentOperations();

  for (const item of args.actions) {
    const { resourceType, action, name, content, preset, toolConfig } = item;

    const dailyCreateLimit = state.config.resourceLimits?.creationsPerDay ?? 5;
    const dailyDeleteLimit = state.config.resourceLimits?.deletionsPerDay ?? 3;
    if (action === "create" && args.checkDailyLimitExceeded(recentOps, "create", dailyCreateLimit)) {
      results.push({ action, resourceType, name, result: `daily_limit_exceeded (create: ${dailyCreateLimit}/day)` });
      continue;
    }
    if (action === "delete" && args.checkDailyLimitExceeded(recentOps, "delete", dailyDeleteLimit)) {
      results.push({ action, resourceType, name, result: `daily_limit_exceeded (delete: ${dailyDeleteLimit}/day)` });
      continue;
    }

    if (action === "delete" || action === "disable") {
      const impact = await evaluateCascadeDeletion({
        resourceType,
        name,
        presetsDir: args.presetsDir,
        mode: effectiveCascadeMode
      });
      if (impact.downstream.length > 0) {
        try {
          await args.emitEvent({
            type: "cascade_impact_detected",
            timestamp: new Date().toISOString(),
            payload: {
              resourceType,
              name,
              action,
              mode: effectiveCascadeMode,
              blocked: impact.blocked,
              downstreamCount: impact.downstream.length,
              downstream: impact.downstream.map((d) => ({ type: d.type, name: d.name }))
            }
          });
        } catch {
          // ignore emit failure
        }
        if (impact.blocked) {
          results.push({
            action,
            resourceType,
            name,
            result: `blocked_by_cascade: ${impact.message}\n\n${renderCascadeImpactMarkdown(impact)}`
          });
          continue;
        }
      }
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
      const skillPath = join(args.root, "skills", args.toPosixPath(name).replace(/\.md$/, "") + ".md");
      if (action === "create") {
        const count = (await args.listSkillsCatalog()).length;
        if (count >= state.config.maxCounts.skills) {
          results.push({ action, resourceType, name, result: `max reached (${count})` });
          continue;
        }

        const contentToWrite = content ?? `# ${name}\n\n(ここにスキル説明を記載)`;
        const qualityValidation = await args.validateAndCreateSkillWithQuality(name, contentToWrite, state);

        if (!qualityValidation.success) {
          results.push({ action, resourceType, name, result: `quality_check_failed: ${qualityValidation.message}` });
          try {
            await args.emitEvent({
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
          await args.ensureDir(dirname(skillPath));
          await fsPromises.writeFile(skillPath, contentToWrite);
        }
        results.push({ action, resourceType, name, result: `created (quality_score: ${qualityValidation.qualityScore ?? 0})${effectiveDryRun ? " (dry-run)" : ""}` });

        if (!effectiveDryRun) {
          try {
            await args.emitEvent({
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
          results.push({ action, resourceType, name, result: `deleted${effectiveDryRun ? " (dry-run)" : ""}` });
        } else {
          results.push({ action, resourceType, name, result: "not-found" });
        }
        continue;
      }
    }

    if (resourceType === "presets") {
      const fileName = name.toLowerCase().replace(/\s+/g, "-");
      const presetPath = join(args.presetsDir, fileName + ".json");
      if (action === "create") {
        const count = (await args.listPresetsCatalog()).length;
        if (count >= state.config.maxCounts.presets) {
          results.push({ action, resourceType, name, result: `max reached (${count})` });
          continue;
        }

        const presetToCreate: ChatPreset = preset
          ? {
            ...preset,
            skills: preset.skills ?? []
          }
          : {
            name,
            description: "自動生成プリセット",
            topic: name,
            agents: ["product-manager", "architect", "qa-engineer"],
            skills: []
          };

        const qualityValidation = await args.validateAndCreatePresetWithQuality(
          name,
          {
            description: presetToCreate.description,
            agents: presetToCreate.agents,
            topic: presetToCreate.topic
          },
          state
        );

        if (!qualityValidation.success) {
          results.push({ action, resourceType, name, result: `quality_check_failed: ${qualityValidation.message}` });
          try {
            await args.emitEvent({
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
          await args.createPreset(presetToCreate);
        }
        results.push({ action, resourceType, name, result: `created (quality_score: ${qualityValidation.qualityScore ?? 0})${effectiveDryRun ? " (dry-run)" : ""}` });

        if (!effectiveDryRun) {
          try {
            await args.emitEvent({
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
          results.push({ action, resourceType, name, result: `deleted${effectiveDryRun ? " (dry-run)" : ""}` });
        } else {
          results.push({ action, resourceType, name, result: "not-found" });
        }
        continue;
      }
    }

    if (resourceType === "tools") {
      if (action === "create") {
        const count = args.listToolsCatalog(state).length;
        if (count >= state.config.maxCounts.tools) {
          results.push({ action, resourceType, name, result: `max reached (${count})` });
          continue;
        }

        const toolDescription = content ?? `カスタムツール: ${name}`;
        const qualityValidation = await args.validateAndCreateToolWithQuality(name, toolDescription, state);

        if (!qualityValidation.success) {
          results.push({ action, resourceType, name, result: `quality_check_failed: ${qualityValidation.message}` });
          try {
            await args.emitEvent({
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
          await args.ensureDir(args.customToolsDir);
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
        const toolPath = join(args.customToolsDir, toolFileName + ".json");
        if (!effectiveDryRun) {
          await fsPromises.writeFile(toolPath, JSON.stringify(toolDef, null, 2));
          args.registerCustomTool(toolDef);
        }
        results.push({
          action,
          resourceType,
          name,
          result: `created (quality_score: ${qualityValidation.qualityScore ?? 0}): ${args.toPosixPath(relative(args.root, toolPath))}${effectiveDryRun ? " (dry-run)" : ""}`
        });

        if (!effectiveDryRun) {
          try {
            await args.emitEvent({
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
        const customToolPath = join(args.customToolsDir, toolFileName + ".json");
        if (existsSync(customToolPath)) {
          if (!effectiveDryRun) {
            await fsPromises.unlink(customToolPath);
            args.unregisterCustomTool(name);
          }
          results.push({ action, resourceType, name, result: `deleted (custom tool file)${effectiveDryRun ? " (dry-run)" : ""}` });
        } else {
          if (!state.disabled.tools.includes(name)) {
            state.disabled.tools.push(name);
          }
          results.push({ action, resourceType, name, result: `disabled (built-in tool cannot be deleted)${effectiveDryRun ? " (dry-run)" : ""}` });
        }
        continue;
      }
    }

    results.push({ action, resourceType, name, result: "unsupported" });
  }

  if (!effectiveDryRun) {
    await args.saveGovernanceState(state);
    await args.refreshDisabledToolsCache();
  }

  for (const result of results) {
    if (!effectiveDryRun && isOperationLoggable(result)) {
      await args.appendOperationLog({
        type: result.action as "create" | "delete",
        resourceType: result.resourceType as GovernedResourceType,
        name: result.name,
        timestamp: new Date().toISOString()
      });
    }
  }

  const auditFile = join(dirname(args.governanceFile), "audit", "resource-actions.jsonl");
  const artifactWriter = new OutputsArtifactWriter({
    outputsDir: dirname(args.governanceFile),
    databaseUrl: process.env.DATABASE_URL
  });
  try {
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
      for (const row of records) {
        const payload = JSON.parse(row) as Record<string, unknown>;
        await artifactWriter.appendAuditArtifact(
          "resource_action",
          typeof payload.resourceType === "string" ? payload.resourceType : null,
          payload,
          typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
          "audit/resource-actions.jsonl"
        );
      }
    }
  } catch {
    // audit logging failures must not break tool execution
  }

  return {
    dryRun: effectiveDryRun,
    applied: results.length,
    results,
    governanceFile: args.toPosixPath(relative(args.root, args.governanceFile)),
    auditFile: args.toPosixPath(relative(args.root, auditFile))
  };
}