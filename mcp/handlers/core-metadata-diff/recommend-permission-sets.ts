import { z } from "zod";
import { recommendPermissionSets } from "../../tools/recommend-permission-sets.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRecommendPermissionSetsDeps extends RegisterGovToolDeps {}

export function defineRecommendPermissionSetsTool(deps: DefineRecommendPermissionSetsDeps): void {
  const { govTool } = deps;

  govTool(
    "recommend_permission_sets",
    {
      title: "Permission Set推奨",
      description: "最近の利用権限シグナル(Object/Field/Apex)に基づき、最小権限セット候補を推奨します。",
      inputSchema: {
        permissionSetFiles: z.array(z.string()).min(1).max(100),
        usage: z.object({
          objects: z.array(z.string()).optional(),
          fields: z.array(z.string()).optional(),
          apexClasses: z.array(z.string()).optional(),
          systemPermissions: z.array(z.string()).optional()
        }).optional(),
        usageLogFile: z.string().optional(),
        currentPermissionSetFile: z.string().optional(),
        objectAccessLevel: z.enum(["read", "edit", "create", "delete"]).optional(),
        maxRecommendations: z.number().int().min(1).max(50).optional(),
        reportOutputDir: z.string().optional()
      }
    },
    async ({
      permissionSetFiles,
      usage,
      usageLogFile,
      currentPermissionSetFile,
      objectAccessLevel,
      maxRecommendations,
      reportOutputDir
    }: {
      permissionSetFiles: string[];
      usage?: {
        objects?: string[];
        fields?: string[];
        apexClasses?: string[];
        systemPermissions?: string[];
      };
      usageLogFile?: string;
      currentPermissionSetFile?: string;
      objectAccessLevel?: "read" | "edit" | "create" | "delete";
      maxRecommendations?: number;
      reportOutputDir?: string;
    }) => {
      const result = await recommendPermissionSets({
        permissionSetFiles,
        usage,
        usageLogFile,
        currentPermissionSetFile,
        objectAccessLevel,
        maxRecommendations,
        reportOutputDir
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
