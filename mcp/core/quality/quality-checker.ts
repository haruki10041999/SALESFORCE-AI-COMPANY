/**
 * Quality Checker
 * 
 * リソースの品質チェックと基準評価
 */

export interface QualityCheckResult {
  pass: boolean;
  score: number; // 0-100
  errors: QualityError[];
  warnings: QualityWarning[];
  metadata: Record<string, unknown>;
}

export interface QualityError {
  code: string;
  message: string;
  severity: "critical" | "high";
}

export interface QualityWarning {
  code: string;
  message: string;
}

/**
 * スキル品質チェック基準
 */
export const SKILL_QUALITY_REQUIREMENTS = {
  minNameLength: 2,
  maxNameLength: 100,
  minTags: 2,
  minSummaryLength: 10,
  minContentLength: 20 // Markdownの場合
};

/**
 * ツール品質チェック基準
 */
export const TOOL_QUALITY_REQUIREMENTS = {
  minNameLength: 2,
  maxNameLength: 100,
  minDescriptionLength: 10
};

/**
 * プリセット品質チェック基準
 */
export const PRESET_QUALITY_REQUIREMENTS = {
  minNameLength: 2,
  maxNameLength: 100,
  minAgents: 1,
  minDescriptionLength: 5
};

/**
 * スキルの品質をチェック
 */
export function checkSkillQuality(skill: {
  name: string;
  tags?: string[];
  summary?: string;
  content?: string;
}): QualityCheckResult {
  const errors: QualityError[] = [];
  const warnings: QualityWarning[] = [];
  let score = 100;

  // 名前チェック
  if (!skill.name || skill.name.length < SKILL_QUALITY_REQUIREMENTS.minNameLength) {
    errors.push({
      code: "SKILL_NAME_TOO_SHORT",
      message: `スキル名は${SKILL_QUALITY_REQUIREMENTS.minNameLength}文字以上必要です`,
      severity: "critical"
    });
    score -= 20;
  }
  if (skill.name && skill.name.length > SKILL_QUALITY_REQUIREMENTS.maxNameLength) {
    errors.push({
      code: "SKILL_NAME_TOO_LONG",
      message: `スキル名は${SKILL_QUALITY_REQUIREMENTS.maxNameLength}文字以下にしてください`,
      severity: "critical"
    });
    score -= 20;
  }

  // タグチェック
  if (!skill.tags || skill.tags.length < SKILL_QUALITY_REQUIREMENTS.minTags) {
    warnings.push({
      code: "SKILL_INSUFFICIENT_TAGS",
      message: `タグは${SKILL_QUALITY_REQUIREMENTS.minTags}個以上推奨されます`
    });
    score -= 10;
  }

  // サマリー/説明チェック
  const summary = skill.summary || skill.content || "";
  if (summary.length < SKILL_QUALITY_REQUIREMENTS.minSummaryLength) {
    warnings.push({
      code: "SKILL_INSUFFICIENT_DESCRIPTION",
      message: `説明は${SKILL_QUALITY_REQUIREMENTS.minSummaryLength}文字以上推奨されます`
    });
    score -= 15;
  }

  // コンテンツチェック
  if (skill.content && skill.content.length < SKILL_QUALITY_REQUIREMENTS.minContentLength) {
    warnings.push({
      code: "SKILL_INSUFFICIENT_CONTENT",
      message: `コンテンツは${SKILL_QUALITY_REQUIREMENTS.minContentLength}文字以上推奨されます`
    });
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    pass: errors.length === 0,
    score,
    errors,
    warnings,
    metadata: {
      nameLength: skill.name?.length ?? 0,
      tagCount: skill.tags?.length ?? 0,
      summaryLength: (skill.summary || "").length,
      contentLength: (skill.content || "").length
    }
  };
}

/**
 * ツール品質チェック
 */
