export type EventStoredStatus = "active" | "tombstoned";

export interface DomainEvent {
  /** Stream identifier – e.g. "proposal:uuid" or "session:uuid" */
  streamId: string;
  /** Domain event type – e.g. "proposal.approved", "session.started" */
  eventType: string;
  /** Optimistic concurrency version (0-based position within the stream). */
  version: number;
  tenantId?: string | null;
  actorId?: string;
  payload: Record<string, unknown>;
  /** ISO-8601. Defaults to now() when omitted on append. */
  occurredAt?: string;
}

export interface StoredEvent extends DomainEvent {
  id: number;
  globalSeq: number;
  occurredAt: string;
  status: EventStoredStatus;
}

export interface AppendEventInput {
  streamId: string;
  eventType: string;
  /** Expected current version of the stream for optimistic concurrency. */
  expectedVersion: number;
  tenantId?: string | null;
  actorId?: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}

export interface ReadEventsOptions {
  fromVersion?: number;
  toVersion?: number;
  limit?: number;
  tenantId?: string | null;
}

export interface SubscribeOptions {
  fromGlobalSeq?: number;
  tenantId?: string | null;
  eventTypes?: string[];
}

export type EventHandler = (event: StoredEvent) => void | Promise<void>;

export interface EventStore {
  /**
   * Append an event to a stream.
   * Throws `OptimisticConcurrencyError` if expectedVersion doesn't match current stream version.
   */
  append(input: AppendEventInput): Promise<StoredEvent>;

  /**
   * Read events from a stream, ordered by version ascending.
   */
  read(streamId: string, options?: ReadEventsOptions): Promise<StoredEvent[]>;

  /**
   * Subscribe to new events (live tail). Returns an unsubscribe function.
   */
  subscribe(handler: EventHandler, options?: SubscribeOptions): () => void;

  /**
   * Tombstone (soft-delete) an event. Payload is cleared; row remains for chain integrity.
   */
  tombstone(id: number): Promise<void>;
}

export class OptimisticConcurrencyError extends Error {
  constructor(
    public readonly streamId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Optimistic concurrency conflict on stream '${streamId}': ` +
        `expected version ${expectedVersion}, actual ${actualVersion}`
    );
    this.name = "OptimisticConcurrencyError";
  }
}
