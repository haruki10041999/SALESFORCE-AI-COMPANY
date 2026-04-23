import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";
import type { TriggerRule, AgentMessage, OrchestrationSession } from "../core/types/index.js";

interface RegisterChatOrchestrationToolsDeps {
  govTool: GovTool;
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
  orchestrationSessions: Map<string, OrchestrationSession>;
  saveOrchestrationSession: (sessionId: string) => Promise<{ sessionId: string; filePath: string; historyCount: number } | null>;
  saveSessionHistory: (topic: string, entries: AgentMessage[]) => Promise<string>;
  restoreOrchestrationSession: (sessionId: string) => Promise<OrchestrationSession | null>;
  sessionsDir: string;
  readDir: (path: string) => Promise<string[]>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
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
    orchestrationSessions,
    saveOrchestrationSession,
    saveSessionHistory,
    restoreOrchestrationSession,
    sessionsDir,
    readDir,
    readFile
  } = deps;

  async function getSessionOrRestore(sessionId: string): Promise<OrchestrationSession | undefined> {
    const inMemory = orchestrationSessions.get(sessionId);
    if (inMemory) {
      return inMemory;
    }

    const restored = await restoreOrchestrationSession(sessionId);
    return restored ?? undefined;
  }

  govTool(
    "chat",
    {
      title: "Chat (Default)",
      description: "Auto-generated description.",
      inputSchema: chatInputSchema
    },
    runChatTool
  );

  govTool(
    "simulate_chat",
    {
      title: "Simulate Multi-Agent Chat (Compatibility Alias)",
      description: "Auto-generated description.",
      inputSchema: chatInputSchema
    },
    runChatTool
  );

  govTool(
    "orchestrate_chat",
    {
      title: "Orchestrate Chat (Pseudo Hook)",
      description: "Auto-generated description.",
      inputSchema: {
        topic: z.string(),
        filePaths: z.array(z.string()).optional(),
        agents: z.array(z.string()).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        turns: z.number().int().min(1).max(30).optional(),
        triggerRules: z.array(triggerRuleSchema).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional()
      }
    },
    async ({ topic, filePaths, agents, persona, skills, turns, triggerRules, maxContextChars, appendInstruction }: {
      topic: string;
      filePaths?: string[];
      agents?: string[];
      persona?: string;
      skills?: string[];
      turns?: number;
      triggerRules?: TriggerRule[];
      maxContextChars?: number;
      appendInstruction?: string;
    }) => {
      const selectedAgents = agents ?? ["product-manager", "architect", "qa-engineer"];
      const sessionId = generateSessionId();
      const { enabled: enabledSkills, disabled: disabledSkills } = await filterDisabledSkills(skills ?? []);

      await emitSystemEvent("session_start", {
        sessionId,
        topic,
        agents: selectedAgents,
        triggerRuleCount: (triggerRules ?? []).length,
        requestedSkills: skills ?? [],
        enabledSkills,
        disabledSkills
      });

      const prompt = await buildChatPrompt(
        topic,
        selectedAgents,
        persona,
        enabledSkills,
        filePaths ?? [],
        turns ?? 6,
        maxContextChars,
        appendInstruction
      );

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
        queue: [...selectedAgents],
        history: [],
        firedRules: []
      };
      orchestrationSessions.set(sessionId, session);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                sessionId,
                mode: "pseudo-hook",
                nextQueue: session.queue,
                triggerRuleCount: session.triggerRules.length,
                disabledSkills,
                prompt
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
    "evaluate_triggers",
    {
      title: "Evaluate Triggers (Pseudo Hook)",
      description: "Auto-generated description.",
      inputSchema: {
        sessionId: z.string().optional(),
        lastAgent: z.string(),
        lastMessage: z.string(),
        triggerRules: z.array(triggerRuleSchema).optional(),
        fallbackRoundRobin: z.boolean().optional()
      }
    },
    async ({ sessionId, lastAgent, lastMessage, triggerRules, fallbackRoundRobin }: {
      sessionId?: string;
      lastAgent: string;
      lastMessage: string;
      triggerRules?: TriggerRule[];
      fallbackRoundRobin?: boolean;
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

      if (session && (fallbackRoundRobin ?? true) && nextAgents.length === 0 && session.agents.length > 0) {
        const idx = session.agents.indexOf(lastAgent);
        const nextIndex = idx >= 0 ? (idx + 1) % session.agents.length : 0;
        roundRobinNext = session.agents[nextIndex];
        nextAgents = [roundRobinNext];
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
      }

      await emitSystemEvent("turn_complete", {
        sessionId: sessionId ?? null,
        lastAgent,
        nextAgents,
        reasons: hookResult.reasons,
        usedRoundRobinFallback: roundRobinNext !== null,
        queueLength: session ? session.queue.length : null
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
                queueLength: session ? session.queue.length : null
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
      title: "Dequeue Next Agent",
      description: "Auto-generated description.",
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

      const take = limit ?? 1;
      const nextAgents: string[] = [];
      for (let i = 0; i < take; i++) {
        const agent = session.queue.shift();
        if (!agent) {
          break;
        }
        nextAgents.push(agent);
      }

      if (session.queue.length === 0) {
        const savedSession = await saveOrchestrationSession(sessionId);
        const savedHistoryId = session.history.length > 0
          ? await saveSessionHistory(session.topic, session.history)
          : null;

        await emitSystemEvent("session_end", {
          sessionId,
          topic: session.topic,
          reason: "queue-empty",
          historyCount: session.history.length,
          firedRuleCount: session.firedRules.length,
          autoSavedSessionPath: savedSession?.filePath ?? null,
          autoSavedHistoryId: savedHistoryId
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
                remainingQueue: session.queue
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
      title: "Get Orchestration Session",
      description: "Auto-generated description.",
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
      title: "Save Orchestration Session",
      description: "Auto-generated description.",
      inputSchema: {
        sessionId: z.string()
      }
    },
    async ({ sessionId }: { sessionId: string }) => {
      await getSessionOrRestore(sessionId);
      const saved = await saveOrchestrationSession(sessionId);
      if (!saved) {
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
      title: "Restore Orchestration Session",
      description: "Auto-generated description.",
      inputSchema: {
        sessionId: z.string()
      }
    },
    async ({ sessionId }: { sessionId: string }) => {
      const session = await restoreOrchestrationSession(sessionId);
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
      title: "List Orchestration Sessions",
      description: "Auto-generated description.",
      inputSchema: {}
    },
    async () => {
      if (!existsSync(sessionsDir)) {
        return {
          content: [{ type: "text", text: JSON.stringify([], null, 2) }]
        };
      }

      const files = await readDir(sessionsDir);
      const sessions: Array<{
        id: string;
        topic: string;
        agents: string[];
        queueLength: number;
        historyCount: number;
        firedRuleCount: number;
      }> = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(sessionsDir, file), "utf-8");
          const s = JSON.parse(raw) as OrchestrationSession;
          sessions.push({
            id: s.id,
            topic: s.topic,
            agents: s.agents,
            queueLength: s.queue.length,
            historyCount: s.history.length,
            firedRuleCount: s.firedRules.length
          });
        } catch {
          // ignore corrupted session files
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }]
      };
    }
  );
}



