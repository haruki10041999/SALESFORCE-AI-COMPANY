import { defineTool, type ToolDefinition } from "./define-tool.js";
import { toToolDescriptor, type ToolDescriptor } from "./tool-descriptor.js";

interface BuiltinToolSpec {
  name: string;
  capabilities?: string[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    this.tools.set(definition.name, definition);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  listDescriptors(): ToolDescriptor[] {
    return this.list().map((tool) => toToolDescriptor(tool));
  }

  byCapability(capability: string): ToolDefinition[] {
    return this.list().filter((tool) => (tool.capabilities ?? []).includes(capability));
  }
}

const BUILTIN_TOOL_SPECS: ReadonlyArray<BuiltinToolSpec> = [
  { name: "repo_analyze", capabilities: ["analysis", "repository"] },
  { name: "apex_analyze", capabilities: ["analysis", "apex"] },
  { name: "lwc_analyze", capabilities: ["analysis", "lwc"] },
  { name: "deploy_org", capabilities: ["deployment", "devops"] },
  { name: "run_tests", capabilities: ["testing", "verification"] },
  { name: "run_deployment_verification", capabilities: ["deployment", "verification"] },
  { name: "compare_org_metadata", capabilities: ["analysis", "metadata"] },
  { name: "flow_condition_simulate", capabilities: ["flow", "testing"] },
  { name: "suggest_flow_test_cases", capabilities: ["flow", "testing"] },
  { name: "permission_set_diff", capabilities: ["security", "permission"] },
  { name: "recommend_permission_sets", capabilities: ["security", "permission"] },
  { name: "apex_dependency_graph", capabilities: ["analysis", "apex"] },
  { name: "branch_diff_summary", capabilities: ["analysis", "repository"] },
  { name: "branch_diff_to_prompt", capabilities: ["analysis", "repository"] },
  { name: "simulate_dependency_impact", capabilities: ["analysis", "metadata"] },
  { name: "pr_readiness_check", capabilities: ["testing", "quality"] },
  { name: "security_delta_scan", capabilities: ["security", "analysis"] },
  { name: "deployment_impact_summary", capabilities: ["deployment", "analysis"] },
  { name: "changed_tests_suggest", capabilities: ["testing", "analysis"] },
  { name: "list_agents" },
  { name: "get_agent" },
  { name: "list_skills" },
  { name: "get_skill" },
  { name: "list_personas" },
  { name: "chat", capabilities: ["chat"] },
  { name: "simulate_chat", capabilities: ["chat", "simulation"] },
  { name: "orchestrate_chat", capabilities: ["chat", "orchestration"] },
  { name: "evaluate_triggers", capabilities: ["orchestration"] },
  { name: "dequeue_next_agent", capabilities: ["orchestration"] },
  { name: "get_orchestration_session", capabilities: ["orchestration"] },
  { name: "save_orchestration_session", capabilities: ["orchestration"] },
  { name: "restore_orchestration_session", capabilities: ["orchestration"] },
  { name: "list_orchestration_sessions", capabilities: ["orchestration"] },
  { name: "record_agent_message", capabilities: ["observability"] },
  { name: "record_reasoning_step", capabilities: ["observability"] },
  { name: "get_trace_reasoning", capabilities: ["observability"] },
  { name: "get_agent_log", capabilities: ["observability"] },
  { name: "parse_and_record_chat", capabilities: ["chat"] },
  { name: "get_system_events", capabilities: ["observability"] },
  { name: "get_event_automation_config", capabilities: ["governance"] },
  { name: "update_event_automation_config", capabilities: ["governance"] },
  { name: "save_chat_history", capabilities: ["chat"] },
  { name: "load_chat_history", capabilities: ["chat"] },
  { name: "restore_chat_history", capabilities: ["chat"] },
  { name: "create_preset" },
  { name: "list_presets" },
  { name: "run_preset", capabilities: ["chat"] },
  { name: "search_resources", capabilities: ["search"] },
  { name: "auto_select_resources", capabilities: ["search"] },
  { name: "record_skill_rating" },
  { name: "get_skill_rating_report" },
  { name: "agent_ab_test", capabilities: ["testing", "analysis"] },
  { name: "analyze_ab_test_history", capabilities: ["analysis"] },
  { name: "tune_trigger_rules", capabilities: ["governance"] },
  { name: "evaluate_cost_sla", capabilities: ["analysis", "cost"] },
  { name: "rate_tool_execution", capabilities: ["feedback"] },
  { name: "record_user_feedback", capabilities: ["feedback"] },
  { name: "get_feedback_metrics", capabilities: ["feedback", "analysis"] },
  { name: "get_session_feedback", capabilities: ["feedback"] },
  { name: "estimate_prompt_cost", capabilities: ["cost", "analysis"] },
  { name: "proposal_feedback_learn", capabilities: ["governance", "learning"] },
  { name: "smart_chat", capabilities: ["chat"] },
  { name: "analyze_chat_trends", capabilities: ["analysis", "chat"] },
  { name: "health_check", capabilities: ["observability", "diagnostics"] },
  { name: "get_tool_execution_statistics", capabilities: ["observability", "analysis"] },
  { name: "get_handlers_dashboard", capabilities: ["observability"] },
  { name: "export_handlers_statistics", capabilities: ["observability"] },
  { name: "export_to_markdown" },
  { name: "batch_chat", capabilities: ["chat"] },
  { name: "add_memory", capabilities: ["memory"] },
  { name: "search_memory", capabilities: ["memory", "search"] },
  { name: "list_memory", capabilities: ["memory"] },
  { name: "clear_memory", capabilities: ["memory"] },
  { name: "record_failure", capabilities: ["diagnostics"] },
  { name: "search_failures", capabilities: ["search", "diagnostics"] },
  { name: "list_failures", capabilities: ["diagnostics"] },
  { name: "add_vector_record", capabilities: ["memory"] },
  { name: "search_vector", capabilities: ["search", "memory"] },
  { name: "build_prompt" },
  { name: "evaluate_prompt_metrics", capabilities: ["analysis"] },
  { name: "evaluate_quality_rubric", capabilities: ["analysis", "quality"] },
  { name: "get_context" }
];

const CAPABILITY_KEYWORDS: Array<{ capability: string; keywords: string[] }> = [
  { capability: "deployment", keywords: ["deploy", "release", "rollout", "デプロイ", "リリース"] },
  { capability: "security", keywords: ["security", "permission", "auth", "セキュリティ", "権限", "認可"] },
  { capability: "testing", keywords: ["test", "verify", "qa", "テスト", "検証"] },
  { capability: "analysis", keywords: ["analyze", "analysis", "診断", "分析"] },
  { capability: "orchestration", keywords: ["orchestrate", "workflow", "queue", "オーケストレーション", "キュー"] },
  { capability: "memory", keywords: ["memory", "knowledge", "メモリ", "記憶"] },
  { capability: "chat", keywords: ["chat", "conversation", "会話"] },
  { capability: "observability", keywords: ["trace", "event", "dashboard", "観測", "可観測", "トレース"] }
];

export function inferCapabilitiesFromText(text: string): string[] {
  const normalized = text.toLowerCase();
  const detected = new Set<string>();
  for (const entry of CAPABILITY_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      detected.add(entry.capability);
    }
  }
  return [...detected];
}

export function createBuiltinToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  for (const spec of BUILTIN_TOOL_SPECS) {
    registry.register(defineTool(spec));
  }
  return registry;
}
