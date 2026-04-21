import { existsSync, promises as fsPromises } from "fs";
import { dirname, join, relative } from "path";
import { z } from "zod";

type GovTool = (name: string, config: any, handler: any) => void;

type GovernedResourceType = "skills" | "tools" | "presets";
type GovernanceActionType = "create" | "delete" | "disable" | "enable";

interface ChatPreset {
  name: string;
  description: string;
  topic: string;
  agents: string[];
  skills?: string[];
  persona?: string;
  filePaths?: string[];
}

interface CustomToolDefinition {
  name: string;
  description: string;
  agents: string[];
  skills?: string[];
  persona?: string;
  createdAt: string;
}

interface ResourceOperation {
  type: "create" | "delete";
  resourceType: GovernedResourceType;
  name: string;
  timestamp: string;
}

interface RegisterResourceActionToolsDeps {
  govTool: GovTool;
  root: string;
  presetsDir: string;
  toolProposalsDir: string;
  customToolsDir: string;
  governanceFile: string;
  loadGovernanceState: () => Promise<any>;
  saveGovernanceState: (state: any) => Promise<void>;
  ensureDir: (path: string) => Promise<void>;
  loadRecentOperations: () => Promise<ResourceOperation[]>;
  checkDailyLimitExceeded: (ops: ResourceOperation[], action: "create" | "delete", limit: number) => boolean;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: any) => string[];
  validateAndCreateSkillWithQuality: (name: string, content: string, state: any) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreatePresetWithQuality: (name: string, preset: { description: string; agents: string[]; topic: string }, state: any) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreateToolWithQuality: (name: string, description: string, state: any) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  createPreset: (preset: ChatPreset) => Promise<void>;
  registerCustomTool: (tool: CustomToolDefinition) => void;
  unregisterCustomTool: (name: string) => void;
  refreshDisabledToolsCache: () => Promise<void>;
  appendOperationLog: (op: ResourceOperation) => Promise<void>;
  emitEvent: (event: { type: string; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  toPosixPath: (pathValue: string) => string;
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
    toPosixPath
  } = deps;

  govTool(
    "apply_resource_actions",
    {
      title: "Apply Resource Actions",
      description: "リソース管理アクションを実行します。",
      inputSchema: {
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
    async ({ actions }: {
      actions: Array<{
        resourceType: GovernedResourceType;
        action: GovernanceActionType;
        name: string;
        content?: string;
        preset?: ChatPreset;
        toolConfig?: { agents?: string[]; skills?: string[]; persona?: string };
      }>;
    }) => {
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
          results.push({ action, resourceType, name, result: "disabled" });
          continue;
        }

        if (action === "enable") {
          state.disabled[resourceType] = state.disabled[resourceType].filter((entry: string) => entry !== name);
          results.push({ action, resourceType, name, result: "enabled" });
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

            const contentToWrite = content ?? ("# " + name + "\n\n(ここにスキル内容を記述)");
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

            await ensureDir(dirname(skillPath));
            await fsPromises.writeFile(skillPath, contentToWrite);
            results.push({ action, resourceType, name, result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + ")" });

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
            continue;
          }
          if (action === "delete") {
            if (existsSync(skillPath)) {
              await fsPromises.unlink(skillPath);
              results.push({ action, resourceType, name, result: "deleted" });
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
                description: "自動作成プリセット",
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

            await createPreset(presetToCreate);
            results.push({ action, resourceType, name, result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + ")" });

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
            continue;
          }
          if (action === "delete") {
            if (existsSync(presetPath)) {
              await fsPromises.unlink(presetPath);
              results.push({ action, resourceType, name, result: "deleted" });
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

            await ensureDir(customToolsDir);
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
            await fsPromises.writeFile(toolPath, JSON.stringify(toolDef, null, 2));
            registerCustomTool(toolDef);
            results.push({
              action,
              resourceType,
              name,
              result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + "): " + toPosixPath(relative(root, toolPath))
            });

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
            continue;
          }
          if (action === "delete") {
            const toolFileName = name.toLowerCase().replace(/\s+/g, "-");
            const customToolPath = join(customToolsDir, toolFileName + ".json");
            if (existsSync(customToolPath)) {
              await fsPromises.unlink(customToolPath);
              unregisterCustomTool(name);
              results.push({ action, resourceType, name, result: "deleted (カスタムツールファイルを削除)" });
            } else {
              if (!state.disabled.tools.includes(name)) {
                state.disabled.tools.push(name);
              }
              results.push({ action, resourceType, name, result: "disabled (ビルトインツールはファイル削除不可)" });
            }
            continue;
          }
        }

        results.push({ action, resourceType, name, result: "unsupported" });
      }

      await saveGovernanceState(state);
      await refreshDisabledToolsCache();

      for (const result of results) {
        if ((result.action === "create" || result.action === "delete") &&
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              applied: results.length,
              results,
              governanceFile: toPosixPath(relative(root, governanceFile))
            }, null, 2)
          }
        ]
      };
    }
  );
}