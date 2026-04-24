import { existsSync, readFileSync } from "fs";
import { join, relative } from "path";
import type { RegisterGovToolDeps } from "./types.js";

interface RegisterContextToolsDeps extends RegisterGovToolDeps {
  root: string;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (pathValue: string) => string;
}

export function registerContextTools(deps: RegisterContextToolsDeps): void {
  const { govTool, root, findMdFilesRecursive, toPosixPath } = deps;

  govTool(
    "get_context",
    {
      title: "コンテキスト取得",
      description: "現在の実行コンテキスト情報を取得します。",
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


