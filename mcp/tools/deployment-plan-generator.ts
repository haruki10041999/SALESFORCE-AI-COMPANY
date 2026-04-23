import { summarizeDeploymentImpact, type DeploymentImpactInput } from "./deployment-impact-summary.js";

export type DeploymentPlanInput = DeploymentImpactInput & {
  targetOrg?: string;
};

export type DeploymentPlanResult = {
  comparison: string;
  riskLevel: "low" | "medium" | "high";
  recommendedOrder: string[];
  preChecks: string[];
  deployCommandPreview: string;
  postChecks: string[];
  rollbackHints: string[];
  cautions: string[];
};

function riskFromImpact(input: {
  deletions: number;
  metadataBreakdown: Record<string, number>;
}): "low" | "medium" | "high" {
  const sensitive = (input.metadataBreakdown.PermissionSet ?? 0)
    + (input.metadataBreakdown.Profile ?? 0)
    + (input.metadataBreakdown.Flow ?? 0)
    + (input.metadataBreakdown.ApexTrigger ?? 0);

  if (input.deletions >= 3 || sensitive >= 6) return "high";
  if (input.deletions >= 1 || sensitive >= 3) return "medium";
  return "low";
}

export function generateDeploymentPlan(input: DeploymentPlanInput): DeploymentPlanResult {
  const impact = summarizeDeploymentImpact(input);
  const riskLevel = riskFromImpact({
    deletions: impact.deletions,
    metadataBreakdown: impact.metadataBreakdown
  });

  const recommendedOrder = [
    "1) 権限・設定メタデータ (PermissionSet/Profile)",
    "2) データモデル (CustomObject/CustomField)",
    "3) 実装 (ApexClass/ApexTrigger/LWC)",
    "4) 自動化 (Flow)",
    "5) レイアウト・補助設定"
  ];

  const preChecks = [
    "対象 org のバックアップ/スナップショットを取得",
    "変更対象メタデータの依存関係を確認",
    "削除差分がある場合は影響オブジェクト一覧を作成",
    "RunLocalTests 以上での検証計画を作成"
  ];

  const targetOrg = input.targetOrg ?? "<target-org>";
  const deployCommandPreview = [
    "sf project deploy start",
    `--target-org ${targetOrg}`,
    "--source-dir force-app",
    "--test-level RunLocalTests",
    "--wait 33"
  ].join(" ");

  const postChecks = [
    "Apex テスト結果を確認 (失敗/カバレッジ)",
    "Flow の起動条件・重複自動化を検証",
    "権限差分に伴うユーザー操作テストを実施",
    "主要業務シナリオのスモークテストを実施"
  ];

  const rollbackHints = [
    "直前コミットを基準に逆差分デプロイ手順を用意",
    "削除メタデータは復元用マニフェストを事前生成",
    "高リスク変更は段階リリース (機能フラグ/順次配備) を採用"
  ];

  return {
    comparison: impact.comparison,
    riskLevel,
    recommendedOrder,
    preChecks,
    deployCommandPreview,
    postChecks,
    rollbackHints,
    cautions: impact.cautions
  };
}
