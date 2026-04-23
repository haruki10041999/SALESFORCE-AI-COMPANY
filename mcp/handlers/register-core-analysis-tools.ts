import { z } from "zod";
import { analyzeRepo } from "../tools/repo-analyzer.js";
import { analyzeApex } from "../tools/apex-analyzer.js";
import { analyzeLwc } from "../tools/lwc-analyzer.js";
import { buildDeployCommand } from "../tools/deploy-org.js";
import { buildTestCommand } from "../tools/run-tests.js";
import type { GovTool } from "@mcp/tool-types.js";

export function registerCoreAnalysisTools(govTool: GovTool): void {
  govTool(
    "repo_analyze",
    {
      title: "Repository Analyze",
      description: "Analyze a Salesforce repository and return key file inventories.",
      inputSchema: {
        path: z.string()
      }
    },
    async ({ path }: { path: string }) => {
      const result = analyzeRepo(path);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "apex_analyze",
    {
      title: "Apex Analyze",
      description: "Run simple static checks for an Apex file.",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeApex(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "lwc_analyze",
    {
      title: "LWC Analyze",
      description: "Run simple static checks for an LWC JavaScript file.",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeLwc(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "deploy_org",
    {
      title: "Deploy Org",
      description: "Build deployment command for Salesforce org.",
      inputSchema: {
        targetOrg: z.string(),
        dryRun: z.boolean().optional(),
        sourceDir: z.string().optional(),
        testLevel: z.enum(["NoTestRun", "RunLocalTests", "RunAllTestsInOrg", "RunSpecifiedTests"]).optional(),
        specificTests: z.array(z.string()).optional(),
        wait: z.number().int().min(1).max(120).optional(),
        ignoreWarnings: z.boolean().optional()
      }
    },
    async ({ targetOrg, dryRun, sourceDir, testLevel, specificTests, wait, ignoreWarnings }: {
      targetOrg: string;
      dryRun?: boolean;
      sourceDir?: string;
      testLevel?: "NoTestRun" | "RunLocalTests" | "RunAllTestsInOrg" | "RunSpecifiedTests";
      specificTests?: string[];
      wait?: number;
      ignoreWarnings?: boolean;
    }) => {
      const result = buildDeployCommand({ targetOrg, dryRun, sourceDir, testLevel, specificTests, wait, ignoreWarnings });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "run_tests",
    {
      title: "Run Tests",
      description: "Build Apex test run command.",
      inputSchema: {
        targetOrg: z.string(),
        classNames: z.array(z.string()).optional(),
        suiteName: z.string().optional(),
        wait: z.number().int().min(1).max(120).optional(),
        outputDir: z.string().optional()
      }
    },
    async ({ targetOrg, classNames, suiteName, wait, outputDir }: {
      targetOrg: string;
      classNames?: string[];
      suiteName?: string;
      wait?: number;
      outputDir?: string;
    }) => {
      const command = buildTestCommand({ targetOrg, classNames, suiteName, wait, outputDir });
      return {
        content: [{ type: "text", text: command }]
      };
    }
  );
}

