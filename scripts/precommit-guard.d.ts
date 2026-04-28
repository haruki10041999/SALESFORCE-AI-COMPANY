export interface SensitiveDataFinding {
  type: "secret" | "pii";
  label: string;
  value: string;
}

export function scanTextForSensitiveData(content: string, filePath?: string): SensitiveDataFinding[];
export function scanFilesForSensitiveData(files: string[], cwd?: string): string[];
export function getStagedFiles(cwd?: string): string[];
export function runPrecommitGuard(cwd?: string): number;
