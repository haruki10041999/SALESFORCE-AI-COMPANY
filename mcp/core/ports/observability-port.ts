import type { RequestContext } from "../runtime/request-context.js";

export interface ObservabilityPort {
  recordEvent(ctx: RequestContext, name: string, payload: Record<string, unknown>): Promise<void>;
  recordEvent(name: string, payload: Record<string, unknown>): Promise<void>;
}