export function checkToolQuality(tool: {
  name: string;
  description?: string;
}): QualityCheckResult {
  const errors: QualityError[] = [];
  const warnings: QualityWarning[] = [];
  let score = 100;

  // 名前チェック
  if (!tool.name || tool.name.length < TOOL_QUALITY_REQUIREMENTS.minNameLength) {
    errors.push({
      code: "TOOL_NAME_TOO_SHORT",
      message: `ツール名は${TOOL_QUALITY_REQUIREMENTS.minNameLength}文字以上必要です`,
      severity: "critical"
    });
    score -= 30;
  }
  if (tool.name && tool.name.length > TOOL_QUALITY_REQUIREMENTS.maxNameLength) {
    errors.push({
      code: "TOOL_NAME_TOO_LONG",
      message: `ツール名は${TOOL_QUALITY_REQUIREMENTS.maxNameLength}文字以下にしてください`,
      severity: "critical"
    });
    score -= 30;
  }

  // 説明チェック
  if (!tool.description || tool.description.length < TOOL_QUALITY_REQUIREMENTS.minDescriptionLength) {
    warnings.push({
      code: "TOOL_INSUFFICIENT_DESCRIPTION",
      message: `説明は${TOOL_QUALITY_REQUIREMENTS.minDescriptionLength}文字以上推奨されます`
    });
    score -= 20;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    pass: errors.length === 0,
    score,
    errors,
    warnings,
    metadata: {
      nameLength: tool.name?.length ?? 0,
      descriptionLength: (tool.description || "").length
    }
  };
}

/**
 * プリセット品質チェック
 */
export function checkPresetQuality(preset: {
  name: string;
  description?: string;
  agents?: string[];
}): QualityCheckResult {
  const errors: QualityError[] = [];
  const warnings: QualityWarning[] = [];
  let score = 100;

  // 名前チェック
  if (!preset.name || preset.name.length < PRESET_QUALITY_REQUIREMENTS.minNameLength) {
    errors.push({
      code: "PRESET_NAME_TOO_SHORT",
      message: `プリセット名は${PRESET_QUALITY_REQUIREMENTS.minNameLength}文字以上必要です`,
      severity: "critical"
    });
    score -= 30;
  }
  if (preset.name && preset.name.length > PRESET_QUALITY_REQUIREMENTS.maxNameLength) {
    errors.push({
      code: "PRESET_NAME_TOO_LONG",
      message: `プリセット名は${PRESET_QUALITY_REQUIREMENTS.maxNameLength}文字以下にしてください`,
      severity: "critical"
    });
    score -= 30;
  }

  // エージェント数チェック
  if (!preset.agents || preset.agents.length < PRESET_QUALITY_REQUIREMENTS.minAgents) {
    errors.push({
      code: "PRESET_NO_AGENTS",
      message: `プリセットは最低${PRESET_QUALITY_REQUIREMENTS.minAgents}個のエージェントを指定する必要があります`,
      severity: "critical"
    });
    score -= 20;
  }

  // 説明チェック
  if (!preset.description || preset.description.length < PRESET_QUALITY_REQUIREMENTS.minDescriptionLength) {
    warnings.push({
      code: "PRESET_INSUFFICIENT_DESCRIPTION",
      message: `説明は${PRESET_QUALITY_REQUIREMENTS.minDescriptionLength}文字以上推奨されます`
    });
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  return {
    pass: errors.length === 0,
    score,
    errors,
    warnings,
    metadata: {
      nameLength: preset.name?.length ?? 0,
      agentCount: preset.agents?.length ?? 0,
      descriptionLength: (preset.description || "").length
    }
  };
}

/**
 * 汎用品質チェック
 */
export function checkResourceQuality(
  resourceType: "skills" | "tools" | "presets",
  resource: Record<string, unknown>
): QualityCheckResult {
  if (resourceType === "skills") {
    return checkSkillQuality(resource as Parameters<typeof checkSkillQuality>[0]);
  } else if (resourceType === "tools") {
    return checkToolQuality(resource as Parameters<typeof checkToolQuality>[0]);
  } else if (resourceType === "presets") {
    return checkPresetQuality(resource as Parameters<typeof checkPresetQuality>[0]);
  }

  return {
    pass: false,
    score: 0,
    errors: [{ code: "UNKNOWN_RESOURCE_TYPE", message: "未知のリソースタイプ", severity: "critical" }],
    warnings: [],
    metadata: {}
  };
}
