import { join, relative } from "node:path";
import { createCatalogHelpers } from "./core/context/catalog-helpers.js";
import {
  validateSkillCreation,
  validatePresetCreation,
  validateToolCreation
} from "./core/quality/resource-validation.js";
import type { GovernanceState } from "./core/governance/governance-state.js";
import type { ChatPreset as StoredChatPreset } from "./core/context/preset-store.js";

export const BUILTIN_TOOL_CATALOG = [
  "repo_analyze",
  "apex_analyze",
  "lwc_analyze",
  "deploy_org",
  "run_tests",
  "run_deployment_verification",
  "compare_org_metadata",
  "flow_condition_simulate",
  "suggest_flow_test_cases",
  "permission_set_diff",
  "recommend_permission_sets",
  "apex_dependency_graph",
  "branch_diff_summary",
  "branch_diff_to_prompt",
    "simulate_dependency_impact",
  "pr_readiness_check",
  "security_delta_scan",
  "deployment_impact_summary",
  "changed_tests_suggest",
  "list_agents",
  "get_agent",
  "list_skills",
  "get_skill",
  "list_personas",
  "chat",
  "simulate_chat",
  "orchestrate_chat",
  "evaluate_triggers",
  "dequeue_next_agent",
  "get_orchestration_session",
  "save_orchestration_session",
  "restore_orchestration_session",
  "list_orchestration_sessions",
  "record_agent_message",
  "record_reasoning_step",
  "get_trace_reasoning",
  "get_agent_log",
  "parse_and_record_chat",
  "get_system_events",
  "get_event_automation_config",
  "update_event_automation_config",
  "save_chat_history",
  "load_chat_history",
  "restore_chat_history",
  "create_preset",
  "list_presets",
  "run_preset",
  "search_resources",
  "auto_select_resources",
  "record_skill_rating",
  "get_skill_rating_report",
  "agent_ab_test",
  "analyze_ab_test_history",
  "tune_trigger_rules",
  "evaluate_cost_sla",
  "rate_tool_execution",
  "record_user_feedback",
  "get_feedback_metrics",
  "get_session_feedback",
  "estimate_prompt_cost",
  "proposal_feedback_learn",
  "smart_chat",
  "analyze_chat_trends",
  "health_check",
  "get_tool_execution_statistics",
  "get_handlers_dashboard",
  "export_handlers_statistics",
  "export_to_markdown",
  "batch_chat",
  "add_memory",
  "search_memory",
  "list_memory",
  "clear_memory",
  "record_failure",
  "search_failures",
  "list_failures",
  "add_vector_record",
  "search_vector",
  "build_prompt",
  "evaluate_prompt_metrics",
  "evaluate_quality_rubric",
  "get_context"
];

interface CreateServerResourceDepsInput {
  root: string;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (p: string) => string;
  listPresetsData: () => Promise<StoredChatPreset[]>;
  loadedCustomToolNames: { has: (k: string) => boolean; [Symbol.iterator]: () => IterableIterator<string> };
}

export function createServerResourceDeps(input: CreateServerResourceDepsInput) {
  const {
    root,
    findMdFilesRecursive,
    toPosixPath,
    listPresetsData,
    loadedCustomToolNames
  } = input;

  const { listSkillsCatalog, listPresetsCatalog, listToolsCatalog, resourceScore } = createCatalogHelpers({
    skillsDir: join(root, "skills"),
    findMdFilesRecursive,
    toPosixPath,
    relative,
    listPresetsData,
    builtinToolCatalog: BUILTIN_TOOL_CATALOG,
    loadedCustomToolNames
  });

  async function validateAndCreateSkillWithQuality(
    skillName: string,
    skillContent: string,
    _state: GovernanceState
  ): Promise<{
    success: boolean;
    message: string;
    qualityScore?: number;
    duplicateFound?: boolean;
  }> {
    const existingSkills = await listSkillsCatalog();
    return validateSkillCreation(skillName, skillContent, existingSkills);
  }

  async function validateAndCreatePresetWithQuality(
    presetName: string,
    presetData: {
      description: string;
      agents: string[];
      topic: string;
    },
    _state: GovernanceState
  ): Promise<{
    success: boolean;
    message: string;
    qualityScore?: number;
    duplicateFound?: boolean;
  }> {
    const existingPresets = await listPresetsCatalog();
    return validatePresetCreation(presetName, presetData, existingPresets);
  }

  async function validateAndCreateToolWithQuality(
    toolName: string,
    toolDescription: string,
    state: GovernanceState
  ): Promise<{
    success: boolean;
    message: string;
    qualityScore?: number;
    duplicateFound?: boolean;
  }> {
    const existingTools = listToolsCatalog(state);
    return validateToolCreation(toolName, toolDescription, existingTools);
  }

  return {
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality
  };
}
