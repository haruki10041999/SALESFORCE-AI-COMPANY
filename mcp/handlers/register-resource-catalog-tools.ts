import type { RegisterGovToolDeps } from "./types.js";
import { defineListAgentsTool } from "./resource-catalog/list-agents.js";
import { defineGetAgentTool } from "./resource-catalog/get-agent.js";
import { defineListSkillsTool } from "./resource-catalog/list-skills.js";
import { defineGetSkillTool } from "./resource-catalog/get-skill.js";
import { defineListPersonasTool } from "./resource-catalog/list-personas.js";
import { defineResourceDependencyGraphTool } from "./resource-catalog/resource-dependency-graph.js";

type ListMdFiles = (dir: string) => { name: string; summary: string }[];
type GetMdFile = (dir: string, name: string) => string;

export interface RegisterResourceCatalogToolsDeps extends RegisterGovToolDeps {
  listMdFiles: ListMdFiles;
  getMdFile: GetMdFile;
  rootDir: string;
  presetsDir: string;
}

export function registerResourceCatalogTools(deps: RegisterResourceCatalogToolsDeps): void {
  defineListAgentsTool(deps);
  defineGetAgentTool(deps);
  defineListSkillsTool(deps);
  defineGetSkillTool(deps);
  defineListPersonasTool(deps);
  defineResourceDependencyGraphTool(deps);
}

