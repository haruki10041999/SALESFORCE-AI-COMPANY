import { checkForDuplicates } from "./deduplication.js";
import { checkResourceQuality } from "./quality-checker.js";
import { z } from "zod";

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

  // ============================================================
  // 共通 zod スキーマ（全ツールで再利用可能な境界バリデーション）
  // ============================================================

  /** リソース名: 英数字・ハイフン・アンダースコア・日本語 (1-128 文字) */
  export const ResourceNameSchema = z
    .string()
    .min(1, "名前は 1 文字以上必要です")
    .max(128, "名前は 128 文字以内にしてください")
    .regex(/^[a-zA-Z0-9_\-\u3040-\u30ff\u4e00-\u9faf][a-zA-Z0-9_\-\s\u3040-\u30ff\u4e00-\u9faf]*$/, "名前に使用できない文字が含まれています");

  /** 説明文: 最大 1000 文字 */
  export const DescriptionSchema = z
    .string()
    .min(1, "説明は 1 文字以上必要です")
    .max(1000, "説明は 1000 文字以内にしてください");

  /** Salesforce org 識別子: シェルメタ文字禁止 */
  export const OrgIdentifierSchema = z
    .string()
    .min(1, "org 識別子は必須です")
    .max(255)
    .regex(/^[a-zA-Z0-9@._\-]+$/, "org 識別子に使用できない文字が含まれています");

  /** ファイルパス: パストラバーサル禁止 */
  export const SafeFilePathSchema = z
    .string()
    .min(1, "パスは必須です")
    .refine((v) => !v.includes(".."), "パストラバーサル (..) は許可されていません")
    .refine((v) => !/[;&|`$<>"'\n\r]/.test(v), "パスに使用できない文字が含まれています");

  /**
   * 汎用バリデーション実行ヘルパー
   * @returns { success, errors } - errors は空配列なら検証成功
   */
  export function runSchemaValidation<T>(
    schema: z.ZodType<T>,
    value: unknown
  ): { success: boolean; data?: T; errors: string[] } {
    const result = schema.safeParse(value);
    if (result.success) {
      return { success: true, data: result.data, errors: [] };
    }
    return {
      success: false,
      errors: result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`)
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
