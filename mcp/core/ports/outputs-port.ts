export interface OutputsPort {
  writeArtifact(path: string, content: string, options?: { contentType?: string }): Promise<void>;
  appendEvent(path: string, event: unknown): Promise<void>;
  readArtifact(path: string): Promise<string | null>;
}
