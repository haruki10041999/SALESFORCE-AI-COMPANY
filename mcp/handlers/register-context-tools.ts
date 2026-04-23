import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";
import type { GovTool } from "@mcp/tool-types.js";

interface RegisterContextToolsDeps {
  govTool: GovTool;
  root: string;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (pathValue: string) => string;
}

export function registerContextTools(deps: RegisterContextToolsDeps): void {
  const { govTool, root, findMdFilesRecursive, toPosixPath } = deps;

  govTool(
    "get_context",
    {
      title: "Get Context",
      description: "Auto-generated description.",
      inputSchema: {}
    },
    async () => {
      const contextDir = join(root, "context");
      if (!existsSync(contextDir)) {
        return {
          content: [{ type: "text", text: "context/ directory does not exist." }]
        };
      }

      const files = findMdFilesRecursive(contextDir);
      const contents = files.map((filePath) => ({
        path: toPosixPath(relative(root, filePath)),
        content: readFileSync(filePath, "utf-8")
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ files: contents.length, contents }, null, 2)
          }
        ]
      };
    }
  );
}


