import type { RegisterGovToolDeps } from "./types.js";
import { defineGetContextTool } from "./lightweight/get-context.js";

export interface RegisterContextToolsDeps extends RegisterGovToolDeps {
  root: string;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (pathValue: string) => string;
}

export function registerContextTools(deps: RegisterContextToolsDeps): void {
  defineGetContextTool(deps);
}


