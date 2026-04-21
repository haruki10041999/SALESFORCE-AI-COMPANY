import { join, relative } from "path";
import type { GovernanceState, GovernedResourceType } from "../governance/governance-state.js";
import type { ChatPreset } from "./preset-store.js";

interface CatalogHelpersDeps {
  skillsDir: string;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (p: string) => string;
  relative: (from: string, to: string) => string;
  listPresetsData: () => Promise<ChatPreset[]>;
  builtinToolCatalog: string[];
  loadedCustomToolNames: { has: (k: string) => boolean; [Symbol.iterator]: () => IterableIterator<string> };
}

export function createCatalogHelpers(deps: CatalogHelpersDeps) {
  const {
    skillsDir,
    findMdFilesRecursive,
    toPosixPath,
    relative: relFn,
    listPresetsData,
    builtinToolCatalog,
    loadedCustomToolNames
  } = deps;

  async function listSkillsCatalog(): Promise<string[]> {
    const files = findMdFilesRecursive(skillsDir);
    return files
      .map((f) => toPosixPath(relFn(skillsDir, f)).replace(/\.md$/, ""))
      .sort();
  }

  async function listPresetsCatalog(): Promise<string[]> {
    const presets = await listPresetsData();
    return presets.map((p) => p.name).sort();
  }

  function listToolsCatalog(state: GovernanceState): string[] {
    return [...new Set([
      ...builtinToolCatalog,
      ...loadedCustomToolNames,
      ...Object.keys(state.usage.tools)
    ])].sort();
  }

  function resourceScore(usage: number, bugs: number): number {
    return usage - bugs * 3;
  }

  async function getCatalogCounts(state: GovernanceState): Promise<Record<GovernedResourceType, number>> {
    const skills = await listSkillsCatalog();
    const presets = await listPresetsCatalog();
    const tools = listToolsCatalog(state);
    return {
      skills: skills.length,
      tools: tools.length,
      presets: presets.length
    };
  }

  return { listSkillsCatalog, listPresetsCatalog, listToolsCatalog, resourceScore, getCatalogCounts };
}
