import { getRequestContext, type RequestContext } from "./request-context.js";
import type { CostLedgerPort } from "../ports/cost-ledger-port.js";
import type { MemoryService } from "../ports/memory-service.js";
import type { ObservabilityPort } from "../ports/observability-port.js";
import type { OutputsPort } from "../ports/outputs-port.js";

export function withContext<TArgs extends unknown[], TResult>(config: {
  callWithContext: (ctx: RequestContext, ...args: TArgs) => Promise<TResult>;
  callLegacy: (...args: TArgs) => Promise<TResult>;
  resolveContext?: () => RequestContext | undefined;
}): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const ctx = (config.resolveContext ?? getRequestContext)();
    if (ctx) {
      return config.callWithContext(ctx, ...args);
    }
    return config.callLegacy(...args);
  };
}

export function withContextOutputsPort(outputsPort: OutputsPort): {
  writeArtifact(path: string, content: string, options?: { contentType?: string }): Promise<void>;
  appendEvent(path: string, event: unknown): Promise<void>;
  readArtifact(path: string): Promise<string | null>;
} {
  return {
    writeArtifact: withContext({
      callWithContext: (ctx, path, content, options) => outputsPort.writeArtifact(ctx, path, content, options),
      callLegacy: (path, content, options) => outputsPort.writeArtifact(path, content, options)
    }),
    appendEvent: withContext({
      callWithContext: (ctx, path, event) => outputsPort.appendEvent(ctx, path, event),
      callLegacy: (path, event) => outputsPort.appendEvent(path, event)
    }),
    readArtifact: withContext({
      callWithContext: (ctx, path) => outputsPort.readArtifact(ctx, path),
      callLegacy: (path) => outputsPort.readArtifact(path)
    })
  };
}

export function withContextCostLedger(costLedger: CostLedgerPort): {
  record(input: {
    toolName: string;
    costUsd: number;
    inputTokens?: number;
    outputTokens?: number;
    actorId?: string;
    tenantId?: string;
    sessionId?: string;
    traceId?: string;
    model?: string;
    status?: "success" | "error" | "blocked";
    metadata?: Record<string, unknown>;
  }): Promise<void>;
} {
  return {
    record: withContext({
      callWithContext: (ctx, input) => costLedger.record(ctx, input),
      callLegacy: (input) => costLedger.record(input)
    })
  };
}

export function withContextObservability(observability: ObservabilityPort): {
  recordEvent(name: string, payload: Record<string, unknown>): Promise<void>;
} {
  return {
    recordEvent: withContext({
      callWithContext: (ctx, name, payload) => observability.recordEvent(ctx, name, payload),
      callLegacy: (name, payload) => observability.recordEvent(name, payload)
    })
  };
}

export function withContextMemoryService(memoryService: MemoryService): {
  add(text: string): Promise<void>;
  search(query: string): Promise<string[]>;
  list(): Promise<string[]>;
  clear(): Promise<void>;
} {
  return {
    add: withContext({
      callWithContext: (ctx, text) => memoryService.add(ctx, text),
      callLegacy: (text) => memoryService.add(text)
    }),
    search: withContext({
      callWithContext: (ctx, query) => memoryService.search(ctx, query),
      callLegacy: (query) => memoryService.search(query)
    }),
    list: withContext({
      callWithContext: (ctx) => memoryService.list(ctx),
      callLegacy: () => memoryService.list()
    }),
    clear: withContext({
      callWithContext: (ctx) => memoryService.clear(ctx),
      callLegacy: () => memoryService.clear()
    })
  };
}
