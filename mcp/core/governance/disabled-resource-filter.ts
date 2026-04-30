import type { GovernedResourceType, GovernanceState, ResourceLifecycle } from "./governance-state.js";

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

  async function getLifecycleResourceSet(
    resourceType: GovernedResourceType,
    lifecycles: ResourceLifecycle[]
  ): Promise<Set<string>> {
    const lifecycleSet = new Set(lifecycles);
    if (lifecycleSet.size === 0) {
      return new Set<string>();
    }

    const state = await loadGovernanceState();
    const entries = Object.entries(state.lifecycle?.[resourceType] ?? {});
    return new Set(
      entries
        .filter(([, lifecycle]) => lifecycleSet.has(lifecycle))
        .map(([name]) => normalizeResourceName(name))
    );
  }

  async function getFilteredResourceSet(
    resourceType: GovernedResourceType,
    excludeLifecycle: ResourceLifecycle[] = ["disabled"]
  ): Promise<Set<string>> {
    const blocked = await getDisabledResourceSet(resourceType);
    const lifecycleBlocked = await getLifecycleResourceSet(resourceType, excludeLifecycle);
    for (const name of lifecycleBlocked) {
      blocked.add(name);
    }
    return blocked;
  }

  async function filterSkillsByLifecycle(
    skillNames: string[],
    options?: { excludeLifecycle?: ResourceLifecycle[] }
  ): Promise<{ enabled: string[]; disabled: string[] }> {
    const disabledSet = await getFilteredResourceSet("skills", options?.excludeLifecycle ?? ["disabled"]);
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

  async function filterDisabledSkills(skillNames: string[]): Promise<{ enabled: string[]; disabled: string[] }> {
    return filterSkillsByLifecycle(skillNames, { excludeLifecycle: ["disabled"] });
  }

  async function isPresetDisabled(
    presetName: string,
    options?: { excludeLifecycle?: ResourceLifecycle[] }
  ): Promise<boolean> {
    const disabledSet = await getFilteredResourceSet("presets", options?.excludeLifecycle ?? ["disabled"]);
    const normalized = normalizeResourceName(presetName);
    return disabledSet.has(normalized);
  }

  return {
    normalizeResourceName,
    getDisabledResourceSet,
    getLifecycleResourceSet,
    getFilteredResourceSet,
    filterSkillsByLifecycle,
    filterDisabledSkills,
    isPresetDisabled
  };
}
