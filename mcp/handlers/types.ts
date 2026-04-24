import type { GovTool } from "@mcp/tool-types.js";

/**
 * register-*.ts で共通利用する最小 deps 型。
 */
export interface RegisterGovToolDeps {
  govTool: GovTool;
}

export interface ToolMetadata {
  title?: string;
  description?: string;
  tags?: string[];
}
