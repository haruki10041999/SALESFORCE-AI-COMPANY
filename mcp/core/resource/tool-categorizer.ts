/**
 * TASK-02: Tool Surface Hierarchization
 *
 * 113個以上のツールを5-7個のセマンティックカテゴリーに整理し、
 * smart_chat が domain relevance に基づいてツール選択できるようにする。
 *
 * カテゴリー体系：
 *  1. Chat & Orchestration (会話、エージェント調整、セッション管理)
 *  2. Analytics & Evaluation (分析、評価、メトリクス、QA)
 *  3. Governance & Compliance (予算、権限、ポリシー、セキュリティ)
 *  4. Resource Management (リソース検索、作成、削除、構成)
 *  5. Development & Deployment (コード分析、デプロイ、テスト、Apex)
 *  6. Memory & Knowledge (メモリ管理、ベクトル、知識グラフ)
 *  7. Admin & Operations (テナント管理、オーケストレーション、提案管理)
 */

export type ToolCategory = 
  | "chat-orchestration"
  | "analytics-evaluation"
  | "governance-compliance"
  | "resource-management"
  | "development-deployment"
  | "memory-knowledge"
  | "admin-operations";

export const TOOL_CATEGORIES = {
  CHAT_ORCHESTRATION: "chat-orchestration" as const,
  ANALYTICS_EVALUATION: "analytics-evaluation" as const,
  GOVERNANCE_COMPLIANCE: "governance-compliance" as const,
  RESOURCE_MANAGEMENT: "resource-management" as const,
  DEVELOPMENT_DEPLOYMENT: "development-deployment" as const,
  MEMORY_KNOWLEDGE: "memory-knowledge" as const,
  ADMIN_OPERATIONS: "admin-operations" as const
} as const;

export const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
  "chat-orchestration": "会話、エージェント調整、セッション管理、ユーザー相互作用",
  "analytics-evaluation": "分析、評価、メトリクス、QA テスト、パフォーマンス測定",
  "governance-compliance": "予算追跡、権限管理、ポリシー実行、セキュリティスキャン",
  "resource-management": "リソース検索、カタログ、作成・削除・キャンプ、構成管理",
  "development-deployment": "Apex コード分析、Flow、LWC、デプロイメント、テスト提案",
  "memory-knowledge": "メモリ管理、ベクトル検索、知識グラフ、埋め込み",
  "admin-operations": "テナント管理、オーケストレーション、提案キューイング、リソースライフサイクル"
};

const CATEGORY_TOPIC_HINTS: Record<ToolCategory, string[]> = {
  "chat-orchestration": ["chat", "conversation", "agent", "orchestrate", "session", "会話", "チャット", "エージェント"],
  "analytics-evaluation": ["metric", "evaluate", "analysis", "qa", "test", "coverage", "benchmark", "評価", "分析", "テスト"],
  "governance-compliance": ["governance", "budget", "policy", "security", "compliance", "permission", "audit", "予算", "権限", "監査", "セキュリティ"],
  "resource-management": ["resource", "catalog", "search", "create", "delete", "configure", "metadata", "リソース", "検索", "構成"],
  "development-deployment": ["apex", "lwc", "flow", "deploy", "build", "refactor", "integration", "development", "実装", "デプロイ", "リファクタ"],
  "memory-knowledge": ["memory", "vector", "knowledge", "embedding", "rag", "メモリ", "ベクトル", "知識"],
  "admin-operations": ["tenant", "orchestration", "proposal", "release", "operation", "admin", "運用", "オーケストレーション", "リリース"]
};

const CATEGORY_AGENT_HINTS: Record<ToolCategory, string[]> = {
  "chat-orchestration": ["ceo", "product-manager", "architect"],
  "analytics-evaluation": ["qa-engineer", "performance-engineer", "debug-specialist"],
  "governance-compliance": ["security-engineer", "release-manager", "devops-engineer"],
  "resource-management": ["repository-analyst", "architect", "documentation-writer"],
  "development-deployment": ["apex-developer", "lwc-developer", "integration-developer", "flow-specialist", "refactor-specialist"],
  "memory-knowledge": ["repository-analyst", "documentation-writer", "architect"],
  "admin-operations": ["release-manager", "devops-engineer", "product-manager"]
};

/**
 * ツール metadata
 */
export interface ToolMetadata {
  id: string;
  name: string;
  title: string;
  category: ToolCategory;
  description: string;
  keywords: string[];
  /** Relevance scoring hints (0-100) */
  relevanceHints?: string[];
}

/**
 * Tool categorizer registry
 */
export class ToolCategorizer {
  private metadata: Map<string, ToolMetadata> = new Map();

