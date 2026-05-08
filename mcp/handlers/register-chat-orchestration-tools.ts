import { join } from "node:path";
import { z } from "zod";
import type { TriggerRule, AgentMessage, OrchestrationSession } from "../core/types/index.js";
import type { SessionStore } from "../core/persistence/session-store.js";
import type { OrchestrationQueueStore } from "../core/orchestration/orchestration-queue-store.js";
import type { OrchestrationJobRunner } from "../core/orchestration/job-runner.js";
import type { PolicySnapshotManager } from "../core/learning/policy-snapshot.js";
import type { RegisterGovToolDeps } from "./types.js";
import {
  evaluateAgentTrust,
  rankEscalationCandidates
} from "../core/quality/agent-trust-score.js";
import {
  getAgentTrustScoringEnabled,
  getAgentTrustThreshold
} from "../core/config/runtime-config.js";
import { endTrace, failTrace, startTrace, withPhase } from "../core/trace/trace-context.js";
import { buildDagExecutionLayers, type DagNode } from "../core/orchestration/dag-engine.js";
import {
  buildAgentTransitionModel,
  loadAgentGraphRecords,
  recommendNextAgents,
  recordAgentSequence
} from "../core/learning/agent-graph-learner.js";
import {
  computeAgentReputationScore,
  loadAgentReputationRecords
} from "../core/learning/agent-reputation.js";
import { scoreByQuery } from "../core/resource/topic-skill-ranking.js";

