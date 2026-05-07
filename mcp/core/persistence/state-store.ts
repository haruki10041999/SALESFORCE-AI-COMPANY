export type StateBackend = "sqlite" | "postgres";

export interface GovernanceStateRowRecord {
  stateJson: string;
  updatedAt: string;
}

export interface StateStore {
  getGovernanceStateRow(): Promise<GovernanceStateRowRecord | null>;
  upsertGovernanceStateRow(stateJson: string, updatedAt: string): Promise<void>;
  close(): Promise<void>;
}

export function resolveStateBackend(value: string | undefined): StateBackend {
  return value?.toLowerCase() === "postgres" ? "postgres" : "sqlite";
}
