import { registerAllTools as registerAllToolsModule } from "./core/registration/register-all-tools.js";
import { buildRegisterAllToolsDeps } from "./core/registration/register-all-tools-deps.js";

export type RegisterServerToolsOptions = Parameters<typeof buildRegisterAllToolsDeps>[0];

export function registerServerTools(options: RegisterServerToolsOptions): void {
  registerAllToolsModule(buildRegisterAllToolsDeps(options));
}