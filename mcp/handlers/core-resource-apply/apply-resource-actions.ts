import { z } from "zod";
import type { GovernanceState } from "../../core/governance/governance-state.js";
import type { ChatPreset, CustomToolDefinition, ResourceOperation } from "../../core/types/index.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { SystemEventType } from "../../core/event/event-dispatcher.js";
import type { CascadeMode } from "../../core/resource/cascading-delete.js";
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
      const payload = await executeApplyResourceActions({
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
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      };
    }
  );
}
