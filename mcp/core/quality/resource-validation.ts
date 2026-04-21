import { checkForDuplicates } from "./deduplication.js";
import { checkResourceQuality } from "./quality-checker.js";

export interface ResourceValidationResult {
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}

export function validateSkillCreation(
  skillName: string,
  skillContent: string,
  existingSkillNames: string[]
): ResourceValidationResult {
  const duplicateCheck = checkForDuplicates(
    {
      name: skillName,
      summary: skillContent.slice(0, 200)
    },
    existingSkillNames.map((name) => ({ name })),
    0.8
  );
  if (duplicateCheck.isDuplicate) {
    return {
      success: false,
      message: `類似スキルが存在: ${duplicateCheck.similarResources[0]?.name ?? skillName}`,
      duplicateFound: true
    };
  }

  const qualityCheck = checkResourceQuality("skills", {
    name: skillName,
    summary: skillContent.slice(0, 100),
    content: skillContent
  });

  if (!qualityCheck.pass) {
    return {
      success: false,
      message: `品質チェック失敗: ${qualityCheck.errors.map((e) => e.message).join(", ")}`,
      qualityScore: qualityCheck.score
    };
  }

  return {
    success: true,
    message: "検証成功",
    qualityScore: qualityCheck.score
  };
}

export function validatePresetCreation(
  presetName: string,
  presetData: { description: string; agents: string[] },
  existingPresetNames: string[]
): ResourceValidationResult {
  const duplicateCheck = checkForDuplicates(
    {
      name: presetName,
      description: presetData.description
    },
    existingPresetNames.map((name) => ({ name })),
    0.8
  );
  if (duplicateCheck.isDuplicate) {
    return {
      success: false,
      message: `類似プリセットが存在: ${duplicateCheck.similarResources[0]?.name ?? presetName}`,
      duplicateFound: true
    };
  }

  const qualityCheck = checkResourceQuality("presets", {
    name: presetName,
    description: presetData.description,
    agents: presetData.agents
  });

  if (!qualityCheck.pass) {
    return {
      success: false,
      message: `品質チェック失敗: ${qualityCheck.errors.map((e) => e.message).join(", ")}`,
      qualityScore: qualityCheck.score
    };
  }

  return {
    success: true,
    message: "検証成功",
    qualityScore: qualityCheck.score
  };
}

export function validateToolCreation(
  toolName: string,
  toolDescription: string,
  existingToolNames: string[]
): ResourceValidationResult {
  const duplicateCheck = checkForDuplicates(
    {
      name: toolName,
      description: toolDescription
    },
    existingToolNames.map((name) => ({ name })),
    0.8
  );
  if (duplicateCheck.isDuplicate) {
    return {
      success: false,
      message: `類似ツールが存在: ${duplicateCheck.similarResources[0]?.name ?? toolName}`,
      duplicateFound: true
    };
  }

  const qualityCheck = checkResourceQuality("tools", {
    name: toolName,
    description: toolDescription
  });

  if (!qualityCheck.pass) {
    return {
      success: false,
      message: `品質チェック失敗: ${qualityCheck.errors.map((e) => e.message).join(", ")}`,
      qualityScore: qualityCheck.score
    };
  }

  return {
    success: true,
    message: "検証成功",
    qualityScore: qualityCheck.score
  };
}
