import { z } from "zod";
import { generateApexChangelog } from "../../tools/apex-changelog.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineApexChangelogDeps extends RegisterGovToolDeps {}

export function defineApexChangelogTool(deps: DefineApexChangelogDeps): void {
  const { govTool } = deps;

  govTool(
    "apex_changelog",
    {
      title: "Apex Changelog 生成",
      description: "git 比較 (baseRef..headRef) から Apex / LWC / Flow / PermissionSet の変更をカテゴリ別に集計し、人間向け Markdown changelog と JSON を返します。",
      inputSchema: {
        repoPath: z.string(),
        baseRef: z.string(),
        headRef: z.string().optional(),
        maxCommits: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ repoPath, baseRef, headRef, maxCommits }: {
      repoPath: string;
      baseRef: string;
      headRef?: string;
      maxCommits?: number;
    }) => {
      const result = generateApexChangelog({ repoPath, baseRef, headRef, maxCommits });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
