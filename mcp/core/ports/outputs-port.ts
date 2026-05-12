export interface OutputsPort {
  writeArtifact(path: string, content: string): Promise<void>;
  appendEvent(path: string, event: Record<string, unknown>): Promise<void>;
  readArtifact(path: string): Promise<string | null>;
}
