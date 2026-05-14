import { existsSync, promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GovernanceState } from "../../core/governance/governance-state.js";
import type { ChatPreset, CustomToolDefinition, ResourceOperation } from "../../core/types/index.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { SystemEventType } from "../../core/event/event-dispatcher.js";
import type { CascadeMode } from "../../core/resource/cascading-delete.js";
import { defineSaga } from "../../core/ports/saga.js";
import { runSaga } from "../../infrastructure/workflow/saga-runner.js";
import {
  executeApplyResourceActions,
  type ApplyResourceActionItem
} from "../../core/application/resource/services/resource-apply-actions.js";

export interface DefineApplyResourceActionsDeps extends RegisterGovToolDeps {
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
}

interface ResourceSnapshot {
  resourceType: "skills" | "tools" | "presets";
  action: "delete" | "disable";
  name: string;
  exists: boolean;
  content?: string;
  preset?: ChatPreset;
  tool?: CustomToolDefinition;
}

type DangerousApplyResourceAction = ApplyResourceActionItem & { action: "delete" | "disable" };

function isDangerousAction(action: ApplyResourceActionItem): action is DangerousApplyResourceAction {
  return action.action === "delete" || action.action === "disable";
}

function resourcePathFromName(args: {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  root: string;
  presetsDir: string;
  customToolsDir: string;
  toPosixPath: (pathValue: string) => string;
}): string {
  if (args.resourceType === "skills") {
    return join(args.root, "skills", args.toPosixPath(args.name).replace(/\.md$/, "") + ".md");
  }
  if (args.resourceType === "presets") {
    const fileName = args.name.toLowerCase().replace(/\s+/g, "-");
    return join(args.presetsDir, `${fileName}.json`);
  }
  const toolFileName = args.name.toLowerCase().replace(/\s+/g, "-");
  return join(args.customToolsDir, `${toolFileName}.json`);
}

async function captureSnapshots(args: {
  actions: ApplyResourceActionItem[];
  root: string;
  presetsDir: string;
  customToolsDir: string;
  toPosixPath: (pathValue: string) => string;
}): Promise<ResourceSnapshot[]> {
  const snapshots: ResourceSnapshot[] = [];
  for (const action of args.actions) {
    if (!isDangerousAction(action)) {
      continue;
    }

    const snapshot: ResourceSnapshot = {
      resourceType: action.resourceType,
      action: action.action,
      name: action.name,
      exists: false
    };

    if (action.action === "disable") {
      snapshots.push(snapshot);
      continue;
    }

    const path = resourcePathFromName({
      resourceType: action.resourceType,
      name: action.name,
      root: args.root,
      presetsDir: args.presetsDir,
      customToolsDir: args.customToolsDir,
      toPosixPath: args.toPosixPath
    });

    if (!existsSync(path)) {
      snapshots.push(snapshot);
      continue;
    }

    snapshot.exists = true;
    const raw = await fsPromises.readFile(path, "utf-8");
    if (action.resourceType === "skills") {
      snapshot.content = raw;
    } else if (action.resourceType === "presets") {
      snapshot.preset = JSON.parse(raw) as ChatPreset;
    } else {
      snapshot.tool = JSON.parse(raw) as CustomToolDefinition;
    }
    snapshots.push(snapshot);
  }

  return snapshots;
}

function buildCompensationActions(snapshots: ResourceSnapshot[]): ApplyResourceActionItem[] {
  const compensations: ApplyResourceActionItem[] = [];

  for (const snapshot of [...snapshots].reverse()) {
    if (snapshot.action === "disable") {
      compensations.push({
        resourceType: snapshot.resourceType,
        action: "enable",
        name: snapshot.name
      });
      continue;
    }

    if (snapshot.action === "delete" && snapshot.exists) {
      if (snapshot.resourceType === "skills") {
        compensations.push({
          resourceType: snapshot.resourceType,
          action: "create",
          name: snapshot.name,
          content: snapshot.content
        });
        continue;
      }

      if (snapshot.resourceType === "presets") {
        compensations.push({
          resourceType: snapshot.resourceType,
          action: "create",
          name: snapshot.name,
          preset: snapshot.preset
        });
        continue;
      }

      compensations.push({
        resourceType: snapshot.resourceType,
        action: "create",
        name: snapshot.name,
        content: snapshot.tool?.description,
        toolConfig: {
          agents: snapshot.tool?.agents,
          skills: snapshot.tool?.skills,
          persona: snapshot.tool?.persona
        }
      });
      continue;
    }

    if (snapshot.action === "delete" && !snapshot.exists && snapshot.resourceType === "tools") {
      // Built-in tools are represented as disabled on delete, so revert by enabling.
      compensations.push({
        resourceType: "tools",
        action: "enable",
        name: snapshot.name
      });
    }
  }

  return compensations;
}

export function defineApplyResourceActionsTool(deps: DefineApplyResourceActionsDeps): void {
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
      title: "リソース操作適用",
      description: "リソース操作の変更を適用します。",
      inputSchema: z.object({
        dryRun: z.boolean().optional(),
        cascadeMode: z.enum(["force", "prompt", "block"]).optional(),
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
      })
    },
    async ({ actions, dryRun, cascadeMode }: {
      actions: ApplyResourceActionItem[];
      dryRun?: boolean;
      cascadeMode?: CascadeMode;
    }) => {
      const executeArgs = {
        actions,
        dryRun,
        cascadeMode,
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
      };

      const hasDangerousBatch = actions.some(isDangerousAction);
      if (!hasDangerousBatch || dryRun === true) {
        const payload = await executeApplyResourceActions(executeArgs);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(payload, null, 2)
            }
          ]
        };
      }

      const snapshots = await captureSnapshots({
        actions,
        root,
        presetsDir,
        customToolsDir,
        toPosixPath
      });
      const compensationActions = buildCompensationActions(snapshots);

      let payload: Record<string, unknown> | undefined;
      const saga = defineSaga({
        name: "apply_resource_actions_dangerous_batch",
        steps: [
          {
            name: "apply-actions",
            do: async () => {
              payload = await executeApplyResourceActions(executeArgs);
            },
            undo: async () => {
              if (compensationActions.length === 0) {
                return;
              }
              await executeApplyResourceActions({
                ...executeArgs,
                actions: compensationActions,
                dryRun: false
              });
            }
          }
        ]
      });

      const sagaResult = await runSaga({
        saga,
        context: {}
      });

      const envelope: Record<string, unknown> = {
        ...(payload ?? { dryRun: dryRun ?? false, applied: 0, results: [] }),
        saga: {
          status: sagaResult.status,
          completedSteps: sagaResult.completedSteps,
          compensatedSteps: sagaResult.compensatedSteps,
          compensationFailures: sagaResult.compensationFailures.map((failure) => ({
            step: failure.step,
            error: String(failure.error)
          }))
        }
      };

      if (sagaResult.failure) {
        envelope.error = {
          step: sagaResult.failure.step,
          message: String(sagaResult.failure.error)
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(envelope, null, 2)
          }
        ]
      };
    }
  );
}
