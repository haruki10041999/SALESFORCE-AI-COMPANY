import { operationsCommands } from "./commands/operations.js";
import { runtimeCommands } from "./commands/runtime.js";
import type { CliCommand } from "./types.js";

export const COMMANDS: Record<string, CliCommand> = {
  ...runtimeCommands,
  ...operationsCommands
};

export const CLI_EXAMPLES: string[] = [
  "  npm run ai -- dev",
  "  npm run ai -- outputs:cleanup -- --dry-run",
  "  npm run ai -- observability:dashboard -- --trace-limit 100",
  "  npm run ai -- learning:replay -- --limit 20",
  "  npm run ai -- replay -- --session sess-42",
  "  npm run ai -- evals:run -- --suite agent-selection --ci",
  "  npm run ai -- evals:run -- --save-baseline",
  "  npm run ai -- migrate:tenant-scope -- --tenant tenant-a --dry-run",
  "  npx sf-ai dev",
  "  npx sf-ai evals:run -- --ci"
];