interface RegisterChatOrchestrationToolsDeps extends RegisterGovToolDeps {
  chatInputSchema: Record<string, unknown>;
  triggerRuleSchema: z.ZodTypeAny;
  runChatTool: (input: {
    topic: string;
    filePaths?: string[];
    agents?: string[];
    persona?: string;
    skills?: string[];
    turns?: number;
    maxContextChars?: number;
    appendInstruction?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  generateSessionId: () => string;
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: (
    topic: string,
    agentNames: string[],
    personaName: string | undefined,
    skillNames: string[],
    filePaths: string[],
    turns: number,
    maxContextChars?: number,
    appendInstruction?: string
  ) => Promise<string>;
  evaluatePseudoHooks: (
    lastAgent: string,
    lastMessage: string,
    triggerRules: TriggerRule[],
    firedRules: string[]
  ) => { nextAgents: string[]; fired: string[]; reasons: string[] };
  /** Durable session store (Postgres or SQLite). Replaces the former in-memory Map + 3 callbacks. */
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
  /** T-07: Online policy snapshot for posterior-based reranking */
  policySnapshotManager?: PolicySnapshotManager;
  saveSessionHistory: (topic: string, entries: AgentMessage[]) => Promise<string>;
  onSessionCompleted?: (input: {
    sessionId: string;
    topic: string;
    history: AgentMessage[];
  }) => Promise<{ entities: number; relations: number } | null>;
  outputsDir: string;
}

export function registerChatOrchestrationTools(deps: RegisterChatOrchestrationToolsDeps): void {
  const {
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    evaluatePseudoHooks,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    policySnapshotManager,
    saveSessionHistory,
    onSessionCompleted,
    outputsDir
  } = deps;

  // In-process cache for active sessions (avoids repeated DB reads during a single orchestration)
  const liveSessionCache = new Map<string, OrchestrationSession>();

  async function persistSession(session: OrchestrationSession): Promise<{ sessionId: string; filePath: string; historyCount: number }> {
    await sessionStore.upsert(session, -1);
    return {
      sessionId: session.id,
      filePath: `store://orchestration_sessions/${session.id}`,
      historyCount: Array.isArray(session.history) ? session.history.length : 0
    };
  }
  const agentGraphFile = join(outputsDir, "agent-graph.jsonl");
  const agentReputationFile = join(outputsDir, "agent-reputation.jsonl");

  async function prioritizeQueueByPolicy(queue: string[], topic: string): Promise<{ ordered: string[]; snapshotVersion: number | null }> {
    if (queue.length <= 1) {
      return { ordered: queue, snapshotVersion: policySnapshotManager?.current?.version ?? null };
    }

    // ── T-07: live mode → use online posterior from PolicySnapshotManager ──
    if (policySnapshotManager?.isLive && policySnapshotManager.current) {
      const repScores = policySnapshotManager.reputationScores(queue, topic);
      const topicScores = new Map<string, number>(queue.map(a => [a, scoreByQuery(topic, a)]));
      const maxTopicScore = Math.max(0, ...Array.from(topicScores.values()));
      const ordered = [...queue].sort((a, b) => {
        const repDiff = (repScores.get(b) ?? 0.5) - (repScores.get(a) ?? 0.5);
        if (Math.abs(repDiff) > 1e-9) { return repDiff; }
        const topicNorm = maxTopicScore > 0 ? 1 / maxTopicScore : 1;
        const topicDiff = (topicScores.get(b) ?? 0) * topicNorm - (topicScores.get(a) ?? 0) * topicNorm;
        if (topicDiff !== 0) { return topicDiff; }
        return a.localeCompare(b);
      });
      return { ordered, snapshotVersion: policySnapshotManager.current.version };
    }

    // ── shadow / no snapshot: legacy reputation + topic scoring ──
    const reputationRecords = await loadAgentReputationRecords(agentReputationFile);
    const topicScores = new Map<string, number>();
    for (const agent of queue) {
      topicScores.set(agent, scoreByQuery(topic, agent));
    }
    const maxTopicScore = Math.max(0, ...Array.from(topicScores.values()));

    const priority = (agent: string): number => {
      const reputation = computeAgentReputationScore(reputationRecords, agent, "global", "global", 0.5);
      const topicRelevance = maxTopicScore > 0
        ? (topicScores.get(agent) ?? 0) / maxTopicScore
        : 1;
      return reputation * topicRelevance;
    };

    const ordered = [...queue].sort((a, b) => {
      const pDiff = priority(b) - priority(a);
      if (Math.abs(pDiff) > 1e-9) {
        return pDiff;
      }
      const topicDiff = (topicScores.get(b) ?? 0) - (topicScores.get(a) ?? 0);
      if (topicDiff !== 0) {
        return topicDiff;
      }
      // deterministic fallback when both priority and topic relevance are tied
      return a.localeCompare(b);
    });
    return { ordered, snapshotVersion: null };
  }

  async function getSessionOrRestore(sessionId: string): Promise<OrchestrationSession | undefined> {
    const cached = liveSessionCache.get(sessionId);
    if (cached) {
      return cached;
    }
    const fromStore = await sessionStore.getById(sessionId);
    if (fromStore) {
      await orchestrationQueueStore.replace(sessionId, fromStore.queue);
      liveSessionCache.set(sessionId, fromStore);
    }
    return fromStore ?? undefined;
  }

  govTool(
    "chat",
    {
      title: "チャット（デフォルト）",
      description: "既定設定でチャットを実行します。",
      inputSchema: chatInputSchema
    },
    runChatTool
  );

  govTool(
    "simulate_chat",
    {
      title: "マルチエージェントチャット実行（互換エイリアス）",
      description: "互換エイリアスとしてマルチエージェントチャットを実行します。",
      inputSchema: chatInputSchema
    },
    runChatTool
  );

  govTool(
    "orchestrate_chat",
    {
      title: "オーケストレーションチャット（疑似フック）",
      description: "疑似フックを使ったオーケストレーションチャットを実行します。",
      inputSchema: {
        topic: z.string(),
        filePaths: z.array(z.string()).optional(),
        agents: z.array(z.string()).optional(),
        dagNodes: z.array(
          z.object({
            id: z.string().min(1),
            dependsOn: z.array(z.string().min(1)).optional()
          })
        ).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        turns: z.number().int().min(1).max(30).optional(),
        triggerRules: z.array(triggerRuleSchema).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional()
      }
    },
    async ({ topic, filePaths, agents, dagNodes, persona, skills, turns, triggerRules, maxContextChars, appendInstruction }: {
      topic: string;
      filePaths?: string[];
      agents?: string[];
      dagNodes?: DagNode[];
      persona?: string;
      skills?: string[];
      turns?: number;
      triggerRules?: TriggerRule[];
      maxContextChars?: number;
      appendInstruction?: string;
    }) => {
      const selectedAgents = dagNodes && dagNodes.length > 0
        ? [...new Set(dagNodes.map((node) => node.id))]
        : (agents ?? ["product-manager", "architect", "qa-engineer"]);
      const dagLayers = dagNodes && dagNodes.length > 0
        ? buildDagExecutionLayers(dagNodes)
        : [];
      const initialQueue = dagLayers.length > 0 ? dagLayers.flat() : [...selectedAgents];
      const sessionId = generateSessionId();
      // TASK-038: orchestrate_chat の phase 分解
      const traceId = startTrace("orchestrate_chat", {
        agent: selectedAgents[0],
        skills,
        topic
      });
      try {
        const { enabled: enabledSkills, disabled: disabledSkills } = await withPhase(
          traceId,
          "input",
          () => filterDisabledSkills(skills ?? [])
        );

        await withPhase(traceId, "plan", async () => {
          await emitSystemEvent("session_start", {
            sessionId,
            topic,
            agents: selectedAgents,
            triggerRuleCount: (triggerRules ?? []).length,
            requestedSkills: skills ?? [],
            enabledSkills,
            disabledSkills
          });
        });

        const prompt = await withPhase(traceId, "execute", () =>
          buildChatPrompt(
            topic,
            selectedAgents,
            persona,
            enabledSkills,
            filePaths ?? [],
            turns ?? 6,
            maxContextChars,
            appendInstruction
          )
        );

        const response = await withPhase(traceId, "render", async () => {
          const session: OrchestrationSession = {
            id: sessionId,
            topic,
            appendInstruction,
            agents: selectedAgents,
            persona,
            skills: enabledSkills,
            filePaths: filePaths ?? [],
            turns: turns ?? 6,
            triggerRules: triggerRules ?? [],
            queue: initialQueue,
            history: [],
            firedRules: [],
            dag: dagLayers.length > 0
              ? {
                enabled: true,
                nodes: dagNodes ?? [],
                layers: dagLayers
              }
              : undefined,
            agentTrust: {}
          };
          liveSessionCache.set(sessionId, session);
          // Persist to durable store immediately so it survives a crash
          await sessionStore.upsert(session, -1);
          await orchestrationQueueStore.replace(sessionId, session.queue);
          for (const [stepIndex, agent] of session.queue.entries()) {
            await orchestrationJobRunner.enqueueStep({
              sessionId,
              stepIndex,
              agent,
              payload: {
                topic,
                persona,
                skills: enabledSkills,
                filePaths: filePaths ?? []
              },
              checkpoint: {
                queueLength: session.queue.length,
                mode: dagLayers.length > 0 ? "dag" : "linear"
              }
            });
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    sessionId,
                    mode: "pseudo-hook",
                    orchestrationMode: dagLayers.length > 0 ? "dag" : "linear",
                    nextQueue: session.queue,
                    queueProgress: {
                      total: session.queue.length,
                      executed: 0,
                      remaining: session.queue.length,
                      currentAgent: session.queue[0] ?? null
                    },
                    triggerRuleCount: session.triggerRules.length,
                    dagLayers: dagLayers.length > 0 ? dagLayers : undefined,
                    disabledSkills,
                    prompt
                  },
                  null,
                  2
                )
              }
            ]
          };
        });

        endTrace(traceId, { agentCount: selectedAgents.length });
        return response;
      } catch (err) {
        failTrace(traceId, err);
        throw err;
      }
    }
  );

  govTool(
    "evaluate_triggers",
    {
      title: "トリガー評価（疑似フック）",
      description: "疑似フックのトリガールールを評価します。",
      inputSchema: {
        sessionId: z.string().optional(),
        lastAgent: z.string(),
        lastMessage: z.string(),
        triggerRules: z.array(triggerRuleSchema).optional(),
        fallbackRoundRobin: z.boolean().optional(),
        enableTrustScoring: z.boolean().optional(),
        trustThreshold: z.number().min(0).max(1).optional(),
        agentFeedback: z.enum(["accept", "reject", "neutral"]).optional(),
        maxEscalations: z.number().int().min(1).max(3).optional()
      }
    },
    async ({ sessionId, lastAgent, lastMessage, triggerRules, fallbackRoundRobin, enableTrustScoring, trustThreshold, agentFeedback, maxEscalations }: {
      sessionId?: string;
      lastAgent: string;
      lastMessage: string;
      triggerRules?: TriggerRule[];
      fallbackRoundRobin?: boolean;
      enableTrustScoring?: boolean;
      trustThreshold?: number;
      agentFeedback?: "accept" | "reject" | "neutral";
      maxEscalations?: number;
    }) => {
      let rules = triggerRules ?? [];
      let session: OrchestrationSession | undefined;
      let firedRules: string[] = [];
      let roundRobinNext: string | null = null;

      if (sessionId) {
        session = await getSessionOrRestore(sessionId);
        if (!session) {
          return {
            content: [{ type: "text", text: "Session not found: " + sessionId }]
          };
        }
        if (rules.length === 0) {
          rules = session.triggerRules;
        }
        firedRules = session.firedRules;
      }

      const hookResult = evaluatePseudoHooks(lastAgent, lastMessage, rules, firedRules);
      let nextAgents = [...hookResult.nextAgents];
      let escalatedAgents: string[] = [];
      const trustScoringEnabled = enableTrustScoring ?? getAgentTrustScoringEnabled();
      const effectiveThreshold = trustThreshold ?? getAgentTrustThreshold();
      let trustTraceId: string | null = null;
      let trustEvaluation: ReturnType<typeof evaluateAgentTrust> | null = null;

      if (session && (fallbackRoundRobin ?? true) && nextAgents.length === 0 && session.agents.length > 0) {
        const idx = session.agents.indexOf(lastAgent);
        const nextIndex = idx >= 0 ? (idx + 1) % session.agents.length : 0;
        roundRobinNext = session.agents[nextIndex];
        nextAgents = [roundRobinNext];
      }

      if (session) {
        const currentTrust = session.agentTrust[lastAgent] ?? {
          accepted: 0,
          rejected: 0,
          feedbackSignal: 0
        };

        if (agentFeedback === "accept") {
          currentTrust.accepted += 1;
          currentTrust.feedbackSignal = Math.min(1, currentTrust.feedbackSignal + 0.25);
        } else if (agentFeedback === "reject") {
          currentTrust.rejected += 1;
          currentTrust.feedbackSignal = Math.max(-1, currentTrust.feedbackSignal - 0.25);
        } else if (nextAgents.length > 0) {
          currentTrust.accepted += 1;
        } else {
          currentTrust.rejected += 1;
        }

        if (trustScoringEnabled) {
          trustTraceId = startTrace("agent_trust_evaluation", {
            sessionId: session.id,
            lastAgent
          });
          try {
            trustEvaluation = evaluateAgentTrust({
              topic: session.topic,
              message: lastMessage,
              history: {
                accepted: currentTrust.accepted,
                rejected: currentTrust.rejected
              },
              feedbackSignal: currentTrust.feedbackSignal,
              threshold: effectiveThreshold
            });

            if (trustEvaluation.belowThreshold && session.agents.length > 1) {
              const ranked = rankEscalationCandidates(
                session.agents,
                session.topic,
                lastMessage,
                [lastAgent, ...nextAgents]
              );
              const escalations = ranked.slice(0, maxEscalations ?? 1);
              if (escalations.length > 0) {
                escalatedAgents = escalations;
                nextAgents = [...nextAgents, ...escalations];
              }
            }

            endTrace(trustTraceId, {
              sessionId: session.id,
              lastAgent,
              trustScore: trustEvaluation.score,
              trustThreshold: trustEvaluation.threshold,
              belowThreshold: trustEvaluation.belowThreshold,
              factors: trustEvaluation.factors,
              escalatedAgents
            });
          } catch (error) {
            failTrace(trustTraceId, error);
          }
        }

        session.agentTrust[lastAgent] = currentTrust;
      }

      if (session) {
        session.history.push({
          agent: lastAgent,
          message: lastMessage,
          timestamp: new Date().toISOString(),
          topic: session.topic
        });
        session.firedRules.push(...hookResult.fired);
        for (const nextAgent of nextAgents) {
          session.queue.push(nextAgent);
        }
        await orchestrationQueueStore.replace(session.id, session.queue);
        const currentMaxStep = session.history.length + session.queue.length - nextAgents.length;
        for (const [offset, nextAgent] of nextAgents.entries()) {
          await orchestrationJobRunner.enqueueStep({
            sessionId: session.id,
            stepIndex: currentMaxStep + offset,
            agent: nextAgent,
            payload: {
              triggeredBy: lastAgent,
              reason: hookResult.reasons[offset] ?? null
            },
            checkpoint: {
              queueLength: session.queue.length,
              firedRules: session.firedRules.length
            }
          });
        }
        await sessionStore.upsert(session, -1);
      }

      await emitSystemEvent("turn_complete", {
        sessionId: sessionId ?? null,
        lastAgent,
        nextAgents,
        reasons: hookResult.reasons,
        usedRoundRobinFallback: roundRobinNext !== null,
        queueLength: session ? session.queue.length : null,
        trustScoring: trustEvaluation
          ? {
            enabled: true,
            score: trustEvaluation.score,
            threshold: trustEvaluation.threshold,
            belowThreshold: trustEvaluation.belowThreshold,
            reasons: trustEvaluation.reasons,
            escalatedAgents
          }
          : {
            enabled: trustScoringEnabled,
            escalatedAgents
          }
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sessionId: sessionId ?? null,
                nextAgents,
                reasons: hookResult.reasons,
                usedRoundRobinFallback: roundRobinNext !== null,
                queueLength: session ? session.queue.length : null,
                trustScoring: trustEvaluation
                  ? {
                    enabled: true,
                    score: trustEvaluation.score,
                    threshold: trustEvaluation.threshold,
                    belowThreshold: trustEvaluation.belowThreshold,
                    reasons: trustEvaluation.reasons,
                    escalatedAgents
                  }
                  : {
                    enabled: trustScoringEnabled,
                    escalatedAgents
                  }
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "dequeue_next_agent",
    {
      title: "次エージェント取り出し",
      description: "セッションキューから次に実行するエージェントを取得します。",
      inputSchema: {
        sessionId: z.string(),
        limit: z.number().int().min(1).max(10).optional()
      }
    },
    async ({ sessionId, limit }: { sessionId: string; limit?: number }) => {
      const session = await getSessionOrRestore(sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: "Session not found: " + sessionId }]
        };
      }

      let graphRecommendation: {
        fromAgent: string;
        recommendedAgent: string;
        probability: number;
      } | null = null;

      const lastAgentInHistory = session.history.at(-1)?.agent;
      const executedApprox = Math.max(0, session.agents.length - session.queue.length);
      const fallbackFromAgent = executedApprox > 0
        ? session.agents[Math.min(session.agents.length - 1, executedApprox - 1)]
        : undefined;
      const fromAgent = lastAgentInHistory ?? fallbackFromAgent;
      if (fromAgent && session.queue.length > 0) {
        const graphRecords = await loadAgentGraphRecords(agentGraphFile);
        const graphModel = buildAgentTransitionModel(graphRecords);
        const recommendations = recommendNextAgents({
          model: graphModel,
          fromAgent,
          candidates: session.queue,
          limit: 1
        });
        const top = recommendations[0];
        if (top) {
          const idx = session.queue.findIndex((agent) => agent === top.to);
          if (idx > 0) {
            const [selected] = session.queue.splice(idx, 1);
            session.queue.unshift(selected);
          }
          graphRecommendation = {
            fromAgent: top.from,
            recommendedAgent: top.to,
            probability: top.probability
          };
        }
      }

      let snapshotVersion: number | null = null;
      if (session.queue.length > 1) {
        const result = await prioritizeQueueByPolicy(session.queue, session.topic);
        session.queue = result.ordered;
        snapshotVersion = result.snapshotVersion;
      }

      await orchestrationQueueStore.replace(session.id, session.queue);

      const take = limit ?? 1;
      const nextAgents = await orchestrationQueueStore.dequeue(session.id, take);
      for (const agent of nextAgents) {
        await orchestrationJobRunner.markDequeued(session.id, agent);
      }
      for (const agent of nextAgents) {
        const index = session.queue.indexOf(agent);
        if (index >= 0) {
          session.queue.splice(index, 1);
        }
      }

      await sessionStore.upsert(session, -1);

      for (const agent of nextAgents) {
        await orchestrationJobRunner.completeLatestRunningStep({
          sessionId: session.id,
          agent,
          output: {
            dequeued: true,
            remainingQueue: session.queue.length
          },
          checkpoint: {
            queueLength: session.queue.length,
            currentAgent: agent
          }
        });
      }

      if (session.queue.length === 0) {
        const learned = await recordAgentSequence(agentGraphFile, {
          sessionId,
          sequence: session.history.map((item) => item.agent),
          success: true
        });
        const savedSession = await persistSession(session);
        liveSessionCache.delete(sessionId);
        await orchestrationQueueStore.clear(sessionId);
        const savedHistoryId = session.history.length > 0
          ? await saveSessionHistory(session.topic, session.history)
          : null;
        const knowledgeGraph = onSessionCompleted
          ? await onSessionCompleted({
            sessionId,
            topic: session.topic,
            history: session.history
          })
          : null;

        await emitSystemEvent("session_end", {
          sessionId,
          topic: session.topic,
          reason: "queue-empty",
          historyCount: session.history.length,
          firedRuleCount: session.firedRules.length,
          graphLearned: learned !== null,
          autoSavedSessionPath: savedSession?.filePath ?? null,
          autoSavedHistoryId: savedHistoryId,
          knowledgeGraph
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sessionId,
                dequeued: nextAgents,
                remainingQueue: session.queue,
                graphRecommendation,
                snapshotVersion,
                queueProgress: {
                  total: session.agents.length,
                  executed: session.agents.length - session.queue.length,
                  remaining: session.queue.length,
                  currentAgent: nextAgents[0] ?? null,
                  nextAgent: session.queue[0] ?? null
                }
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "get_orchestration_session",
    {
      title: "オーケストレーションセッション取得",
      description: "オーケストレーションセッションの状態を取得します。",
      inputSchema: {
        sessionId: z.string()
      }
    },
    async ({ sessionId }: { sessionId: string }) => {
      const session = await getSessionOrRestore(sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: "Session not found: " + sessionId }]
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: session.id,
                topic: session.topic,
                agents: session.agents,
                queue: session.queue,
                triggerRules: session.triggerRules,
                historyCount: session.history.length,
                firedRuleCount: session.firedRules.length
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "save_orchestration_session",
    {
      title: "オーケストレーションセッション保存",
      description: "オーケストレーションセッションを保存します。",
      inputSchema: {
        sessionId: z.string()
      }
    },
    async ({ sessionId }: { sessionId: string }) => {
      const session = await getSessionOrRestore(sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: "Session not found: " + sessionId }]
        };
      }
      const saved = await persistSession(session);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                saved: true,
                sessionId: saved.sessionId,
                filePath: saved.filePath,
                historyCount: saved.historyCount
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "restore_orchestration_session",
    {
      title: "オーケストレーションセッション復元",
      description: "保存済みオーケストレーションセッションを復元します。",
      inputSchema: {
        sessionId: z.string()
      }
    },
    async ({ sessionId }: { sessionId: string }) => {
      const session = await sessionStore.getById(sessionId);
      if (session) {
        liveSessionCache.set(sessionId, session);
      }
      if (!session) {
        return {
          content: [{ type: "text", text: "Saved session not found: " + sessionId }]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                restored: true,
                id: session.id,
                topic: session.topic,
                queueLength: session.queue.length,
                historyCount: session.history.length,
                firedRuleCount: session.firedRules.length
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "list_orchestration_sessions",
    {
      title: "オーケストレーションセッション一覧",
      description: "オーケストレーションセッションの一覧を取得します。",
      inputSchema: {}
    },
    async () => {
      const sessions = await sessionStore.list();

      return {
        content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }]
      };
    }
  );
}



