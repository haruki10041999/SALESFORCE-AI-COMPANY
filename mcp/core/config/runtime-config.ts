import { parseBooleanEnv } from "./env-flags.js";
import { parsePositiveIntOrFallback } from "./numeric-parsing.js";

export function getOutputsDir(defaultDir = "outputs"): string {
  const configured = process.env.SF_AI_OUTPUTS_DIR?.trim();
  return configured && configured.length > 0 ? configured : defaultDir;
}

export function getPrimaryDatabaseUrl(): string | undefined {
  const primary = process.env.SF_AI_DB_URL_PRIMARY?.trim();
  if (primary && primary.length > 0) {
    return primary;
  }
  const fallback = process.env.DATABASE_URL?.trim();
  return fallback && fallback.length > 0 ? fallback : undefined;
}

export function getEventBusBackend(defaultBackend = "in-memory"): string {
  const backend = process.env.SF_AI_EVENT_BUS_BACKEND?.trim().toLowerCase();
  return backend && backend.length > 0 ? backend : defaultBackend;
}

export function getEventBusRedisUrl(): string | undefined {
  const configured = process.env.SF_AI_EVENT_BUS_REDIS_URL?.trim() ?? process.env.REDIS_URL?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getEventBusStreamKey(defaultKey = "sfai_event_bus_stream"): string {
  const configured = process.env.SF_AI_EVENT_BUS_STREAM_KEY?.trim();
  return configured && configured.length > 0 ? configured : defaultKey;
}

export function getStateBackendEnv(): string | undefined {
  const backend = process.env.SF_AI_STATE_BACKEND?.trim();
  return backend && backend.length > 0 ? backend : undefined;
}

export function getEventHistoryMax(): number {
  return parsePositiveIntOrFallback(process.env.EVENT_HISTORY_MAX, 1000);
}

export function getOutputsBackupKeep(): number {
  return parsePositiveIntOrFallback(process.env.SF_AI_OUTPUTS_BACKUP_KEEP, 5);
}

export function getAuditColdStorageTarget(): string {
  return process.env.SF_AI_AUDIT_COLD_STORAGE ?? "s3://audit-cold-storage/";
}

export function getAuditColdStorageEnabled(): boolean {
  return parseBooleanEnv(process.env.SF_AI_AUDIT_COLD_STORAGE_ENABLED, false);
}

export function getPrimaryModel(defaultModel = "mistral"): string {
  const configured = process.env.SF_AI_PRIMARY_MODEL?.trim();
  return configured && configured.length > 0 ? configured : defaultModel;
}

export function getLlmClientMode(defaultMode = "native"): string {
  const configured = process.env.SF_AI_LLM_CLIENT?.trim().toLowerCase();
  return configured && configured.length > 0 ? configured : defaultMode;
}

export function getVectorBackend(defaultBackend = "tfidf"): string {
  const configured = process.env.SF_AI_VECTOR_BACKEND?.trim().toLowerCase();
  return configured && configured.length > 0 ? configured : defaultBackend;
}

export function getWorkflowEngineMode(
  defaultMode: "in-process" | "temporal" = "in-process",
  env: NodeJS.ProcessEnv = process.env
): "in-process" | "temporal" {
  const configured = env.SF_AI_WORKFLOW_ENGINE?.trim().toLowerCase();
  if (configured === "temporal") {
    return "temporal";
  }
  if (configured === "in-process") {
    return "in-process";
  }
  return defaultMode;
}

export function getTemporalAddress(
  defaultAddress = "localhost:7233",
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = env.SF_AI_TEMPORAL_ADDRESS?.trim();
  return configured && configured.length > 0 ? configured : defaultAddress;
}

export function getTemporalNamespace(
  defaultNamespace = "default",
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = env.SF_AI_TEMPORAL_NAMESPACE?.trim();
  return configured && configured.length > 0 ? configured : defaultNamespace;
}

export function getTemporalTaskQueue(
  defaultTaskQueue = "sfai-orchestration",
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = env.SF_AI_TEMPORAL_TASK_QUEUE?.trim();
  return configured && configured.length > 0 ? configured : defaultTaskQueue;
}

export function getTemporalRunWorkerEnabled(
  defaultEnabled = false,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return parseBooleanEnv(env.SF_AI_TEMPORAL_RUN_WORKER, defaultEnabled);
}

export function getTemporalWorkflowRetryMaximumAttempts(
  defaultAttempts = 1,
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveIntOrFallback(env.SF_AI_TEMPORAL_WORKFLOW_RETRY_MAX_ATTEMPTS, defaultAttempts);
}

export function getTemporalActivityTimeoutSeconds(
  defaultSeconds = 60,
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveIntOrFallback(env.SF_AI_TEMPORAL_ACTIVITY_TIMEOUT_SECONDS, defaultSeconds);
}

export function getTemporalActivityRetryMaximumAttempts(
  defaultAttempts = 3,
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveIntOrFallback(env.SF_AI_TEMPORAL_ACTIVITY_RETRY_MAX_ATTEMPTS, defaultAttempts);
}

export function getTemporalActivityRetryInitialIntervalMs(
  defaultMs = 1000,
  env: NodeJS.ProcessEnv = process.env
): number {
  return parsePositiveIntOrFallback(env.SF_AI_TEMPORAL_ACTIVITY_RETRY_INITIAL_INTERVAL_MS, defaultMs);
}

export function getTemporalActivityRetryBackoffCoefficient(
  defaultCoefficient = 2,
  env: NodeJS.ProcessEnv = process.env
): number {
  const parsed = Number.parseFloat(env.SF_AI_TEMPORAL_ACTIVITY_RETRY_BACKOFF_COEFFICIENT ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultCoefficient;
}

export function getOllamaBaseUrl(): string | undefined {
  const configured = process.env.OLLAMA_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getLangChainEmbeddingModel(defaultModel = "nomic-embed-text"): string {
  const configured = process.env.SF_AI_LANGCHAIN_EMBEDDING_MODEL?.trim();
  return configured && configured.length > 0 ? configured : defaultModel;
}

export function getReplayMode(defaultMode = "passthrough"): string {
  const configured = process.env.SF_AI_REPLAY_MODE?.trim();
  return configured && configured.length > 0 ? configured : defaultMode;
}

export function getRoleFromRuntimeEnv(): string | undefined {
  const configured = process.env.SF_AI_ROLE?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getTraceHistoryMax(): number {
  return parsePositiveIntOrFallback(process.env.TRACE_HISTORY_MAX, 500);
}

export function getTraceFilePath(defaultPath: string): string {
  const configured = process.env.SF_AI_TRACE_FILE?.trim();
  return configured && configured.length > 0 ? configured : defaultPath;
}

export function getContextBudgetFilePath(): string | undefined {
  const configured = process.env.SF_AI_CONTEXT_BUDGET_FILE?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getPromptCacheFilePathFromEnv(): string | undefined {
  const configured = process.env.PROMPT_CACHE_FILE?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getLocaleFromEnv(): string | undefined {
  const configured = process.env.SF_AI_LOCALE?.trim().toLowerCase();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getLogLevelFromEnv(): string | undefined {
  const configured = process.env.LOG_LEVEL?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getOutputsBackendName(defaultBackend = "fs"): string {
  const backend = (process.env.OUTPUTS_BACKEND ?? process.env.SF_AI_OUTPUTS_BACKEND ?? defaultBackend)
    .trim()
    .toLowerCase();
  return backend.length > 0 ? backend : defaultBackend;
}

export function getOutputsS3BaseUrl(): string | undefined {
  const configured = process.env.SF_AI_OUTPUTS_S3_BASE_URL?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getOutputsS3AuthHeader(): string | undefined {
  const configured = process.env.SF_AI_OUTPUTS_S3_AUTH_HEADER?.trim();
  return configured && configured.length > 0 ? configured : undefined;
}

export function getLangSmithEnabled(): boolean {
  return parseBooleanEnv(process.env.SF_AI_LANGSMITH_ENABLED, false);
}

export function setLangchainTracingV2Enabled(enabled: boolean): void {
  process.env.LANGCHAIN_TRACING_V2 = enabled ? "true" : "false";
}

export function getOtelEnabled(): boolean {
  return parseBooleanEnv(process.env.OTEL_ENABLED, false);
}

export function getOtelExporterEndpoint(defaultEndpoint = "http://localhost:4318"): string {
  const configured = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  return configured && configured.length > 0 ? configured : defaultEndpoint;
}

export function getOtelServiceName(defaultServiceName = "salesforce-ai-company"): string {
  const configured = process.env.OTEL_SERVICE_NAME?.trim();
  return configured && configured.length > 0 ? configured : defaultServiceName;
}

export function getOtelTraceSampleRatio(defaultRatio = 0.1): number {
  const parsed = Number.parseFloat(process.env.OTEL_TRACES_SAMPLER_RATIO ?? "");
  if (!Number.isFinite(parsed)) {
    return defaultRatio;
  }
  if (parsed < 0 || parsed > 1) {
    return defaultRatio;
  }
  return parsed;
}

export function getOtelPiiRedactionEnabled(defaultEnabled = true): boolean {
  return parseBooleanEnv(process.env.OTEL_PII_REDACTION_ENABLED, defaultEnabled);
}

export function getOtelPiiHashSeed(): string | undefined {
  const seed = process.env.OTEL_PII_HASH_SEED?.trim();
  return seed && seed.length > 0 ? seed : undefined;
}

export function getPrometheusMetricsPort(defaultPort = 0): number {
  const parsed = Number.parseInt(process.env.PROMETHEUS_METRICS_PORT ?? "", 10);
  return Number.isFinite(parsed) ? parsed : defaultPort;
}

export function getEmbeddingProviderType(
  defaultProvider: "ollama" | "openai" | "cohere" | "ngram" = "ngram"
): "ollama" | "openai" | "cohere" | "ngram" {
  const provider = process.env.SF_AI_EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (provider === "openai" || provider === "cohere" || provider === "ollama" || provider === "ngram") {
    return provider;
  }
  return defaultProvider;
}

export function getOpenAiApiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function getOpenAiEmbeddingModel(
  defaultModel: "text-embedding-3-small" | "text-embedding-3-large" | "text-embedding-ada-002" = "text-embedding-3-small"
): "text-embedding-3-small" | "text-embedding-3-large" | "text-embedding-ada-002" {
  const model = process.env.OPENAI_EMBEDDING_MODEL?.trim();
  if (model === "text-embedding-3-small" || model === "text-embedding-3-large" || model === "text-embedding-ada-002") {
    return model;
  }
  return defaultModel;
}

export function getCohereApiKey(): string | undefined {
  const key = process.env.COHERE_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function getCohereEmbeddingModel(
  defaultModel: "embed-english-v3.0" | "embed-english-light-v3.0" = "embed-english-v3.0"
): "embed-english-v3.0" | "embed-english-light-v3.0" {
  const model = process.env.COHERE_EMBEDDING_MODEL?.trim();
  if (model === "embed-english-v3.0" || model === "embed-english-light-v3.0") {
    return model;
  }
  return defaultModel;
}

export function getNodeEnv(defaultEnv = "development"): string {
  const configured = process.env.NODE_ENV?.trim();
  return configured && configured.length > 0 ? configured : defaultEnv;
}

export interface SecretsEnvConfig {
  backend?: "env" | "file" | "vault" | "aws-sm";
  auditEnabled: boolean;
  filePath?: string;
  vaultAddr?: string;
  vaultToken?: string;
  vaultMount?: string;
  vaultValueField?: string;
  awsRegion?: string;
}

export function getSecretsEnvConfig(): SecretsEnvConfig {
  const backendRaw = process.env.SF_AI_SECRET_BACKEND?.trim();
  const backend =
    backendRaw === "env" || backendRaw === "file" || backendRaw === "vault" || backendRaw === "aws-sm"
      ? backendRaw
      : undefined;
  return {
    backend,
    auditEnabled: process.env.SF_AI_SECRET_AUDIT_ENABLED !== "false",
    filePath: process.env.SF_AI_SECRET_FILE_PATH,
    vaultAddr: process.env.SF_AI_VAULT_ADDR,
    vaultToken: process.env.SF_AI_VAULT_TOKEN,
    vaultMount: process.env.SF_AI_VAULT_MOUNT,
    vaultValueField: process.env.SF_AI_VAULT_VALUE_FIELD,
    awsRegion: process.env.SF_AI_AWS_REGION
  };
}

export interface MetricsAutoUpdateEnvConfig {
  reportingHours?: string;
  includeDriftDetection?: string;
  driftFreezeEnabled?: string;
  driftBaselineHours?: string;
  driftRecentHours?: string;
  driftMinRewardSamples?: string;
  driftThreshold?: string;
  driftAdaptiveThreshold?: string;
  driftAdaptiveMinThreshold?: string;
  driftAdaptiveMaxThreshold?: string;
  driftMinReputationSamples?: string;
  regressionThreshold?: string;
  driftReportPath?: string;
  driftFreezeHours?: string;
  driftFreezeStatePath?: string;
  learningOrchestratorEnabled?: string;
  learningSnapshotPath?: string;
  learningModelNames?: string;
  learningCurrentCanaryMap?: string;
  learningCanaryStatePath?: string;
  learningCanaryTrafficPercent?: string;
  learningManualApprovalRequired?: string;
  learningManualOverride?: string;
  learningActorId?: string;
  learningReportPath?: string;
}

export function getMetricsAutoUpdateEnvConfig(): MetricsAutoUpdateEnvConfig {
  return {
    reportingHours: process.env.SF_AI_METRICS_REPORTING_HOURS,
    includeDriftDetection: process.env.SF_AI_METRICS_WITH_DRIFT,
    driftFreezeEnabled: process.env.SF_AI_DRIFT_FREEZE_ENABLED,
    driftBaselineHours: process.env.SF_AI_DRIFT_BASELINE_HOURS,
    driftRecentHours: process.env.SF_AI_DRIFT_RECENT_HOURS,
    driftMinRewardSamples: process.env.SF_AI_DRIFT_MIN_REWARD_SAMPLES,
    driftThreshold: process.env.SF_AI_DRIFT_THRESHOLD,
    driftAdaptiveThreshold: process.env.SF_AI_DRIFT_ADAPTIVE_THRESHOLD,
    driftAdaptiveMinThreshold: process.env.SF_AI_DRIFT_ADAPTIVE_MIN_THRESHOLD,
    driftAdaptiveMaxThreshold: process.env.SF_AI_DRIFT_ADAPTIVE_MAX_THRESHOLD,
    driftMinReputationSamples: process.env.SF_AI_DRIFT_MIN_REPUTATION_SAMPLES,
    regressionThreshold: process.env.SF_AI_REGRESSION_THRESHOLD,
    driftReportPath: process.env.SF_AI_DRIFT_REPORT_PATH,
    driftFreezeHours: process.env.SF_AI_DRIFT_FREEZE_HOURS,
    driftFreezeStatePath: process.env.SF_AI_DRIFT_FREEZE_STATE_PATH,
    learningOrchestratorEnabled: process.env.SF_AI_LEARNING_ORCHESTRATOR_ENABLED,
    learningSnapshotPath: process.env.SF_AI_LEARNING_SNAPSHOT_PATH,
    learningModelNames: process.env.SF_AI_LEARNING_MODEL_NAMES,
    learningCurrentCanaryMap: process.env.SF_AI_LEARNING_CURRENT_CANARY_MAP,
    learningCanaryStatePath: process.env.SF_AI_LEARNING_CANARY_STATE_PATH,
    learningCanaryTrafficPercent: process.env.SF_AI_LEARNING_CANARY_TRAFFIC_PERCENT,
    learningManualApprovalRequired: process.env.SF_AI_LEARNING_MANUAL_APPROVAL_REQUIRED,
    learningManualOverride: process.env.SF_AI_LEARNING_MANUAL_OVERRIDE,
    learningActorId: process.env.SF_AI_LEARNING_ACTOR_ID,
    learningReportPath: process.env.SF_AI_LEARNING_ORCHESTRATOR_REPORT_PATH
  };
}

export function getAutoApplyMinScore(defaultScore = 70): number {
  return parsePositiveIntOrFallback(process.env.SF_AI_AUTO_APPLY_MIN_SCORE, defaultScore);
}

export function getAutoApplyMaxPerDay(defaultMax = 5): number {
  return parsePositiveIntOrFallback(process.env.SF_AI_AUTO_APPLY_MAX_PER_DAY, defaultMax);
}

export function getAutoApplyMaxDeletions(defaultMax = 3): number {
  return parsePositiveIntOrFallback(process.env.SF_AI_AUTO_APPLY_MAX_DELETIONS, defaultMax);
}

function parsePositiveFloatOrFallback(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseRatio(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

type ResourceType = "skills" | "tools" | "presets";

type ScoringConfigOverride = Partial<{
  exactNameMatchWeight: number;
  nameContainWeight: number;
  tokenMatchWeight: number;
  tagMatchWeight: number;
  descriptionMatchWeight: number;
  usageWeight: number;
  bugPenaltyWeight: number;
  recencyBonusWeight: number;
  dayWindow: number;
  gapThreshold: number;
  embeddingMode: "off" | "hybrid";
  embeddingAlpha: number;
}>;

type RubricCriterionOverride = Partial<{
  label: string;
  description: string;
  weight: number;
}>;

export type ResourceScoringOverrideByAgent = Record<
  string,
  Partial<Record<ResourceType, ScoringConfigOverride>>
>;

export type RubricCriteriaOverrideByAgent = Record<string, Record<string, RubricCriterionOverride>>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeScoringConfigOverride(value: unknown): ScoringConfigOverride | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const out: ScoringConfigOverride = {};
  const numericKeys: Array<keyof ScoringConfigOverride> = [
    "exactNameMatchWeight",
    "nameContainWeight",
    "tokenMatchWeight",
    "tagMatchWeight",
    "descriptionMatchWeight",
    "usageWeight",
    "bugPenaltyWeight",
    "recencyBonusWeight",
    "dayWindow",
    "gapThreshold",
    "embeddingAlpha"
  ];
  for (const key of numericKeys) {
    const v = value[key];
    if (typeof v === "number" && Number.isFinite(v)) {
      (out as Record<string, number | "off" | "hybrid">)[key] = v;
    }
  }
  if (value.embeddingMode === "off" || value.embeddingMode === "hybrid") {
    out.embeddingMode = value.embeddingMode;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseResourceScoringOverrideByAgent(value: string | undefined): ResourceScoringOverrideByAgent {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)) {
      return {};
    }
    const out: ResourceScoringOverrideByAgent = {};
    for (const [agentName, perType] of Object.entries(parsed)) {
      if (!isPlainObject(perType)) {
        continue;
      }
      const byType: Partial<Record<ResourceType, ScoringConfigOverride>> = {};
      for (const resourceType of ["skills", "tools", "presets"] as const) {
        const sanitized = sanitizeScoringConfigOverride(perType[resourceType]);
        if (sanitized) {
          byType[resourceType] = sanitized;
        }
      }
      if (Object.keys(byType).length > 0) {
        out[agentName] = byType;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function sanitizeRubricCriterionOverride(value: unknown): RubricCriterionOverride | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const out: RubricCriterionOverride = {};
  if (typeof value.label === "string") {
    out.label = value.label;
  }
  if (typeof value.description === "string") {
    out.description = value.description;
  }
  if (typeof value.weight === "number" && Number.isFinite(value.weight) && value.weight >= 0) {
    out.weight = value.weight;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseRubricCriteriaOverrideByAgent(value: string | undefined): RubricCriteriaOverrideByAgent {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isPlainObject(parsed)) {
      return {};
    }
    const out: RubricCriteriaOverrideByAgent = {};
    for (const [agentName, criteria] of Object.entries(parsed)) {
      if (!isPlainObject(criteria)) {
        continue;
      }
      const perCriterion: Record<string, RubricCriterionOverride> = {};
      for (const [criterionId, criterionOverride] of Object.entries(criteria)) {
        const sanitized = sanitizeRubricCriterionOverride(criterionOverride);
        if (sanitized) {
          perCriterion[criterionId] = sanitized;
        }
      }
      if (Object.keys(perCriterion).length > 0) {
        out[agentName] = perCriterion;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function getLowRelevanceScoreThreshold(): number {
  return parsePositiveIntOrFallback(
    process.env.AI_LOW_RELEVANCE_THRESHOLD ?? process.env.LOW_RELEVANCE_SCORE_THRESHOLD,
    6
  );
}

export function getPromptCacheMaxEntries(): number {
  return parsePositiveIntOrFallback(
    process.env.AI_PROMPT_CACHE_MAX_ENTRIES ?? process.env.PROMPT_CACHE_MAX_ENTRIES,
    100
  );
}

export function getPromptCacheTtlSeconds(): number {
  return parsePositiveIntOrFallback(
    process.env.AI_PROMPT_CACHE_TTL_SECONDS ?? process.env.PROMPT_CACHE_TTL_SECONDS,
    600  // 10 minutes (previously 60 seconds)
  );
}

export function getAgentTrustScoringEnabled(): boolean {
  return parseBooleanEnv(
    process.env.AI_AGENT_TRUST_SCORING_ENABLED ?? process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED,
    false
  );
}

export function getAgentTrustThreshold(): number {
  return parseRatio(
    process.env.AI_AGENT_TRUST_THRESHOLD ?? process.env.SF_AI_AGENT_TRUST_THRESHOLD,
    0.55
  );
}

export function getCriticJudgeTargetScore(defaultScore = 8.5): number {
  return parsePositiveFloatOrFallback(process.env.SF_AI_CRITIC_JUDGE_TARGET_SCORE, defaultScore);
}

export function getCriticHeuristicTargetScore(defaultScore = 7): number {
  return parsePositiveFloatOrFallback(process.env.SF_AI_CRITIC_HEURISTIC_TARGET_SCORE, defaultScore);
}

export function getCriticProposalScoreThreshold(defaultScore = 6): number {
  return parsePositiveFloatOrFallback(process.env.SF_AI_CRITIC_PROPOSAL_SCORE_THRESHOLD, defaultScore);
}

export function getCriticMinImprovementThreshold(defaultImprovement = 0.2): number {
  return parsePositiveFloatOrFallback(process.env.SF_AI_CRITIC_MIN_IMPROVEMENT_THRESHOLD, defaultImprovement);
}

export function getResourceScoringOverrideByAgent(): ResourceScoringOverrideByAgent {
  return parseResourceScoringOverrideByAgent(
    process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT ?? process.env.SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT
  );
}

export function getRubricCriteriaOverrideByAgent(): RubricCriteriaOverrideByAgent {
  return parseRubricCriteriaOverrideByAgent(
    process.env.AI_RUBRIC_CRITERIA_BY_AGENT ?? process.env.SF_AI_RUBRIC_CRITERIA_BY_AGENT
  );
}
