import type { OrchestrationSession } from "../../../types/index.js";
import {
  buildGetOrchestrationSessionResponse,
  buildRestoreOrchestrationSessionResponse,
  buildSaveOrchestrationSessionResponse,
  buildSavedSessionNotFoundText,
  buildSessionNotFoundText
} from "./chat-orchestration-responses.js";

export async function executeGetOrchestrationSessionTool(args: {
  sessionId: string;
  getSessionOrRestore: (sessionId: string) => Promise<OrchestrationSession | undefined>;
}): Promise<{ notFoundText?: string; response?: Record<string, unknown> }> {
  const session = await args.getSessionOrRestore(args.sessionId);
  if (!session) {
    return { notFoundText: buildSessionNotFoundText(args.sessionId) };
  }

  return {
    response: buildGetOrchestrationSessionResponse(session)
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
}): Promise<{ notFoundText?: string; response?: Record<string, unknown> }> {
  const session = await args.getById(args.sessionId);
  if (session) {
    args.setLiveSession(args.sessionId, session);
  }
  if (!session) {
    return { notFoundText: buildSavedSessionNotFoundText(args.sessionId) };
  }

  return {
    response: buildRestoreOrchestrationSessionResponse(session)
  };
}

export async function executeListOrchestrationSessionsTool(args: {
  listSessions: () => Promise<unknown[]>;
}): Promise<unknown[]> {
  return args.listSessions();
}