  constructor() {
    this.initializeDefaultCatalog();
  }

  /**
   * デフォルトツール カタログを初期化
   */
  private initializeDefaultCatalog(): void {
    const tools: ToolMetadata[] = [
      // ========== Chat & Orchestration (13 tools) ==========
      {
        id: "smart_chat",
        name: "smart_chat",
        title: "Smart Chat",
        category: "chat-orchestration",
        description: "Context-aware multi-agent chat with keyword routing",
        keywords: ["chat", "conversation", "agent", "orchestration", "routing"]
      },
      {
        id: "orchestrate_chat",
        name: "orchestrate_chat",
        title: "Orchestrate Chat",
        category: "chat-orchestration",
        description: "Multi-agent workflow orchestration",
        keywords: ["orchestration", "workflow", "sequential", "agent-handoff"]
      },
      {
        id: "simulate_chat",
        name: "simulate_chat",
        title: "Simulate Chat",
        category: "chat-orchestration",
        description: "Multi-turn chat simulation between agents",
        keywords: ["simulation", "testing", "multi-agent", "interaction"]
      },
      {
        id: "batch_chat",
        name: "batch_chat",
        title: "Batch Chat",
        category: "chat-orchestration",
        description: "Batch processing of multiple chat requests",
        keywords: ["batch", "bulk", "parallel", "efficiency"]
      },
      {
        id: "load_chat_history",
        name: "load_chat_history",
        title: "Load Chat History",
        category: "chat-orchestration",
        description: "Retrieve previous chat sessions",
        keywords: ["history", "session", "retrieval", "context"]
      },
      {
        id: "save_chat_history",
        name: "save_chat_history",
        title: "Save Chat History",
        category: "chat-orchestration",
        description: "Persist chat session for future reference",
        keywords: ["history", "persistence", "archival", "session"]
      },
      {
        id: "restore_chat_history",
        name: "restore_chat_history",
        title: "Restore Chat History",
        category: "chat-orchestration",
        description: "Recover saved chat sessions",
        keywords: ["recovery", "restoration", "history", "session"]
      },
      {
        id: "export_to_markdown",
        name: "export_to_markdown",
        title: "Export to Markdown",
        category: "chat-orchestration",
        description: "Export chat history as markdown document",
        keywords: ["export", "markdown", "documentation", "report"]
      },
      {
        id: "evaluate_triggers",
        name: "evaluate_triggers",
        title: "Evaluate Triggers",
        category: "chat-orchestration",
        description: "Evaluate agent-switching trigger rules",
        keywords: ["triggers", "rules", "escalation", "conditions"]
      },
      {
        id: "parse_and_record_chat",
        name: "parse_and_record_chat",
        title: "Parse and Record Chat",
        category: "chat-orchestration",
        description: "Parse formatted chat output and persist to memory",
        keywords: ["parsing", "recording", "memory", "persistence"]
      },
      {
        id: "dequeue_next_agent",
        name: "dequeue_next_agent",
        title: "Dequeue Next Agent",
        category: "chat-orchestration",
        description: "Get next queued agent in orchestration session",
        keywords: ["queue", "session", "orchestration", "workflow"]
      },
      {
        id: "save_orchestration_session",
        name: "save_orchestration_session",
        title: "Save Orchestration Session",
        category: "chat-orchestration",
        description: "Persist orchestration session state",
        keywords: ["orchestration", "session", "state", "persistence"]
      },
      {
        id: "restore_orchestration_session",
        name: "restore_orchestration_session",
        title: "Restore Orchestration Session",
        category: "chat-orchestration",
        description: "Restore saved orchestration session",
        keywords: ["orchestration", "session", "recovery", "state"]
      },

      // ========== Analytics & Evaluation (16 tools) ==========
      {
        id: "estimate_prompt_cost",
        name: "estimate_prompt_cost",
        title: "Estimate Prompt Cost",
        category: "analytics-evaluation",
        description: "Calculate estimated token cost for prompts",
        keywords: ["cost", "tokens", "pricing", "estimation", "economics"]
      },
      {
        id: "evaluate_cost_sla",
        name: "evaluate_cost_sla",
        title: "Evaluate Cost SLA",
        category: "analytics-evaluation",
        description: "Verify cost budgets meet SLA targets",
        keywords: ["budget", "SLA", "cost", "compliance", "monitoring"]
      },
      {
        id: "evaluate_prompt_metrics",
        name: "evaluate_prompt_metrics",
        title: "Evaluate Prompt Metrics",
        category: "analytics-evaluation",
        description: "Analyze prompt quality metrics",
        keywords: ["metrics", "quality", "analysis", "evaluation"]
      },
      {
        id: "analyze_ab_test_history",
        name: "analyze_ab_test_history",
        title: "Analyze A/B Test History",
        category: "analytics-evaluation",
        description: "Analyze historical A/B test results",
        keywords: ["testing", "ab-test", "analysis", "comparison"]
      },
      {
        id: "agent_ab_test",
        name: "agent_ab_test",
        title: "Agent A/B Test",
        category: "analytics-evaluation",
        description: "Compare agent outputs via A/B testing",
        keywords: ["testing", "comparison", "agents", "evaluation"]
      },
      {
        id: "analyze_chat_trends",
        name: "analyze_chat_trends",
        title: "Analyze Chat Trends",
        category: "analytics-evaluation",
        description: "Identify patterns in chat interactions",
        keywords: ["trends", "patterns", "analysis", "statistics"]
      },
      {
        id: "analyze_test_coverage_gap",
        name: "analyze_test_coverage_gap",
        title: "Analyze Test Coverage Gap",
        category: "analytics-evaluation",
        description: "Identify missing test cases",
        keywords: ["testing", "coverage", "gaps", "quality"]
      },
      {
        id: "metrics_summary",
        name: "metrics_summary",
        title: "Metrics Summary",
        category: "analytics-evaluation",
        description: "Generate summary of key metrics",
        keywords: ["metrics", "summary", "dashboard", "monitoring"]
      },
      {
        id: "get_prometheus_metrics",
        name: "get_prometheus_metrics",
        title: "Get Prometheus Metrics",
        category: "analytics-evaluation",
        description: "Retrieve Prometheus observability metrics",
        keywords: ["metrics", "prometheus", "observability", "monitoring"]
      },
      {
        id: "drill_down_dashboard",
        name: "drill_down_dashboard",
        title: "Drill Down Dashboard",
        category: "analytics-evaluation",
        description: "Interactive drill-down analysis dashboard",
        keywords: ["dashboard", "analytics", "drill-down", "visualization"]
      },
      {
        id: "get_handlers_dashboard",
        name: "get_handlers_dashboard",
        title: "Get Handlers Dashboard",
        category: "analytics-evaluation",
        description: "Dashboard for event handler performance",
        keywords: ["dashboard", "handlers", "monitoring", "performance"]
      },
      {
        id: "get_tool_progress",
        name: "get_tool_progress",
        title: "Get Tool Progress",
        category: "analytics-evaluation",
        description: "Track tool execution progress",
        keywords: ["progress", "monitoring", "execution", "tracking"]
      },
      {
        id: "get_feedback_metrics",
        name: "get_feedback_metrics",
        title: "Get Feedback Metrics",
        category: "analytics-evaluation",
        description: "Aggregate user feedback statistics",
        keywords: ["feedback", "metrics", "user", "satisfaction"]
      },
      {
        id: "record_user_feedback",
        name: "record_user_feedback",
        title: "Record User Feedback",
        category: "analytics-evaluation",
        description: "Log user satisfaction ratings",
        keywords: ["feedback", "recording", "user", "satisfaction"]
      },
      {
        id: "benchmark_suite",
        name: "benchmark_suite",
        title: "Benchmark Suite",
        category: "analytics-evaluation",
        description: "Run performance benchmark suite",
        keywords: ["benchmark", "performance", "testing", "comparison"]
      },
      {
        id: "get_tool_execution_statistics",
        name: "get_tool_execution_statistics",
        title: "Get Tool Execution Statistics",
        category: "analytics-evaluation",
        description: "Tool execution performance statistics",
        keywords: ["statistics", "performance", "execution", "tools"]
      },

      // ========== Governance & Compliance (18 tools) ==========
      {
        id: "evaluate_quality_rubric",
        name: "evaluate_quality_rubric",
        title: "Evaluate Quality Rubric",
        category: "governance-compliance",
        description: "Assess work against quality standards",
        keywords: ["quality", "rubric", "standards", "evaluation"]
      },
      {
        id: "record_resource_signal",
        name: "record_resource_signal",
        title: "Record Resource Signal",
        category: "governance-compliance",
        description: "Track resource utilization signals",
        keywords: ["monitoring", "signals", "resource", "tracking"]
      },
      {
        id: "scan_security_rules",
        name: "scan_security_rules",
        title: "Scan Security Rules",
        category: "governance-compliance",
        description: "Identify security policy violations",
        keywords: ["security", "scanning", "compliance", "violations"]
      },
      {
        id: "security_delta_scan",
        name: "security_delta_scan",
        title: "Security Delta Scan",
        category: "governance-compliance",
        description: "Scan changes for security risks",
        keywords: ["security", "delta", "changes", "scanning"]
      },
      {
        id: "compare_permission_sets",
        name: "compare_permission_sets",
        title: "Compare Permission Sets",
        category: "governance-compliance",
        description: "Compare user permission configurations",
        keywords: ["permissions", "comparison", "users", "rbac"]
      },
      {
        id: "permission_set_analyze",
        name: "permission_set_analyze",
        title: "Permission Set Analysis",
        category: "governance-compliance",
        description: "Analyze permission set assignments",
        keywords: ["permissions", "analysis", "rbac", "users"]
      },
      {
        id: "permission_set_diff",
        name: "permission_set_diff",
        title: "Permission Set Diff",
        category: "governance-compliance",
        description: "Show permission set differences",
        keywords: ["permissions", "diff", "comparison", "rbac"]
      },
      {
        id: "recommend_permission_sets",
        name: "recommend_permission_sets",
        title: "Recommend Permission Sets",
        category: "governance-compliance",
        description: "Suggest minimal permission sets based on usage",
        keywords: ["permissions", "recommendation", "rbac", "least-privilege"]
      },
      {
        id: "update_resource_lifecycle",
        name: "update_resource_lifecycle",
        title: "Update Resource Lifecycle",
        category: "governance-compliance",
        description: "Manage resource lifecycle states",
        keywords: ["lifecycle", "resource", "status", "management"]
      },
      {
        id: "list_resource_lifecycle",
        name: "list_resource_lifecycle",
        title: "List Resource Lifecycle",
        category: "governance-compliance",
        description: "View resource lifecycle inventory",
        keywords: ["lifecycle", "inventory", "resource", "status"]
      },
      {
        id: "get_resource_governance",
        name: "get_resource_governance",
        title: "Get Resource Governance",
        category: "governance-compliance",
        description: "Query resource governance policies",
        keywords: ["governance", "policies", "resource", "compliance"]
      },
      {
        id: "review_resource_governance",
        name: "review_resource_governance",
        title: "Review Resource Governance",
        category: "governance-compliance",
        description: "Review and audit governance decisions",
        keywords: ["governance", "audit", "review", "policies"]
      },
      {
        id: "simulate_governance_change",
        name: "simulate_governance_change",
        title: "Simulate Governance Change",
        category: "governance-compliance",
        description: "Preview impact of governance changes",
        keywords: ["governance", "simulation", "impact", "planning"]
      },
      {
        id: "render_governance_ui",
        name: "render_governance_ui",
        title: "Render Governance UI",
        category: "governance-compliance",
        description: "Generate governance dashboard visualization",
        keywords: ["governance", "ui", "dashboard", "visualization"]
      },
      {
        id: "record_failure",
        name: "record_failure",
        title: "Record Failure",
        category: "governance-compliance",
        description: "Log compliance or quality failures",
        keywords: ["failure", "logging", "compliance", "tracking"]
      },
      {
        id: "search_failures",
        name: "search_failures",
        title: "Search Failures",
        category: "governance-compliance",
        description: "Query failure logs",
        keywords: ["failure", "search", "query", "logging"]
      },
      {
        id: "list_failures",
        name: "list_failures",
        title: "List Failures",
        category: "governance-compliance",
        description: "View failure history",
        keywords: ["failure", "history", "listing", "review"]
      },
      {
        id: "apply_resource_actions",
        name: "apply_resource_actions",
        title: "Apply Resource Actions",
        category: "governance-compliance",
        description: "Execute resource policy actions",
        keywords: ["actions", "execution", "policies", "resource"]
      },

      // ========== Resource Management (15 tools) ==========
      {
        id: "search_resources",
        name: "search_resources",
        title: "Search Resources",
        category: "resource-management",
        description: "Search for skills, agents, tools, presets",
        keywords: ["search", "discovery", "catalog", "resource"]
      },
      {
        id: "resource_dependency_graph",
        name: "resource_dependency_graph",
        title: "Resource Dependency Graph",
        category: "resource-management",
        description: "Visualize resource dependencies",
        keywords: ["dependencies", "graph", "relationships", "mapping"]
      },
      {
        id: "simulate_dependency_impact",
        name: "simulate_dependency_impact",
        title: "Simulate Dependency Impact",
        category: "resource-management",
        description: "Forecast impact of resource changes",
        keywords: ["dependencies", "impact", "simulation", "planning"]
      },
      {
        id: "suggest_cleanup_resources",
        name: "suggest_cleanup_resources",
        title: "Suggest Cleanup Resources",
        category: "resource-management",
        description: "Identify unused resources for removal",
        keywords: ["cleanup", "unused", "removal", "optimization"]
      },
      {
        id: "auto_select_resources",
        name: "auto_select_resources",
        title: "Auto Select Resources",
        category: "resource-management",
        description: "Automatically select optimal resources",
        keywords: ["selection", "optimization", "automatic", "recommendation"]
      },
      {
        id: "synergy_recommend_combo",
        name: "synergy_recommend_combo",
        title: "Synergy Recommend Combo",
        category: "resource-management",
        description: "Recommend resource combinations",
        keywords: ["recommendation", "synergy", "combination", "optimization"]
      },
      {
        id: "get_skill",
        name: "get_skill",
        title: "Get Skill",
        category: "resource-management",
        description: "Retrieve skill definition",
        keywords: ["skill", "retrieval", "definition", "resource"]
      },
      {
        id: "list_skills",
        name: "list_skills",
        title: "List Skills",
        category: "resource-management",
        description: "Browse available skills",
        keywords: ["skills", "listing", "catalog", "browse"]
      },
      {
        id: "get_agent",
        name: "get_agent",
        title: "Get Agent",
        category: "resource-management",
        description: "Retrieve agent configuration",
        keywords: ["agent", "retrieval", "definition", "resource"]
      },
      {
        id: "list_agents",
        name: "list_agents",
        title: "List Agents",
        category: "resource-management",
        description: "Browse available agents",
        keywords: ["agents", "listing", "catalog", "browse"]
      },
      {
        id: "list_personas",
        name: "list_personas",
        title: "List Personas",
        category: "resource-management",
        description: "Browse user personas",
        keywords: ["personas", "listing", "users", "roles"]
      },
      {
        id: "get_context",
        name: "get_context",
        title: "Get Context",
        category: "resource-management",
        description: "Retrieve contextual information",
        keywords: ["context", "retrieval", "information", "project"]
      },
      {
        id: "record_reasoning_step",
        name: "record_reasoning_step",
        title: "Record Reasoning Step",
        category: "resource-management",
        description: "Log reasoning decisions",
        keywords: ["reasoning", "logging", "decision", "tracing"]
      },
      {
        id: "recommend_first_steps",
        name: "recommend_first_steps",
        title: "Recommend First Steps",
        category: "resource-management",
        description: "Suggest initial steps for tasks",
        keywords: ["recommendation", "guidance", "initialization", "planning"]
      },
      {
        id: "compare_org_metadata",
        name: "compare_org_metadata",
        title: "Compare Org Metadata",
        category: "resource-management",
        description: "Compare metadata across Salesforce orgs",
        keywords: ["metadata", "comparison", "org", "deployment"]
      },

      // ========== Development & Deployment (19 tools) ==========
      {
        id: "apex_analyze",
        name: "apex_analyze",
        title: "Apex Analyze",
        category: "development-deployment",
        description: "Analyze Apex code quality",
        keywords: ["apex", "analysis", "code", "quality"]
      },
      {
        id: "apex_compliance_report",
        name: "apex_compliance_report",
        title: "Apex Compliance Report",
        category: "development-deployment",
        description: "Generate Apex compliance report",
        keywords: ["apex", "compliance", "report", "standards"]
      },
      {
        id: "apex_changelog",
        name: "apex_changelog",
        title: "Apex Changelog",
        category: "development-deployment",
        description: "Track Apex changes",
        keywords: ["apex", "changelog", "history", "tracking"]
      },
      {
        id: "apex_dependency_graph",
        name: "apex_dependency_graph",
        title: "Apex Dependency Graph",
        category: "development-deployment",
        description: "Visualize Apex code dependencies",
        keywords: ["apex", "dependencies", "graph", "analysis"]
      },
      {
        id: "apex_dependency_graph_incremental",
        name: "apex_dependency_graph_incremental",
        title: "Apex Dependency Graph Incremental",
        category: "development-deployment",
        description: "Incremental Apex dependency analysis",
        keywords: ["apex", "dependencies", "incremental", "analysis"]
      },
      {
        id: "predict_apex_performance",
        name: "predict_apex_performance",
        title: "Predict Apex Performance",
        category: "development-deployment",
        description: "Forecast Apex execution performance",
        keywords: ["apex", "performance", "prediction", "optimization"]
      },
      {
        id: "flow_analyze",
        name: "flow_analyze",
        title: "Flow Analyze",
        category: "development-deployment",
        description: "Analyze Salesforce Flow definitions",
        keywords: ["flow", "analysis", "automation", "quality"]
      },
      {
        id: "flow_condition_simulate",
        name: "flow_condition_simulate",
        title: "Flow Condition Simulate",
        category: "development-deployment",
        description: "Test Flow condition logic",
        keywords: ["flow", "simulation", "testing", "conditions"]
      },
      {
        id: "suggest_flow_test_cases",
        name: "suggest_flow_test_cases",
        title: "Suggest Flow Test Cases",
        category: "development-deployment",
        description: "Generate Flow test case suggestions",
        keywords: ["flow", "testing", "suggestions", "cases"]
      },
      {
        id: "lwc_analyze",
        name: "lwc_analyze",
        title: "LWC Analyze",
        category: "development-deployment",
        description: "Analyze Lightning Web Component code",
        keywords: ["lwc", "analysis", "code", "quality"]
      },
      {
        id: "refactor_suggest",
        name: "refactor_suggest",
        title: "Refactor Suggest",
        category: "development-deployment",
        description: "Suggest code refactoring improvements",
        keywords: ["refactoring", "suggestions", "code", "improvement"]
      },
      {
        id: "repo_analyze",
        name: "repo_analyze",
        title: "Repo Analyze",
        category: "development-deployment",
        description: "Analyze repository structure and health",
        keywords: ["repository", "analysis", "health", "structure"]
      },
      {
        id: "changed_tests_suggest",
        name: "changed_tests_suggest",
        title: "Changed Tests Suggest",
        category: "development-deployment",
        description: "Recommend tests for changed code",
        keywords: ["testing", "suggestion", "changes", "coverage"]
      },
      {
        id: "coverage_estimate",
        name: "coverage_estimate",
        title: "Coverage Estimate",
        category: "development-deployment",
        description: "Estimate code coverage impact",
        keywords: ["coverage", "testing", "estimation", "metrics"]
      },
      {
        id: "run_tests",
        name: "run_tests",
        title: "Run Tests",
        category: "development-deployment",
        description: "Execute test suites",
        keywords: ["testing", "execution", "quality", "validation"]
      },
      {
        id: "pr_readiness_check",
        name: "pr_readiness_check",
        title: "PR Readiness Check",
        category: "development-deployment",
        description: "Validate pull request readiness",
        keywords: ["pr", "readiness", "validation", "deployment"]
      },
      {
        id: "deployment_plan_generate",
        name: "deployment_plan_generate",
        title: "Deployment Plan Generate",
        category: "development-deployment",
        description: "Generate deployment plan",
        keywords: ["deployment", "planning", "execution", "coordination"]
      },
      {
        id: "deployment_impact_summary",
        name: "deployment_impact_summary",
        title: "Deployment Impact Summary",
        category: "development-deployment",
        description: "Summarize deployment impact",
        keywords: ["deployment", "impact", "analysis", "summary"]
      },
      {
        id: "run_deployment_verification",
        name: "run_deployment_verification",
        title: "Run Deployment Verification",
        category: "development-deployment",
        description: "Verify successful deployment",
        keywords: ["deployment", "verification", "validation", "monitoring"]
      },

      // ========== Memory & Knowledge (12 tools) ==========
      {
        id: "search_vector",
        name: "search_vector",
        title: "Search Vector",
        category: "memory-knowledge",
        description: "Semantic vector search in knowledge base",
        keywords: ["search", "vector", "semantic", "knowledge"]
      },
      {
        id: "search_memory",
        name: "search_memory",
        title: "Search Memory",
        category: "memory-knowledge",
        description: "Search memory storage",
        keywords: ["search", "memory", "knowledge", "retrieval"]
      },
      {
        id: "add_memory",
        name: "add_memory",
        title: "Add Memory",
        category: "memory-knowledge",
        description: "Record information to memory",
        keywords: ["memory", "storage", "persistence", "recording"]
      },
      {
        id: "clear_memory",
        name: "clear_memory",
        title: "Clear Memory",
        category: "memory-knowledge",
        description: "Clear memory storage",
        keywords: ["memory", "clearing", "cleanup", "reset"]
      },
      {
        id: "list_memory",
        name: "list_memory",
        title: "List Memory",
        category: "memory-knowledge",
        description: "Browse memory contents",
        keywords: ["memory", "listing", "browsing", "retrieval"]
      },
      {
        id: "add_vector_record",
        name: "add_vector_record",
        title: "Add Vector Record",
        category: "memory-knowledge",
        description: "Add vector embedding to store",
        keywords: ["vector", "embedding", "storage", "knowledge"]
      },
      {
        id: "metadata_dependency_graph",
        name: "metadata_dependency_graph",
        title: "Metadata Dependency Graph",
        category: "memory-knowledge",
        description: "Visualize metadata dependencies",
        keywords: ["metadata", "dependencies", "graph", "knowledge"]
      },
      {
        id: "simulate_dependency_impact",
        name: "simulate_dependency_impact_alt",
        title: "Simulate Dependency Impact (Alt)",
        category: "memory-knowledge",
        description: "Analyze dependency change impacts",
        keywords: ["dependencies", "impact", "analysis", "knowledge"]
      },
      {
        id: "get_agent_log",
        name: "get_agent_log",
        title: "Get Agent Log",
        category: "memory-knowledge",
        description: "Retrieve agent execution logs",
        keywords: ["logs", "agent", "history", "retrieval"]
      },
      {
        id: "get_system_events",
        name: "get_system_events",
        title: "Get System Events",
        category: "memory-knowledge",
        description: "Query system event logs",
        keywords: ["events", "logs", "system", "monitoring"]
      },
      {
        id: "get_agent_reputation",
        name: "get_agent_reputation",
        title: "Get Agent Reputation",
        category: "memory-knowledge",
        description: "Retrieve agent reputation scores",
        keywords: ["reputation", "scores", "agent", "performance"]
      },
      {
        id: "update_agent_reputation",
        name: "update_agent_reputation",
        title: "Update Agent Reputation",
        category: "memory-knowledge",
        description: "Update agent reputation metrics",
        keywords: ["reputation", "update", "agent", "scoring"]
      },

      // ========== Admin & Operations (17 tools) ==========
      {
        id: "create_preset",
        name: "create_preset",
        title: "Create Preset",
        category: "admin-operations",
        description: "Create reusable chat preset",
        keywords: ["preset", "creation", "configuration", "template"]
      },
      {
        id: "list_presets",
        name: "list_presets",
        title: "List Presets",
        category: "admin-operations",
        description: "Browse available presets",
        keywords: ["preset", "listing", "catalog", "templates"]
      },
      {
        id: "run_preset",
        name: "run_preset",
        title: "Run Preset",
        category: "admin-operations",
        description: "Execute preset workflow",
        keywords: ["preset", "execution", "workflow", "automation"]
      },
      {
        id: "enqueue_proposal",
        name: "enqueue_proposal",
        title: "Enqueue Proposal",
        category: "admin-operations",
        description: "Queue proposal for approval",
        keywords: ["proposal", "queue", "approval", "workflow"]
      },
      {
        id: "approve_proposal",
        name: "approve_proposal",
        title: "Approve Proposal",
        category: "admin-operations",
        description: "Approve pending proposal",
        keywords: ["proposal", "approval", "decision", "workflow"]
      },
      {
        id: "reject_proposal",
        name: "reject_proposal",
        title: "Reject Proposal",
        category: "admin-operations",
        description: "Reject pending proposal",
        keywords: ["proposal", "rejection", "decision", "workflow"]
      },
      {
        id: "get_proposal",
        name: "get_proposal",
        title: "Get Proposal",
        category: "admin-operations",
        description: "Retrieve proposal details",
        keywords: ["proposal", "retrieval", "information", "query"]
      },
      {
        id: "list_proposals",
        name: "list_proposals",
        title: "List Proposals",
        category: "admin-operations",
        description: "Browse pending proposals",
        keywords: ["proposal", "listing", "queue", "workflow"]
      },
      {
        id: "auto_apply_pending_proposals",
        name: "auto_apply_pending_proposals",
        title: "Auto Apply Pending Proposals",
        category: "admin-operations",
        description: "Auto-apply qualifying proposals",
        keywords: ["proposal", "automation", "workflow", "execution"]
      },
      {
        id: "register_org",
        name: "register_org",
        title: "Register Org",
        category: "admin-operations",
        description: "Register Salesforce organization",
        keywords: ["org", "registration", "setup", "administration"]
      },
      {
        id: "list_orgs",
        name: "list_orgs",
        title: "List Orgs",
        category: "admin-operations",
        description: "Browse registered orgs",
        keywords: ["org", "listing", "catalog", "administration"]
      },
      {
        id: "get_org",
        name: "get_org",
        title: "Get Org",
        category: "admin-operations",
        description: "Retrieve org configuration",
        keywords: ["org", "retrieval", "configuration", "details"]
      },
      {
        id: "remove_org",
        name: "remove_org",
        title: "Remove Org",
        category: "admin-operations",
        description: "Unregister organization",
        keywords: ["org", "removal", "cleanup", "administration"]
      },
      {
        id: "deploy_org",
        name: "deploy_org",
        title: "Deploy Org",
        category: "admin-operations",
        description: "Deploy changes to organization",
        keywords: ["deploy", "org", "execution", "coordination"]
      },
      {
        id: "get_org_timeline",
        name: "get_org_timeline",
        title: "Get Org Timeline",
        category: "admin-operations",
        description: "View organization event timeline",
        keywords: ["timeline", "org", "events", "history"]
      },
      {
        id: "record_org_event",
        name: "record_org_event",
        title: "Record Org Event",
        category: "admin-operations",
        description: "Log organization event",
        keywords: ["event", "logging", "org", "tracking"]
      },
      {
        id: "get_orchestration_session",
        name: "get_orchestration_session",
        title: "Get Orchestration Session",
        category: "admin-operations",
        description: "Retrieve orchestration session details",
        keywords: ["orchestration", "session", "retrieval", "workflow"]
      }
    ];

    for (const tool of tools) {
      this.metadata.set(tool.id, tool);
    }
  }

