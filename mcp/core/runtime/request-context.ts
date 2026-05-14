import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  tenantId: string;
  actorId: string;
  traceId: string;
  sessionId?: string;
  reasonCode?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

function normalizeRequestContext(input: RequestContext): RequestContext {
  return {
    tenantId: input.tenantId,
    actorId: input.actorId,
    traceId: input.traceId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {})
  };
}

export function runWithRequestContext<T>(context: RequestContext, operation: () => T): T {
  return requestContextStorage.run(normalizeRequestContext(context), operation);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function requireRequestContext(): RequestContext {
  const context = getRequestContext();
  if (!context) {
    throw new Error("Request context is not available in current async scope");
  }
  return context;
}
