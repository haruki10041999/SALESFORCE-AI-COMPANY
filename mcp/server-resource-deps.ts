import { join, relative } from "node:path";
import { createCatalogHelpers } from "./core/context/catalog-helpers.js";
import {
  validateSkillCreation,
  validatePresetCreation,
  validateToolCreation
} from "./core/quality/resource-validation.js";
import type { GovernanceState } from "./core/governance/governance-state.js";
import type { ChatPreset as StoredChatPreset } from "./core/context/preset-store.js";

interface CreateServerResourceDepsInput {
  root: string;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (p: string) => string;
  listPresetsData: () => Promise<StoredChatPreset[]>;
  loadedCustomToolNames: { has: (k: string) => boolean; [Symbol.iterator]: () => IterableIterator<string> };
  listRegisteredToolNames: () => string[];
}

export function createServerResourceDeps(input: CreateServerResourceDepsInput) {
  const {
    root,
    findMdFilesRecursive,
    toPosixPath,
    listPresetsData,
    loadedCustomToolNames,
    listRegisteredToolNames
  } = input;

  const { listSkillsCatalog, listPresetsCatalog, listToolsCatalog, resourceScore } = createCatalogHelpers({
    skillsDir: join(root, "skills"),
    findMdFilesRecursive,
    toPosixPath,
    relative,
    listPresetsData,
    listBuiltinToolCatalog: () => listRegisteredToolNames(),
    loadedCustomToolNames
  });

  async function validateAndCreateSkillWithQuality(
    skillName: string,
    skillContent: string,
    _state: GovernanceState
  ): Promise<{
    success: boolean;
    message: string;
    qualityScore?: number;
    duplicateFound?: boolean;
  }> {
    const existingSkills = await listSkillsCatalog();
    return validateSkillCreation(skillName, skillContent, existingSkills);
  }

  async function validateAndCreatePresetWithQuality(
    presetName: string,
    presetData: {
      description: string;
      agents: string[];
      topic: string;
    },
    _state: GovernanceState
  ): Promise<{
    success: boolean;
    message: string;
    qualityScore?: number;
    duplicateFound?: boolean;
  }> {
    const existingPresets = await listPresetsCatalog();
    return validatePresetCreation(presetName, presetData, existingPresets);
  }

  async function validateAndCreateToolWithQuality(
    toolName: string,
    toolDescription: string,
    state: GovernanceState
  ): Promise<{
    success: boolean;
    message: string;
    qualityScore?: number;
    duplicateFound?: boolean;
  }> {
    const existingTools = listToolsCatalog(state);
    return validateToolCreation(toolName, toolDescription, existingTools);
  }

  return {
    listSkillsCatalog,
    listPresetsCatalog,
    listToolsCatalog,
    resourceScore,
    validateAndCreateSkillWithQuality,
    validateAndCreatePresetWithQuality,
    validateAndCreateToolWithQuality
  };
}