  /**
   * ツールを ID で取得
   */
  getTool(id: string): ToolMetadata | undefined {
    return this.metadata.get(id);
  }

  /**
   * カテゴリー別ツール一覧を取得
   */
  getToolsByCategory(category: ToolCategory): ToolMetadata[] {
    return Array.from(this.metadata.values()).filter(t => t.category === category);
  }

  /**
   * 全カテゴリーの統計
   */
  getCategoryStats(): Record<ToolCategory, number> {
    const stats: Record<ToolCategory, number> = {
      "chat-orchestration": 0,
      "analytics-evaluation": 0,
      "governance-compliance": 0,
      "resource-management": 0,
      "development-deployment": 0,
      "memory-knowledge": 0,
      "admin-operations": 0
    };

    for (const tool of this.metadata.values()) {
      stats[tool.category]++;
    }

    return stats;
  }

  /**
   * キーワード検索でツールを絞り込み
   */
  searchToolsByKeyword(keyword: string): ToolMetadata[] {
    const lower = keyword.toLowerCase();
    return Array.from(this.metadata.values()).filter(tool =>
      tool.name.toLowerCase().includes(lower) ||
      tool.title.toLowerCase().includes(lower) ||
      tool.description.toLowerCase().includes(lower) ||
      tool.keywords.some(k => k.toLowerCase().includes(lower))
    );
  }

