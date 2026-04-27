import { join } from "node:path";
import { registerCoreAnalysisTools } from "../../handlers/register-core-analysis-tools.js";
import { registerBranchReviewTools } from "../../handlers/register-branch-review-tools.js";
import { registerOrgCatalogTools } from "../../handlers/register-org-catalog-tools.js";
import { registerProposalQueueTools } from "../../handlers/register-proposal-queue-tools.js";
import { registerResourceCatalogTools } from "../../handlers/register-resource-catalog-tools.js";
import { loadDeclarativeToolsFromDir } from "../declarative/loader.js";
import type { registerAllTools } from "./register-all-tools.js";

type Deps = Parameters<typeof registerAllTools>[0];

/** Analysis / Repository / Org / Proposal / Catalog ドメインを登録する。 */
export function registerAnalysisDomain(deps: Deps): void {
  const {
    govTool,
    listMdFiles,
    getMdFile,
    root,
    presetsDir,
    buildChatPrompt,
    filterDisabledSkills
  } = deps;

  registerCoreAnalysisTools(govTool, {
    listSkillsWithSummary: () => listMdFiles("skills")
  });
  registerBranchReviewTools(govTool);
  registerOrgCatalogTools({ govTool, outputsDir: join(root, "outputs") });
  registerProposalQueueTools({ govTool, outputsDir: join(root, "outputs"), repoRoot: root });

  // Declarative tools (outputs/custom-tools/*.json) を新スキーマで動的登録。
  // 同期 API を維持するため fire-and-forget。loader は例外を内包する。
  void loadDeclarativeToolsFromDir(
    join(root, "outputs", "custom-tools"),
    { govTool, buildChatPrompt, filterDisabledSkills }
  );

  registerResourceCatalogTools({
    govTool,
    listMdFiles,
    getMdFile,
    rootDir: root,
    presetsDir
  });
}
