/**
 * Resource Suggester
 * 
 * リソース不足を検知した際に、新しいリソースの作成を提案する
 */

import type { GapDetectionResult } from "./resource-gap-detector.js";

export interface ResourceSuggestion {
  action: "create";
  resourceType: "skills" | "tools" | "presets";
  name: string;
  title?: string;
  description?: string;
  content?: string;
  preset?: {
    name: string;
    description: string;
    topic: string;
    agents: string[];
    skills?: string[];
    persona?: string;
    filePaths?: string[];
  };
  reason: string;
  priority: "low" | "medium" | "high";
}

/**
 * リソース不足に対する提案を生成
 */
export function suggestResource(gap: GapDetectionResult): ResourceSuggestion {
  const { resourceType, topic, gapSeverity } = gap;
  
  // ギャップが検知されていない場合のフォールバック
  if (!gap.detected || gapSeverity === "none") {
    return {
      action: "create",
      resourceType,
      name: "auto-resource",
      description: "リソースが不足していません",
      reason: "ギャップなし",
      priority: "low"
    };
  }
  
  // 優先度を決定
  const priority: "low" | "medium" | "high" = 
    gapSeverity === "high" ? "high" :
    gapSeverity === "medium" ? "medium" :
    "low";

  const name = generateResourceName(topic, resourceType);
  
  if (resourceType === "skills") {
    return suggestSkill(topic, name, priority, gapSeverity as "low" | "medium" | "high");
  } else if (resourceType === "tools") {
    return suggestTool(topic, name, priority, gapSeverity as "low" | "medium" | "high");
  } else if (resourceType === "presets") {
    return suggestPreset(topic, name, priority, gapSeverity as "low" | "medium" | "high");
  }

  // フォールバック
  return {
    action: "create",
    resourceType,
    name,
    description: `自動提案: ${topic}`,
    reason: `リソース不足（${gapSeverity}）`,
    priority
  };
}

/**
 * リソース名を生成
 */
function generateResourceName(topic: string, resourceType: string): string {
  // トピックから safe な名前を生成
  const sanitized = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 30);
  
  const timestamp = Date.now().toString(36);
  return `${sanitized}-${timestamp}`;
}

/**
 * スキル提案を生成
 */
function suggestSkill(
  topic: string,
  name: string,
  priority: "low" | "medium" | "high",
  severity: "low" | "medium" | "high"
): ResourceSuggestion {
  const content = generateSkillContent(topic, severity);
  
  return {
    action: "create",
    resourceType: "skills",
    name,
    title: `${topic} スキル`,
    description: `${topic}に関連するスキル定義`,
    content,
    reason: `${topic}の処理に必要なスキルが不足している（${severity}）`,
    priority
  };
}

/**
 * ツール提案を生成
 */
function suggestTool(
  topic: string,
  name: string,
  priority: "low" | "medium" | "high",
  severity: "low" | "medium" | "high"
): ResourceSuggestion {
  const description = `${topic}に対応するカスタムツール`;
  
  return {
    action: "create",
    resourceType: "tools",
    name,
    title: `${topic} Tool`,
    description,
    content: description,
    reason: `${topic}の処理に必要なツールが不足している（${severity}）`,
    priority
  };
}

/**
 * プリセット提案を生成
 */
function suggestPreset(
  topic: string,
  name: string,
  priority: "low" | "medium" | "high",
  severity: "low" | "medium" | "high"
): ResourceSuggestion {
  const preset = generatePresetData(topic);
  
  return {
    action: "create",
    resourceType: "presets",
    name: preset.name,
    description: `${topic}に対応するプリセット`,
    preset,
    reason: `${topic}の処理に必要なプリセットが不足している（${severity}）`,
    priority
  };
}

/**
 * スキル内容テンプレートを生成
 */
function generateSkillContent(topic: string, severity: string): string {
  return `# ${topic} スキル

## 説明
${topic}に関連する専門的なスキル定義です。

## 適用領域
- ${topic}の実装
- 関連の問題解決

## ポイント
1. 主要な実装パターン
2. ベストプラクティス
3. よくある落とし穴

## タグ
\`${topic}\`, \`skill\`, \`auto-generated\`
`;
}

/**
 * プリセットデータを生成
 */
function generatePresetData(topic: string): {
  name: string;
  description: string;
  topic: string;
  agents: string[];
  skills?: string[];
} {
  return {
    name: `${topic} Preset`,
    description: `${topic}処理用の自動生成プリセット`,
    topic,
    agents: ["product-manager", "architect", "qa-engineer"],
    skills: []
  };
}

/**
 * 複数のギャップに対する提案を生成
 */
export function suggestResourcesForGaps(gaps: GapDetectionResult[]): ResourceSuggestion[] {
  return gaps
    .filter((gap) => gap.detected)
    .map((gap) => suggestResource(gap));
}

/**
 * 提案内容の正規化
 */
export function normalizeResourceSuggestion(
  suggestion: ResourceSuggestion
): ResourceSuggestion {
  // 名前をさらに安全にする
  const safeName = suggestion.name
    .toLowerCase()
    .replace(/[^a-z0-9\-]/g, "")
    .replace(/^-+|-+$/g, "") // 先頭・末尾の - を削除
    .slice(0, 50); // 最大長制限

  return {
    ...suggestion,
    name: safeName || "auto-resource"
  };
}
