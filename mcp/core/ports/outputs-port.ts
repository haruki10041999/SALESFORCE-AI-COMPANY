import type { RequestContext } from "../runtime/request-context.js";

export interface OutputsPort {
  writeArtifact(ctx: RequestContext, path: string, content: string, options?: { contentType?: string }): Promise<void>;
  writeArtifact(path: string, content: string, options?: { contentType?: string }): Promise<void>;
  appendEvent(ctx: RequestContext, path: string, event: unknown): Promise<void>;
  appendEvent(path: string, event: unknown): Promise<void>;
  readArtifact(ctx: RequestContext, path: string): Promise<string | null>;
  readArtifact(path: string): Promise<string | null>;
}
