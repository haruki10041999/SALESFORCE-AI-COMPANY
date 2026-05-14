import type { RegisterToolFn } from "@mcp/tool-types.js";
import {
  createDisabledResourceFilter,
  createDisabledToolsCacheManager,
  createGovernanceEventAutomationManager,
  createGovernedToolRegistrar,
  type GovernanceState,
  type SystemEventName,
  type ToolDefinition,
  type BanditState
} from "../../core/application/governance/bootstrap-adapters.js";
import type { CostLedgerPort } from "../../core/ports/cost-ledger-port.js";

export interface GovernanceBootstrapOptions {
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
    debug(message: string): void;
  };
  governanceStoragePath: string;
  outputsDir: string;
  serverRoot: string;
  stateBackend: "sqlite" | "postgres";
  databaseUrl?: string;
  toPosixPath: (value: string) => string;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  normalizeDisabledEntries: (names: string[]) => string[];
  normalizeProtectedTools: (names: string[]) => string[];
  buildDefaultGovernanceState: () => GovernanceState;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  summarizeValue: (value: unknown, maxLength?: number) => string;
  registerToolFailure: (toolName: string, error: unknown) => Promise<void>;
  getBanditState: () => unknown;
  banditStateFile: string;
  registerTool: RegisterToolFn;
  onToolDefined: (definition: ToolDefinition) => void;
  costLedger: CostLedgerPort;
}

export function startGovernanceBootstrap(options: GovernanceBootstrapOptions) {
  const disabledResourceFilter = createDisabledResourceFilter({
    loadGovernanceState: options.loadGovernanceState,
    toPosixPath: options.toPosixPath
  });

  function normalizeResourceName(name: string): string {
    return disabledResourceFilter.normalizeResourceName(name);
  }

  const disabledToolsCache = createDisabledToolsCacheManager({
    governanceFilePath: options.governanceStoragePath,
    logger: options.logger,
    loadGovernanceState: options.loadGovernanceState,
    normalizeResourceName,
    stateBackend: options.stateBackend,
    databaseUrl: options.databaseUrl
  });

  const { govTool } = createGovernedToolRegistrar({
    registerTool: options.registerTool,
    isToolDisabled: (toolName: string) => disabledToolsCache.isToolDisabled(toolName),
    normalizeResourceName,
    outputsDir: options.outputsDir,
    databaseUrl: options.databaseUrl,
    costLedger: options.costLedger,
    serverRoot: options.serverRoot,
    emitSystemEvent: options.emitSystemEvent,
    summarizeValue: options.summarizeValue,
    registerToolFailure: options.registerToolFailure,
    getBanditState: options.getBanditState as () => BanditState,
    banditStateFile: options.banditStateFile,
    onToolDefined: options.onToolDefined,
    getRetryConfig: async () => (await options.loadGovernanceState()).config.toolExecution
  });

  const governanceEventAutomation = createGovernanceEventAutomationManager({
    loadGovernanceState: options.loadGovernanceState,
    saveGovernanceState: options.saveGovernanceState,
    normalizeResourceName,
    normalizeDisabledEntries: options.normalizeDisabledEntries,
    normalizeProtectedTools: options.normalizeProtectedTools,
    refreshDisabledToolsCache: () => disabledToolsCache.refresh("event-automation"),
    getDefaultEventAutomationConfig: () => options.buildDefaultGovernanceState().config.eventAutomation,
    summarizeError: options.summarizeValue
  });

  async function filterDisabledSkills(skillNames: string[]): Promise<{ enabled: string[]; disabled: string[] }> {
    return disabledResourceFilter.filterDisabledSkills(skillNames);
  }

  async function isPresetDisabled(presetName: string): Promise<boolean> {
    return disabledResourceFilter.isPresetDisabled(presetName);
  }

  async function applyEventAutomation(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
    await governanceEventAutomation.applyEventAutomation(event, payload);
  }

  return {
    govTool,
    disabledToolsCache,
    normalizeResourceName,
    filterDisabledSkills,
    isPresetDisabled,
    governanceEventAutomation,
    applyEventAutomation
  };
}
