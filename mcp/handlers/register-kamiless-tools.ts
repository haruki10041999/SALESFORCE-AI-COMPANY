import { readdirSync, statSync, promises as fsPromises } from "fs";
import { dirname, join, basename, resolve } from "path";
import { z } from "zod";
import {
  generateKamilessExport,
  generateKamilessSpecFromRequirements
} from "../tools/kamiless-export-generator.js";

type GovTool = (name: string, config: any, handler: any) => void;

interface RegisterKamilessToolsDeps {
  govTool: GovTool;
  root: string;
}

export function registerKamilessTools(deps: RegisterKamilessToolsDeps): void {
  const { govTool, root } = deps;

  govTool(
    "generate_kamiless_from_requirements",
    {
      title: "Generate Kamiless From Requirements",
      description:
        "テスト要件テキストを読み取り、*.kamiless.json を自動生成します。" +
        " diff や変更要約も加味して要件を広げ、export JSON まで続けて生成することもできます。",
      inputSchema: {
        requirementsText: z
          .string()
          .optional()
          .describe("要件本文。箇条書き、セクション見出し、項目一覧を含むテキスト"),
        requirementsPath: z
          .string()
          .optional()
          .describe("要件テキストファイルへのパス。requirementsText 未指定時に使用"),
        diffText: z
          .string()
          .optional()
          .describe("git diff や変更差分テキスト。追加行から項目候補を抽出して要件を広げる"),
        diffPath: z
          .string()
          .optional()
          .describe("diff テキストファイルへのパス。diffText 未指定時に使用"),
        specOutputPath: z
          .string()
          .optional()
          .describe("生成する *.kamiless.json の出力先。省略時は outputs/generated.kamiless.json"),
        exportOutputPath: z
          .string()
          .optional()
          .describe("続けて export JSON も生成する場合の出力先"),
        formName: z.string().optional(),
        title: z.string().optional(),
        defaultObjectName: z.string().optional()
      }
    },
    async ({ requirementsText, requirementsPath, diffText, diffPath, specOutputPath, exportOutputPath, formName, title, defaultObjectName }: {
      requirementsText?: string;
      requirementsPath?: string;
      diffText?: string;
      diffPath?: string;
      specOutputPath?: string;
      exportOutputPath?: string;
      formName?: string;
      title?: string;
      defaultObjectName?: string;
    }) => {
      let rawText = requirementsText;
      let rawDiffText = diffText;

      if (!rawText && requirementsPath) {
        rawText = await fsPromises.readFile(resolve(requirementsPath), "utf-8");
      }

      if (!rawDiffText && diffPath) {
        rawDiffText = await fsPromises.readFile(resolve(diffPath), "utf-8");
      }

      if (!rawText) {
        return {
          content: [
            {
              type: "text",
              text: "## エラー\n\nrequirementsText または requirementsPath を指定してください。"
            }
          ]
        };
      }

      let specResult;
      try {
        specResult = generateKamilessSpecFromRequirements({
          requirementsText: rawText,
          diffText: rawDiffText,
          formName,
          title,
          defaultObjectName
        });
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `## エラー\n\n${(err as Error).message}`
            }
          ]
        };
      }

      const finalSpecPath = specOutputPath
        ? resolve(specOutputPath)
        : join(root, "outputs", `${specResult.spec.name}.kamiless.json`);

      await fsPromises.mkdir(dirname(finalSpecPath), { recursive: true });
      await fsPromises.writeFile(finalSpecPath, specResult.json, "utf-8");

      let exportSummary = "";
      if (exportOutputPath) {
        const exportResult = await generateKamilessExport(finalSpecPath);
        await fsPromises.mkdir(dirname(resolve(exportOutputPath)), { recursive: true });
        await fsPromises.writeFile(resolve(exportOutputPath), exportResult.json, "utf-8");
        exportSummary = [
          "",
          "### Export JSON",
          `- 出力: ${resolve(exportOutputPath)}`,
          `- FormLayout: ${exportResult.stats.layoutCount}`,
          `- FormPart: ${exportResult.stats.formPartCount}`,
          `- TargetField: ${exportResult.stats.targetFieldCount}`
        ].join("\n");
      }

      const skipped = specResult.skippedLines.length > 0
        ? `\n### 未解釈行\n${specResult.skippedLines.map((line: string) => `- ${line}`).join("\n")}`
        : "";

      return {
        content: [
          {
            type: "text",
            text: [
              "## Kamiless Spec 自動生成結果",
              "",
              `- spec 出力: ${finalSpecPath}`,
              `- セクション: ${specResult.stats.sectionCount}`,
              `- 項目: ${specResult.stats.fieldCount}`,
              `- FormPart: ${specResult.stats.partCount}`,
              `- diff 候補行: ${specResult.stats.diffCandidateCount}`,
              `- スキップ行: ${specResult.stats.skippedLineCount}`,
              exportSummary,
              skipped
            ].join("\n")
          }
        ]
      };
    }
  );

  govTool(
    "generate_kamiless_export",
    {
      title: "Generate Kamiless Export",
      description:
        "kamiless.json オーサリング仕様ファイルから Docutize Form export JSON を生成します。" +
        " specPath または specDir を指定します。どちらも省略した場合はプロジェクトルート配下を検索して一覧を返します。",
      inputSchema: {
        specPath: z
          .string()
          .optional()
          .describe("*.kamiless.json ファイルへの絶対パスまたは相対パス。省略可"),
        specDir: z
          .string()
          .optional()
          .describe("*.kamiless.json を検索するディレクトリパス。省略時は specPath を使用"),
        outputPath: z
          .string()
          .optional()
          .describe("出力先ファイルパス (省略時はレスポンスに JSON を直接返します)")
      }
    },
    async ({ specPath, specDir, outputPath }: { specPath?: string; specDir?: string; outputPath?: string }) => {
      let targetPaths: string[] = [];

      if (specPath) {
        targetPaths = [resolve(specPath)];
      } else {
        const scanRoot = specDir ? resolve(specDir) : root;

        const findKamiless = (dir: string): string[] => {
          const found: string[] = [];
          let entries: string[];
          try {
            entries = readdirSync(dir);
          } catch {
            return found;
          }
          for (const entry of entries) {
            if (entry === "node_modules" || entry.startsWith(".")) continue;
            const full = join(dir, entry);
            let stat;
            try {
              stat = statSync(full);
            } catch {
              continue;
            }
            if (stat.isDirectory()) {
              found.push(...findKamiless(full));
            } else if (entry.endsWith(".kamiless.json")) {
              found.push(full);
            }
          }
          return found;
        };

        targetPaths = findKamiless(scanRoot);

        if (targetPaths.length === 0) {
          return {
            content: [{
              type: "text",
              text: `## ファイルが見つかりません\n\n\`${scanRoot}\` 配下に \`*.kamiless.json\` が存在しません。\n\`specPath\` または \`specDir\` を指定してください。`
            }]
          };
        }

        if (targetPaths.length > 1) {
          const list = targetPaths.map((pathValue, index) => `${index + 1}. \`${pathValue}\``).join("\n");
          return {
            content: [{
              type: "text",
              text: `## *.kamiless.json が複数見つかりました\n\n${list}\n\n\`specPath\` で対象ファイルを指定して再実行してください。`
            }]
          };
        }
      }

      const results: string[] = [];

      for (const sp of targetPaths) {
        let result;
        try {
          result = await generateKamilessExport(sp);
        } catch (err) {
          results.push(`## エラー (${sp})\n\n${(err as Error).message}`);
          continue;
        }

        const destination = outputPath ?? join(dirname(sp), basename(sp, ".kamiless.json") + "-export.json");
        await fsPromises.writeFile(destination, result.json, "utf-8");

        results.push([
          "## Kamiless Export 生成結果",
          "",
          `**入力**: \`${sp}\``,
          `**出力**: \`${destination}\``,
          `**FormTemplate ID**: \`${result.idMap.formTemplate}\``,
          "",
          "### 統計",
          "| 項目 | 件数 |",
          "|------|------|",
          `| FormLayout | ${result.stats.layoutCount} |`,
          `| FormPart | ${result.stats.formPartCount} |`,
          `| TargetFieldSection | ${result.stats.targetFieldSectionCount} |`,
          `| TargetField | ${result.stats.targetFieldCount} |`,
          `| 画像 | ${result.stats.imageCount} |`
        ].join("\n"));
      }

      return {
        content: [{ type: "text", text: results.join("\n\n---\n\n") }]
      };
    }
  );
}
