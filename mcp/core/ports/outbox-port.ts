export interface OutboxMessageHeaders {
  idempotencyKey?: string;
  traceId?: string;
  tenantId?: string | null;
  actorId?: string;
  [key: string]: unknown;
}

export interface OutboxEnqueueInput {
  topic: string;
  payload: Record<string, unknown>;
  dedupeKey?: string;
  availableAt?: string;
  maxAttempts?: number;
  headers?: OutboxMessageHeaders;
}

export interface OutboxMessageRecord extends OutboxEnqueueInput {
  id: number;
  attempts: number;
  createdAt: string;
  status: "pending" | "dispatched" | "failed";
  lastError?: string;
  dispatchedAt?: string;
}

export interface OutboxDispatchResult {
  scanned: number;
  dispatched: number;
  failed: number;
}

export interface OutboxPort {
  enqueue(input: OutboxEnqueueInput, options?: { tx?: unknown }): Promise<OutboxMessageRecord>;
  dispatchPending(options?: { limit?: number }): Promise<OutboxDispatchResult>;
  listPending(limit?: number): Promise<OutboxMessageRecord[]>;
  close(): Promise<void>;
}
