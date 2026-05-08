# テストファイル責務マップ

本ドキュメントは、tests 配下の各テストファイルがどの領域を担当するかを一覧化したものです。

- 対象件数: 165 ファイル
- 対象拡張子: *.test.ts
- 更新日: 2026-05-08

## 一覧

| テストファイル | 担当領域 | 主に検証する内容 |
|---|---|---|
| [tests/ab-causal-analysis.test.ts\](../tests/ab-causal-analysis.test.ts) | Learning/Recommendation | ab causal analysis に関する仕様・回帰を検証 |
| [tests/actor-identity-context.test.ts\](../tests/actor-identity-context.test.ts) | General/Platform | actor identity context に関する仕様・回帰を検証 |
| [tests/advanced-tools.test.ts\](../tests/advanced-tools.test.ts) | Core Platform/Tooling | advanced tools に関する仕様・回帰を検証 |
| [tests/advisory-lock.test.ts\](../tests/advisory-lock.test.ts) | Persistence/Orchestration | advisory lock に関する仕様・回帰を検証 |
| [tests/agent-graph-learning.test.ts\](../tests/agent-graph-learning.test.ts) | Learning/Recommendation | agent graph learning に関する仕様・回帰を検証 |
| [tests/agent-reputation.test.ts\](../tests/agent-reputation.test.ts) | Learning/Recommendation | agent reputation に関する仕様・回帰を検証 |
| [tests/agent-synergy-score.test.ts\](../tests/agent-synergy-score.test.ts) | Learning/Recommendation | agent synergy score に関する仕様・回帰を検証 |
| [tests/agent-synergy-weekly.test.ts\](../tests/agent-synergy-weekly.test.ts) | Learning/Recommendation | agent synergy weekly に関する仕様・回帰を検証 |
| [tests/apex-analyzer-database-query.test.ts\](../tests/apex-analyzer-database-query.test.ts) | Salesforce Apex | apex analyzer database query に関する仕様・回帰を検証 |
| [tests/apex-ast.test.ts\](../tests/apex-ast.test.ts) | Salesforce Apex | apex ast に関する仕様・回帰を検証 |
| [tests/apex-changelog.test.ts\](../tests/apex-changelog.test.ts) | Salesforce Apex | apex changelog に関する仕様・回帰を検証 |
| [tests/apex-dependency-graph.test.ts\](../tests/apex-dependency-graph.test.ts) | Salesforce Apex | apex dependency graph に関する仕様・回帰を検証 |
| [tests/apex-dependency-graph-a2.test.ts\](../tests/apex-dependency-graph-a2.test.ts) | Salesforce Apex | apex dependency graph a2 に関する仕様・回帰を検証 |
| [tests/apex-dependency-graph-incremental.test.ts\](../tests/apex-dependency-graph-incremental.test.ts) | Salesforce Apex | apex dependency graph incremental に関する仕様・回帰を検証 |
| [tests/apex-perf-predict.test.ts\](../tests/apex-perf-predict.test.ts) | Salesforce Apex | apex perf predict に関する仕様・回帰を検証 |
| [tests/app-error-i18n.test.ts\](../tests/app-error-i18n.test.ts) | General/Platform | app error i18n に関する仕様・回帰を検証 |
| [tests/apply-resource-actions.test.ts\](../tests/apply-resource-actions.test.ts) | Proposal/Resource Governance | apply resource actions に関する仕様・回帰を検証 |
| [tests/atomic-json-stores.test.ts\](../tests/atomic-json-stores.test.ts) | Persistence/Orchestration | atomic json stores に関する仕様・回帰を検証 |
| [tests/auto-create-gate.test.ts\](../tests/auto-create-gate.test.ts) | Proposal/Resource Governance | auto create gate に関する仕様・回帰を検証 |
| [tests/bandit-orchestration-policy.test.ts\](../tests/bandit-orchestration-policy.test.ts) | Persistence/Orchestration | bandit orchestration policy に関する仕様・回帰を検証 |
| [tests/branch-diff-tools.test.ts\](../tests/branch-diff-tools.test.ts) | General/Platform | branch diff tools に関する仕様・回帰を検証 |
| [tests/chat-prompt-building.test.ts\](../tests/chat-prompt-building.test.ts) | Prompt Engine/Quality | chat prompt building に関する仕様・回帰を検証 |
| [tests/concurrent-governance.test.ts\](../tests/concurrent-governance.test.ts) | General/Platform | concurrent governance に関する仕様・回帰を検証 |
| [tests/context-budget.test.ts\](../tests/context-budget.test.ts) | General/Platform | context budget に関する仕様・回帰を検証 |
| [tests/core-modules.test.ts\](../tests/core-modules.test.ts) | Core Platform/Tooling | core modules に関する仕様・回帰を検証 |
| [tests/core-tools.test.ts\](../tests/core-tools.test.ts) | Core Platform/Tooling | core tools に関する仕様・回帰を検証 |
| [tests/cost-feedback.test.ts\](../tests/cost-feedback.test.ts) | Learning/Recommendation | cost feedback に関する仕様・回帰を検証 |
| [tests/crash-recovery.test.ts\](../tests/crash-recovery.test.ts) | General/Platform | crash recovery に関する仕様・回帰を検証 |
| [tests/custom-tool-registry.test.ts\](../tests/custom-tool-registry.test.ts) | Core Platform/Tooling | custom tool registry に関する仕様・回帰を検証 |
| [tests/dag-engine.test.ts\](../tests/dag-engine.test.ts) | General/Platform | dag engine に関する仕様・回帰を検証 |
| [tests/dashboard-agent-views.test.ts\](../tests/dashboard-agent-views.test.ts) | Observability/Runtime Ops | dashboard agent views に関する仕様・回帰を検証 |
| [tests/dashboard-drill-down.test.ts\](../tests/dashboard-drill-down.test.ts) | Observability/Runtime Ops | dashboard drill down に関する仕様・回帰を検証 |
| [tests/data-retention.test.ts\](../tests/data-retention.test.ts) | General/Platform | data retention に関する仕様・回帰を検証 |
| [tests/declarative-frontmatter.test.ts\](../tests/declarative-frontmatter.test.ts) | Core Platform/Tooling | declarative frontmatter に関する仕様・回帰を検証 |
| [tests/declarative-tool-loader.test.ts\](../tests/declarative-tool-loader.test.ts) | Core Platform/Tooling | declarative tool loader に関する仕様・回帰を検証 |
| [tests/drift-detector.test.ts\](../tests/drift-detector.test.ts) | Learning/Recommendation | drift detector に関する仕様・回帰を検証 |
| [tests/embedding-provider.test.ts\](../tests/embedding-provider.test.ts) | Vector Store/Embedding | embedding provider に関する仕様・回帰を検証 |
| [tests/env/env-schema.test.ts\](../tests/env/env-schema.test.ts) | Environment/Schema | env schema に関する仕様・回帰を検証 |
| [tests/env-flags.test.ts\](../tests/env-flags.test.ts) | General/Platform | env flags に関する仕様・回帰を検証 |
| [tests/error-recovery-e2e.test.ts\](../tests/error-recovery-e2e.test.ts) | General/Platform | error recovery e2e に関する仕様・回帰を検証 |
| [tests/evals/eval-harness.test.ts\](../tests/evals/eval-harness.test.ts) | General/Platform | eval harness に関する仕様・回帰を検証 |
| [tests/event-bus.test.ts\](../tests/event-bus.test.ts) | Core Platform/Tooling | event bus に関する仕様・回帰を検証 |
| [tests/execution-policy.test.ts\](../tests/execution-policy.test.ts) | Core Platform/Tooling | execution policy に関する仕様・回帰を検証 |
| [tests/failure-memory-rag.test.ts\](../tests/failure-memory-rag.test.ts) | General/Platform | failure memory rag に関する仕様・回帰を検証 |
| [tests/feedback-loop-visualization.test.ts\](../tests/feedback-loop-visualization.test.ts) | Learning/Recommendation | feedback loop visualization に関する仕様・回帰を検証 |
| [tests/feedback-manager.test.ts\](../tests/feedback-manager.test.ts) | Learning/Recommendation | feedback manager に関する仕様・回帰を検証 |
| [tests/filepath-traversal.test.ts\](../tests/filepath-traversal.test.ts) | Core Platform/Tooling | filepath traversal に関する仕様・回帰を検証 |
| [tests/flow-ast.test.ts\](../tests/flow-ast.test.ts) | Salesforce Flow | flow ast に関する仕様・回帰を検証 |
| [tests/flow-condition-matrix.test.ts\](../tests/flow-condition-matrix.test.ts) | Salesforce Flow | flow condition matrix に関する仕様・回帰を検証 |
| [tests/flow-condition-simulator.test.ts\](../tests/flow-condition-simulator.test.ts) | Salesforce Flow | flow condition simulator に関する仕様・回帰を検証 |
| [tests/git-diff-helpers.test.ts\](../tests/git-diff-helpers.test.ts) | General/Platform | git diff helpers に関する仕様・回帰を検証 |
| [tests/governance/audit-archiver.test.ts\](../tests/governance/audit-archiver.test.ts) | Governance/Compliance | audit archiver に関する仕様・回帰を検証 |
| [tests/governance/cost-budget.test.ts\](../tests/governance/cost-budget.test.ts) | Governance/Compliance | cost budget に関する仕様・回帰を検証 |
| [tests/governance/sod-enforcement.test.ts\](../tests/governance/sod-enforcement.test.ts) | Governance/Compliance | sod enforcement に関する仕様・回帰を検証 |
| [tests/governance-event-reliability.test.ts\](../tests/governance-event-reliability.test.ts) | General/Platform | governance event reliability に関する仕様・回帰を検証 |
| [tests/governance-state-schema.test.ts\](../tests/governance-state-schema.test.ts) | General/Platform | governance state schema に関する仕様・回帰を検証 |
| [tests/governance-ui.test.ts\](../tests/governance-ui.test.ts) | General/Platform | governance ui に関する仕様・回帰を検証 |
| [tests/governed-tool-registrar.test.ts\](../tests/governed-tool-registrar.test.ts) | General/Platform | governed tool registrar に関する仕様・回帰を検証 |
| [tests/handlers/handlers-integration.test.ts\](../tests/handlers/handlers-integration.test.ts) | Handlers Integration | handlers integration に関する仕様・回帰を検証 |
| [tests/handler-schedule.test.ts\](../tests/handler-schedule.test.ts) | General/Platform | handler schedule に関する仕様・回帰を検証 |
| [tests/handlers-modules.test.ts\](../tests/handlers-modules.test.ts) | Core Platform/Tooling | handlers modules に関する仕様・回帰を検証 |
| [tests/health-server.test.ts\](../tests/health-server.test.ts) | Observability/Runtime Ops | health server に関する仕様・回帰を検証 |
| [tests/history-archive.test.ts\](../tests/history-archive.test.ts) | Outputs Lifecycle | history archive に関する仕様・回帰を検証 |
| [tests/identity/oidc-jwt-verify.integration.test.ts\](../tests/identity/oidc-jwt-verify.integration.test.ts) | Identity/RBAC/OIDC | oidc jwt verify.integration に関する仕様・回帰を検証 |
| [tests/identity/rbac-policy.test.ts\](../tests/identity/rbac-policy.test.ts) | Identity/RBAC/OIDC | rbac policy に関する仕様・回帰を検証 |
| [tests/impact-simulator.test.ts\](../tests/impact-simulator.test.ts) | Domain Analysis Tools | impact simulator に関する仕様・回帰を検証 |
| [tests/injection-guard.test.ts\](../tests/injection-guard.test.ts) | Core Platform/Tooling | injection guard に関する仕様・回帰を検証 |
| [tests/io/outputs-backend-s3.test.ts\](../tests/io/outputs-backend-s3.test.ts) | I/O Backend | outputs backend s3 に関する仕様・回帰を検証 |
| [tests/learning/drift-freeze.test.ts\](../tests/learning/drift-freeze.test.ts) | Learning/Policy | drift freeze に関する仕様・回帰を検証 |
| [tests/learning/policy-snapshot.test.ts\](../tests/learning/policy-snapshot.test.ts) | Learning/Policy | policy snapshot に関する仕様・回帰を検証 |
| [tests/learning/replay-ab.integration.test.ts\](../tests/learning/replay-ab.integration.test.ts) | Learning/Policy | replay ab.integration に関する仕様・回帰を検証 |
| [tests/learning-replay.test.ts\](../tests/learning-replay.test.ts) | Learning/Recommendation | learning replay に関する仕様・回帰を検証 |
| [tests/lin-ucb-bandit.test.ts\](../tests/lin-ucb-bandit.test.ts) | Learning/Recommendation | lin ucb bandit に関する仕様・回帰を検証 |
| [tests/markdown-catalog-frontmatter.test.ts\](../tests/markdown-catalog-frontmatter.test.ts) | General/Platform | markdown catalog frontmatter に関する仕様・回帰を検証 |
| [tests/memory/chunker.test.ts\](../tests/memory/chunker.test.ts) | Memory/Knowledge Graph | chunker に関する仕様・回帰を検証 |
| [tests/memory/cross-model-isolation.integration.test.ts\](../tests/memory/cross-model-isolation.integration.test.ts) | Memory/Knowledge Graph | cross model isolation.integration に関する仕様・回帰を検証 |
| [tests/memory/embedding-metadata.test.ts\](../tests/memory/embedding-metadata.test.ts) | Memory/Knowledge Graph | embedding metadata に関する仕様・回帰を検証 |
| [tests/memory/hierarchical-retrieval.integration.test.ts\](../tests/memory/hierarchical-retrieval.integration.test.ts) | Memory/Knowledge Graph | hierarchical retrieval.integration に関する仕様・回帰を検証 |
| [tests/memory/knowledge-graph.integration.test.ts\](../tests/memory/knowledge-graph.integration.test.ts) | Memory/Knowledge Graph | knowledge graph.integration に関する仕様・回帰を検証 |
| [tests/memory-prompt.test.ts\](../tests/memory-prompt.test.ts) | Prompt Engine/Quality | memory prompt に関する仕様・回帰を検証 |
| [tests/memory-retention.test.ts\](../tests/memory-retention.test.ts) | General/Platform | memory retention に関する仕様・回帰を検証 |
| [tests/metrics-auto-update.test.ts\](../tests/metrics-auto-update.test.ts) | Learning/Recommendation | metrics auto update に関する仕様・回帰を検証 |
| [tests/model-arbitration.test.ts\](../tests/model-arbitration.test.ts) | Learning/Recommendation | model arbitration に関する仕様・回帰を検証 |
| [tests/new-tools.test.ts\](../tests/new-tools.test.ts) | Core Platform/Tooling | new tools に関する仕様・回帰を検証 |
| [tests/observability/slo-burn-tracker.test.ts\](../tests/observability/slo-burn-tracker.test.ts) | Observability/SLO | slo burn tracker に関する仕様・回帰を検証 |
| [tests/observability-otel-prom.e2e.test.ts\](../tests/observability-otel-prom.e2e.test.ts) | Observability/Runtime Ops | observability otel prom.e2e に関する仕様・回帰を検証 |
| [tests/ollama-client.test.ts\](../tests/ollama-client.test.ts) | General/Platform | ollama client に関する仕様・回帰を検証 |
| [tests/ollama-health.test.ts\](../tests/ollama-health.test.ts) | Observability/Runtime Ops | ollama health に関する仕様・回帰を検証 |
| [tests/operation-log.test.ts\](../tests/operation-log.test.ts) | Core Platform/Tooling | operation log に関する仕様・回帰を検証 |
| [tests/orchestration-job-runner.test.ts\](../tests/orchestration-job-runner.test.ts) | Persistence/Orchestration | orchestration job runner に関する仕様・回帰を検証 |
| [tests/orchestration-job-runner-postgres.integration.test.ts\](../tests/orchestration-job-runner-postgres.integration.test.ts) | Persistence/Orchestration | orchestration job runner postgres.integration に関する仕様・回帰を検証 |
| [tests/orchestration-queue-store.test.ts\](../tests/orchestration-queue-store.test.ts) | Persistence/Orchestration | orchestration queue store に関する仕様・回帰を検証 |
| [tests/orchestration-queue-store-postgres.integration.test.ts\](../tests/orchestration-queue-store-postgres.integration.test.ts) | Persistence/Orchestration | orchestration queue store postgres.integration に関する仕様・回帰を検証 |
| [tests/org-catalog.test.ts\](../tests/org-catalog.test.ts) | Org Management | org catalog に関する仕様・回帰を検証 |
| [tests/org-catalog-sync.test.ts\](../tests/org-catalog-sync.test.ts) | Org Management | org catalog sync に関する仕様・回帰を検証 |
| [tests/org-metadata-diff.test.ts\](../tests/org-metadata-diff.test.ts) | Org Management | org metadata diff に関する仕様・回帰を検証 |
| [tests/org-timeline.test.ts\](../tests/org-timeline.test.ts) | Org Management | org timeline に関する仕様・回帰を検証 |
| [tests/outputs-artifact-writer.test.ts\](../tests/outputs-artifact-writer.test.ts) | Outputs Lifecycle | outputs artifact writer に関する仕様・回帰を検証 |
| [tests/outputs-cleanup.test.ts\](../tests/outputs-cleanup.test.ts) | Outputs Lifecycle | outputs cleanup に関する仕様・回帰を検証 |
| [tests/outputs-cleanup-retention-policy.test.ts\](../tests/outputs-cleanup-retention-policy.test.ts) | Outputs Lifecycle | outputs cleanup retention policy に関する仕様・回帰を検証 |
| [tests/outputs-dir-warning.test.ts\](../tests/outputs-dir-warning.test.ts) | Outputs Lifecycle | outputs dir warning に関する仕様・回帰を検証 |
| [tests/outputs-origin.test.ts\](../tests/outputs-origin.test.ts) | Outputs Lifecycle | outputs origin に関する仕様・回帰を検証 |
| [tests/outputs-schema-integration.test.ts\](../tests/outputs-schema-integration.test.ts) | Outputs Lifecycle | outputs schema integration に関する仕様・回帰を検証 |
| [tests/outputs-versioning.test.ts\](../tests/outputs-versioning.test.ts) | Outputs Lifecycle | outputs versioning に関する仕様・回帰を検証 |
| [tests/permission-set-diff.test.ts\](../tests/permission-set-diff.test.ts) | Domain Analysis Tools | permission set diff に関する仕様・回帰を検証 |
| [tests/permission-set-xml.test.ts\](../tests/permission-set-xml.test.ts) | Domain Analysis Tools | permission set xml に関する仕様・回帰を検証 |
| [tests/persistence-unit-of-work.test.ts\](../tests/persistence-unit-of-work.test.ts) | Persistence/Orchestration | persistence unit of work に関する仕様・回帰を検証 |
| [tests/pg-boss-proposal-queue.test.ts\](../tests/pg-boss-proposal-queue.test.ts) | Persistence/Orchestration | pg boss proposal queue に関する仕様・回帰を検証 |
| [tests/pii-masker.test.ts\](../tests/pii-masker.test.ts) | General/Platform | pii masker に関する仕様・回帰を検証 |
| [tests/postgres-orchestration-session-store.test.ts\](../tests/postgres-orchestration-session-store.test.ts) | Persistence/Orchestration | postgres orchestration session store に関する仕様・回帰を検証 |
| [tests/postgres-state-store.test.ts\](../tests/postgres-state-store.test.ts) | Persistence/Orchestration | postgres state store に関する仕様・回帰を検証 |
| [tests/postgres-tenant-rls.integration.test.ts\](../tests/postgres-tenant-rls.integration.test.ts) | Persistence/Orchestration | postgres tenant rls.integration に関する仕様・回帰を検証 |
| [tests/precommit-guard.test.ts\](../tests/precommit-guard.test.ts) | Core Platform/Tooling | precommit guard に関する仕様・回帰を検証 |
| [tests/preset-store.test.ts\](../tests/preset-store.test.ts) | General/Platform | preset store に関する仕様・回帰を検証 |
| [tests/prompt-builder.test.ts\](../tests/prompt-builder.test.ts) | Prompt Engine/Quality | prompt builder に関する仕様・回帰を検証 |
| [tests/prompt-cache.test.ts\](../tests/prompt-cache.test.ts) | Prompt Engine/Quality | prompt cache に関する仕様・回帰を検証 |
| [tests/prompt-evaluator.test.ts\](../tests/prompt-evaluator.test.ts) | Prompt Engine/Quality | prompt evaluator に関する仕様・回帰を検証 |
| [tests/prompt-golden.test.ts\](../tests/prompt-golden.test.ts) | Prompt Engine/Quality | prompt golden に関する仕様・回帰を検証 |
| [tests/prompt-rendering-default-context.test.ts\](../tests/prompt-rendering-default-context.test.ts) | Prompt Engine/Quality | prompt rendering default context に関する仕様・回帰を検証 |
| [tests/property-based.test.ts\](../tests/property-based.test.ts) | General/Platform | property based に関する仕様・回帰を検証 |
| [tests/proposal-applier.test.ts\](../tests/proposal-applier.test.ts) | Proposal/Resource Governance | proposal applier に関する仕様・回帰を検証 |
| [tests/proposal-feedback.test.ts\](../tests/proposal-feedback.test.ts) | Proposal/Resource Governance | proposal feedback に関する仕様・回帰を検証 |
| [tests/proposal-queue.test.ts\](../tests/proposal-queue.test.ts) | Proposal/Resource Governance | proposal queue に関する仕様・回帰を検証 |
| [tests/proposal-queue-tools.test.ts\](../tests/proposal-queue-tools.test.ts) | Proposal/Resource Governance | proposal queue tools に関する仕様・回帰を検証 |
| [tests/quality-rubric.test.ts\](../tests/quality-rubric.test.ts) | Prompt Engine/Quality | quality rubric に関する仕様・回帰を検証 |
| [tests/query-skill-incremental.test.ts\](../tests/query-skill-incremental.test.ts) | Learning/Recommendation | query skill incremental に関する仕様・回帰を検証 |
| [tests/recommend-skills-for-role.test.ts\](../tests/recommend-skills-for-role.test.ts) | Learning/Recommendation | recommend skills for role に関する仕様・回帰を検証 |
| [tests/refactor-suggest.test.ts\](../tests/refactor-suggest.test.ts) | Domain Analysis Tools | refactor suggest に関する仕様・回帰を検証 |
| [tests/registry/plugin-loader.test.ts\](../tests/registry/plugin-loader.test.ts) | Plugin Registry | plugin loader に関する仕様・回帰を検証 |
| [tests/registry/plugin-manifest.test.ts\](../tests/registry/plugin-manifest.test.ts) | Plugin Registry | plugin manifest に関する仕様・回帰を検証 |
| [tests/registry/plugin-registry.test.ts\](../tests/registry/plugin-registry.test.ts) | Plugin Registry | plugin registry に関する仕様・回帰を検証 |
| [tests/reliability/bulkhead-concurrency.test.ts\](../tests/reliability/bulkhead-concurrency.test.ts) | Reliability/Resilience | bulkhead concurrency に関する仕様・回帰を検証 |
| [tests/reliability/circuit-breaker.test.ts\](../tests/reliability/circuit-breaker.test.ts) | Reliability/Resilience | circuit breaker に関する仕様・回帰を検証 |
| [tests/reliability/rate-limiter.test.ts\](../tests/reliability/rate-limiter.test.ts) | Reliability/Resilience | rate limiter に関する仕様・回帰を検証 |
| [tests/resource-selection-confidence.test.ts\](../tests/resource-selection-confidence.test.ts) | Learning/Recommendation | resource selection confidence に関する仕様・回帰を検証 |
| [tests/reward-aggregator.test.ts\](../tests/reward-aggregator.test.ts) | Learning/Recommendation | reward aggregator に関する仕様・回帰を検証 |
| [tests/rl-feedback-dynamic.test.ts\](../tests/rl-feedback-dynamic.test.ts) | Learning/Recommendation | rl feedback dynamic に関する仕様・回帰を検証 |
| [tests/runtime-config-agent-trust.test.ts\](../tests/runtime-config-agent-trust.test.ts) | General/Platform | runtime config agent trust に関する仕様・回帰を検証 |
| [tests/runtime-config-resource-scoring.test.ts\](../tests/runtime-config-resource-scoring.test.ts) | General/Platform | runtime config resource scoring に関する仕様・回帰を検証 |
| [tests/runtime-config-rubric-override.test.ts\](../tests/runtime-config-rubric-override.test.ts) | General/Platform | runtime config rubric override に関する仕様・回帰を検証 |
| [tests/runtime-profile.test.ts\](../tests/runtime-profile.test.ts) | Observability/Runtime Ops | runtime profile に関する仕様・回帰を検証 |
| [tests/scaffold.test.ts\](../tests/scaffold.test.ts) | Core Platform/Tooling | scaffold に関する仕様・回帰を検証 |
| [tests/security/at-rest-crypto.test.ts\](../tests/security/at-rest-crypto.test.ts) | Security/Crypto/Secrets | at rest crypto に関する仕様・回帰を検証 |
| [tests/security/secrets-rotation.test.ts\](../tests/security/secrets-rotation.test.ts) | Security/Crypto/Secrets | secrets rotation に関する仕様・回帰を検証 |
| [tests/security-rule-scan.test.ts\](../tests/security-rule-scan.test.ts) | Domain Analysis Tools | security rule scan に関する仕様・回帰を検証 |
| [tests/self-refine-loop.test.ts\](../tests/self-refine-loop.test.ts) | Prompt Engine/Quality | self refine loop に関する仕様・回帰を検証 |
| [tests/server-tools.integration.test.ts\](../tests/server-tools.integration.test.ts) | Core Platform/Tooling | server tools.integration に関する仕様・回帰を検証 |
| [tests/session-store-postgres.integration.test.ts\](../tests/session-store-postgres.integration.test.ts) | Persistence/Orchestration | session store postgres.integration に関する仕様・回帰を検証 |
| [tests/session-store-tenant-isolation.test.ts\](../tests/session-store-tenant-isolation.test.ts) | Persistence/Orchestration | session store tenant isolation に関する仕様・回帰を検証 |
| [tests/skill-rating.test.ts\](../tests/skill-rating.test.ts) | General/Platform | skill rating に関する仕様・回帰を検証 |
| [tests/speech-style-registry.test.ts\](../tests/speech-style-registry.test.ts) | General/Platform | speech style registry に関する仕様・回帰を検証 |
| [tests/sqlite-state-store.test.ts\](../tests/sqlite-state-store.test.ts) | Persistence/Orchestration | sqlite state store に関する仕様・回帰を検証 |
| [tests/staged-adoption.test.ts\](../tests/staged-adoption.test.ts) | Outputs Lifecycle | staged adoption に関する仕様・回帰を検証 |
| [tests/suggest-cleanup-resources.test.ts\](../tests/suggest-cleanup-resources.test.ts) | General/Platform | suggest cleanup resources に関する仕様・回帰を検証 |
| [tests/system-event-manager.test.ts\](../tests/system-event-manager.test.ts) | General/Platform | system event manager に関する仕様・回帰を検証 |
| [tests/test-scaffold-extractor.test.ts\](../tests/test-scaffold-extractor.test.ts) | Core Platform/Tooling | test scaffold extractor に関する仕様・回帰を検証 |
| [tests/token-counter.test.ts\](../tests/token-counter.test.ts) | Observability/Runtime Ops | token counter に関する仕様・回帰を検証 |
| [tests/tool-manifest.test.ts\](../tests/tool-manifest.test.ts) | Core Platform/Tooling | tool manifest に関する仕様・回帰を検証 |
| [tests/trace/tool-recorder-nondeterministic-keys.test.ts\](../tests/trace/tool-recorder-nondeterministic-keys.test.ts) | Tool Trace/Record-Replay | tool recorder nondeterministic keys に関する仕様・回帰を検証 |
| [tests/trace/tool-recorder-record-replay.integration.test.ts\](../tests/trace/tool-recorder-record-replay.integration.test.ts) | Tool Trace/Record-Replay | tool recorder record replay.integration に関する仕様・回帰を検証 |
| [tests/trace/tool-recorder-tenant-isolation.test.ts\](../tests/trace/tool-recorder-tenant-isolation.test.ts) | Tool Trace/Record-Replay | tool recorder tenant isolation に関する仕様・回帰を検証 |
| [tests/tune-prompt-templates.test.ts\](../tests/tune-prompt-templates.test.ts) | Prompt Engine/Quality | tune prompt templates に関する仕様・回帰を検証 |
| [tests/vector-store-large-load.test.ts\](../tests/vector-store-large-load.test.ts) | Vector Store/Embedding | vector store large load に関する仕様・回帰を検証 |
| [tests/vector-store-pgvector.test.ts\](../tests/vector-store-pgvector.test.ts) | Vector Store/Embedding | vector store pgvector に関する仕様・回帰を検証 |
| [tests/vector-store-tfidf-cache.test.ts\](../tests/vector-store-tfidf-cache.test.ts) | Vector Store/Embedding | vector store tfidf cache に関する仕様・回帰を検証 |
