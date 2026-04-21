import type { GovernedResourceType, GovernanceState } from "./governance-state.js";

interface CreateDisabledResourceFilterDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
  toPosixPath: (value: string) => string;
}

export function createDisabledResourceFilter(deps: CreateDisabledResourceFilterDeps) {
  const { loadGovernanceState, toPosixPath } = deps;

  function normalizeResourceName(name: string): string {
    return toPosixPath(name).replace(/\.md$/, "").toLowerCase();
  }

  async function getDisabledResourceSet(resourceType: GovernedResourceType): Promise<Set<string>> {
    const state = await loadGovernanceState();
    return new Set((state.disabled[resourceType] ?? []).map((x) => normalizeResourceName(x)));
  }

  async function filterDisabledSkills(skillNames: string[]): Promise<{ enabled: string[]; disabled: string[] }> {
    const disabledSet = await getDisabledResourceSet("skills");
    if (skillNames.length === 0 || disabledSet.size === 0) {
      return { enabled: skillNames, disabled: [] };
    }

    const enabled: string[] = [];
    const disabled: string[] = [];

    for (const skillName of skillNames) {
      const normalized = normalizeResourceName(skillName);
      const baseName = normalized.split("/").pop() ?? normalized;
      const matched = disabledSet.has(normalized) || disabledSet.has(baseName);
      if (matched) {
        disabled.push(skillName);
        continue;
      }
      enabled.push(skillName);
    }

    return { enabled, disabled };
  }

  async function isPresetDisabled(presetName: string): Promise<boolean> {
    const disabledSet = await getDisabledResourceSet("presets");
    const normalized = normalizeResourceName(presetName);
    return disabledSet.has(normalized);
  }

  return {
    normalizeResourceName,
    getDisabledResourceSet,
    filterDisabledSkills,
    isPresetDisabled
  };
}
