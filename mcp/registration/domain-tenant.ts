import type { registerAllTools } from "../core/registration/register-all-tools.js";
import { registerTenantLifecycleTools } from "../handlers/tenant/tenant-lifecycle-tools.js";

type Deps = Parameters<typeof registerAllTools>[0];

export function registerTenantDomain(deps: Deps): void {
  registerTenantLifecycleTools({
    govTool: deps.govTool,
    root: deps.root
  });
}