  /**
   * Domain relevance に基づいてツールをソート
   */
  rankToolsByDomainRelevance(tools: ToolMetadata[], domain: string): ToolMetadata[] {
    const domainLower = domain.toLowerCase();

    return tools.sort((a, b) => {
      // Domain キーワード一致度をスコア化
      const aScore = this.calculateDomainRelevance(a, domainLower);
      const bScore = this.calculateDomainRelevance(b, domainLower);
      return bScore - aScore;
    });
  }

  /**
   * Domain relevance スコア計算
   */
  private calculateDomainRelevance(tool: ToolMetadata, domain: string): number {
    let score = 0;

    // 完全一致
    if (tool.name.toLowerCase() === domain) score += 100;

    // パーシャルマッチ
    if (tool.name.toLowerCase().includes(domain)) score += 50;
    if (tool.title.toLowerCase().includes(domain)) score += 30;
    if (tool.description.toLowerCase().includes(domain)) score += 20;

    // キーワード一致
    for (const keyword of tool.keywords) {
      if (keyword.toLowerCase().includes(domain)) score += 10;
    }

    return score;
  }

  /**
   * 全ツール数を取得
   */
  getTotalToolCount(): number {
    return this.metadata.size;
  }

  /**
   * 全ツール ID リストを取得
   */
  getAllToolIds(): string[] {
    return Array.from(this.metadata.keys());
  }

