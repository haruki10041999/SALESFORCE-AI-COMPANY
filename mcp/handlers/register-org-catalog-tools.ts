import { join, resolve } from "node:path";
import { getOutputsDir } from "../core/config/runtime-config.js";
import type { GovTool } from "../tool-types.js";
import { defineRegisterOrgTool } from "./org-catalog/register-org.js";
import { defineRemoveOrgTool } from "./org-catalog/remove-org.js";
import { defineListOrgsTool } from "./org-catalog/list-orgs.js";
import { defineGetOrgTool } from "./org-catalog/get-org.js";
import { defineRecordOrgEventTool } from "./org-catalog/record-org-event.js";
import { defineGetOrgTimelineTool } from "./org-catalog/get-org-timeline.js";

export interface RegisterOrgCatalogToolsDeps {
  govTool: GovTool;
  outputsDir?: string;
}

export function registerOrgCatalogTools(deps: RegisterOrgCatalogToolsDeps): void {
  const { govTool } = deps;
  const outputsDir = deps.outputsDir ?? resolve(getOutputsDir());
  const catalogFile = join(outputsDir, "orgs", "catalog.json");
  const timelineDir = join(outputsDir, "org-timeline");

  defineRegisterOrgTool(govTool, catalogFile);
  defineRemoveOrgTool(govTool, catalogFile);
  defineListOrgsTool(govTool, catalogFile);
  defineGetOrgTool(govTool, catalogFile);
  defineRecordOrgEventTool(govTool, timelineDir);
  defineGetOrgTimelineTool(govTool, timelineDir);
}
