export interface ObservabilityPort {
  recordEvent(name: string, payload: Record<string, unknown>): Promise<void>;
}