  /**
   * Custom tool を登録
   */
  registerTool(tool: ToolMetadata): void {
    this.metadata.set(tool.id, tool);
  }
}

export function inferToolCategoryFromTopic(topic: string): ToolCategory | null {
  const normalized = topic.toLowerCase();
  let bestCategory: ToolCategory | null = null;
  let bestScore = 0;

  for (const [category, hints] of Object.entries(CATEGORY_TOPIC_HINTS) as Array<[ToolCategory, string[]]>) {
    let score = 0;
    for (const hint of hints) {
      const normalizedHint = hint.toLowerCase();
      if (normalized.includes(normalizedHint)) {
        score += 2;
      }
      if (normalizedHint.split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/).some((token) => token && normalized.includes(token))) {
        score += 1;
      }
    }
    if (score > bestScore) {
      bestCategory = category;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestCategory : null;
}

export function recommendAgentsForToolCategory(category: ToolCategory | null): string[] {
  if (!category) return [];
  return CATEGORY_AGENT_HINTS[category] ?? [];
}

/**
 * グローバル tool categorizer インスタンス
 */
let globalCategorizer: ToolCategorizer | null = null;

/**
 * グローバル tool categorizer を取得
 */
export function getGlobalToolCategorizer(): ToolCategorizer {
  if (!globalCategorizer) {
    globalCategorizer = new ToolCategorizer();
  }
  return globalCategorizer;
}

/**
 * テスト用: tool categorizer をリセット
 */
export function _resetToolCategorizerForTest(): void {
  globalCategorizer = null;
}
