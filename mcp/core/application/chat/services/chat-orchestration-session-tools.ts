import type { OrchestrationSession } from "../../../types/index.js";
import type { WorkflowEventProjectionSummary } from "../../../../infrastructure/workflow/temporal-workflow-event-projection.js";
import type { SessionSummary } from "../../../persistence/session-store.js";
import {
  buildGetOrchestrationSessionResponse,
  buildRestoreOrchestrationSessionResponseWithProjection,
  buildSaveOrchestrationSessionResponse,
  buildSavedSessionNotFoundText,
  buildSessionNotFoundText
} from "./chat-orchestration-responses.js";

export async function executeGetOrchestrationSessionTool(args: {
  sessionId: string;
  getSessionOrRestore: (sessionId: string) => Promise<OrchestrationSession | undefined>;
  getWorkflowEventProjection?: (sessionId: string) => Promise<WorkflowEventProjectionSummary | undefined>;
}): Promise<{ notFoundText?: string; response?: Record<string, unknown> }> {
  const session = await args.getSessionOrRestore(args.sessionId);
  if (!session) {
    return { notFoundText: buildSessionNotFoundText(args.sessionId) };
  }

  const workflowEventProjection = args.getWorkflowEventProjection
    ? await args.getWorkflowEventProjection(args.sessionId)
    : undefined;

  return {
    response: buildGetOrchestrationSessionResponse({ session, workflowEventProjection })
  };
}

export async function executeSaveOrchestrationSessionTool(args: {
  sessionId: string;
  getSessionOrRestore: (sessionId: string) => Promise<OrchestrationSession | undefined>;
  persistSession: (session: OrchestrationSession) => Promise<{ sessionId: string; filePath: string; historyCount: number }>;
}): Promise<{ notFoundText?: string; response?: Record<string, unknown> }> {
  const session = await args.getSessionOrRestore(args.sessionId);
  if (!session) {
    return { notFoundText: buildSessionNotFoundText(args.sessionId) };
  }

  const saved = await args.persistSession(session);
  return {
    response: buildSaveOrchestrationSessionResponse(saved)
  };
}

export async function executeRestoreOrchestrationSessionTool(args: {
  sessionId: string;
  getById: (sessionId: string) => Promise<OrchestrationSession | null>;
  setLiveSession: (sessionId: string, session: OrchestrationSession) => void;
  getWorkflowEventProjection?: (sessionId: string) => Promise<WorkflowEventProjectionSummary | undefined>;
}): Promise<{ notFoundText?: string; response?: Record<string, unknown> }> {
  const session = await args.getById(args.sessionId);
  if (session) {
    args.setLiveSession(args.sessionId, session);
  }
  if (!session) {
    return { notFoundText: buildSavedSessionNotFoundText(args.sessionId) };
  }

  const workflowEventProjection = args.getWorkflowEventProjection
    ? await args.getWorkflowEventProjection(args.sessionId)
    : undefined;

  return {
    response: buildRestoreOrchestrationSessionResponseWithProjection({
      session,
      workflowEventProjection
    })
  };
}

export async function executeListOrchestrationSessionsTool(args: {
  listSessions: () => Promise<SessionSummary[]>;
  getWorkflowEventProjection?: (sessionId: string) => Promise<WorkflowEventProjectionSummary | undefined>;
}): Promise<Array<SessionSummary & { workflowEventProjection?: WorkflowEventProjectionSummary }>> {
  const sessions = await args.listSessions();
  if (!args.getWorkflowEventProjection) {
    return sessions;
  }

  return Promise.all(
    sessions.map(async (session) => ({
      ...session,
      workflowEventProjection: await args.getWorkflowEventProjection!(session.id)
    }))
  );
}
