export interface GovernanceGate {
  isToolEnabled(toolName: string): Promise<boolean>;
  filterSkills(skillNames: string[]): Promise<{ enabled: string[]; disabled: string[] }>;
}
