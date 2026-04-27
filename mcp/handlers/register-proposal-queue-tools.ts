import { z } from "zod";
import { resolve } from "node:path";
import {
  enqueueProposal,
  listProposals,
  getProposal,
  approveProposal,
  rejectProposal,
  summarizeProposalQueue,
  type ProposalResourceType,
  type ProposalStatus
} from "../core/resource/proposal/queue.js";
import { applyProposal } from "../core/resource/proposal/applier.js";
import {
  evaluateAutoCreateGate,
  countTodayApplied,
  DEFAULT_AUTO_CREATE_CONFIG,
  type AutoCreateConfig,
  type AutoCreatePolicy
} from "../core/resource/proposal/auto-create-gate.js";
import type { GovTool } from "../tool-types.js";

export interface RegisterProposalQueueToolsDeps {
  govTool: GovTool;
  outputsDir?: string;
  repoRoot?: string;
}

const RESOURCE_TYPE = z.enum(["skills", "tools", "presets"]);
const STATUS = z.enum(["pending", "approved", "rejected"]);

export function registerProposalQueueTools(deps: RegisterProposalQueueToolsDeps): void {
  const { govTool } = deps;
  const outputsDir = deps.outputsDir ?? (process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : resolve("outputs"));
  const repoRoot = deps.repoRoot ?? resolve(".");

  govTool(
    "enqueue_proposal",
    {
      title: "リソース提案キューへ追加",
      description: "新規 skill / tool / preset の作成提案を outputs/tool-proposals/pending/ に永続化します。承認は approve_proposal、却下は reject_proposal で行います。",
      inputSchema: {
        resourceType: RESOURCE_TYPE,
        name: z.string().min(1).max(128),
        content: z.string().min(1),
        confidence: z.number().min(0).max(1).optional(),
        sourceEvent: z.string().min(1).max(128).optional(),
        origin: z.string().min(1).max(128).optional()
      }
    },
    async ({ resourceType, name, content, confidence, sourceEvent, origin }: {
      resourceType: ProposalResourceType;
      name: string;
      content: string;
      confidence?: number;
      sourceEvent?: string;
      origin?: string;
    }) => {
      const record = enqueueProposal(outputsDir, { resourceType, name, content, confidence, sourceEvent, origin });
      return { content: [{ type: "text", text: JSON.stringify({ enqueued: record }, null, 2) }] };
    }
  );

  govTool(
    "list_proposals",
    {
      title: "リソース提案一覧",
      description: "保留 / 承認済 / 却下済の提案を一覧します。status を省略すると全状態を返します。",
      inputSchema: {
        status: STATUS.optional(),
        resourceType: RESOURCE_TYPE.optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ status, resourceType, limit }: { status?: ProposalStatus; resourceType?: ProposalResourceType; limit?: number }) => {
      const items = listProposals(outputsDir, { status, resourceType, limit });
      const summary = summarizeProposalQueue(outputsDir);
      return { content: [{ type: "text", text: JSON.stringify({ summary, items }, null, 2) }] };
    }
  );

  govTool(
    "get_proposal",
    {
      title: "提案詳細取得",
      description: "ID で提案 1 件の詳細を返します。状態を問わず検索します。",
      inputSchema: {
        id: z.string().min(1).max(128)
      }
    },
    async ({ id }: { id: string }) => {
      const record = getProposal(outputsDir, id);
      return { content: [{ type: "text", text: JSON.stringify({ found: record !== null, record }, null, 2) }] };
    }
  );

  govTool(
    "approve_proposal",
    {
      title: "提案を承認 (適用準備)",
      description: "保留中の提案を approved/ に移動します。実際のリソース作成は別途 apply_resource_actions / create_preset を呼び出してください。",
      inputSchema: {
        id: z.string().min(1).max(128)
      }
    },
    async ({ id }: { id: string }) => {
      const record = approveProposal(outputsDir, id);
      return { content: [{ type: "text", text: JSON.stringify({ approved: record }, null, 2) }] };
    }
  );

  govTool(
    "reject_proposal",
    {
      title: "提案を却下",
      description: "保留中の提案を rejected/ に移動します。理由は監査ログとしてレコードに記録されます。",
      inputSchema: {
        id: z.string().min(1).max(128),
        reason: z.string().min(1).max(500)
      }
    },
    async ({ id, reason }: { id: string; reason: string }) => {
      const record = rejectProposal(outputsDir, id, reason);
      return { content: [{ type: "text", text: JSON.stringify({ rejected: record }, null, 2) }] };
    }
  );

  govTool(
    "apply_proposal",
    {
      title: "提案を承認＋実適用",
      description: "保留中の提案を approved/ に移動し、リソースタイプに応じた保存先 (skills/<name>.md, outputs/custom-tools/<slug>.json, outputs/presets/<slug>/v<n>.json) へ書き出します。overwrite=false の場合、既存ファイルがあれば適用をスキップします。",
      inputSchema: {
        id: z.string().min(1).max(128),
        overwrite: z.boolean().optional()
      }
    },
    async ({ id, overwrite }: { id: string; overwrite?: boolean }) => {
      const record = getProposal(outputsDir, id);
      if (!record) {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `proposal not found: ${id}` }, null, 2) }] };
      }
      if (record.status !== "pending") {
        return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: `proposal status is ${record.status}; only pending can be applied` }, null, 2) }] };
      }
      const applyResult = applyProposal(record, { repoRoot, outputsDir, overwrite: overwrite === true });
      const moved = applyResult.applied ? approveProposal(outputsDir, id) : record;
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: applyResult.applied, applyResult, record: moved }, null, 2) }]
      };
    }
  );

  govTool(
    "auto_apply_pending_proposals",
    {
      title: "保留提案の自動承認バッチ",
      description: "pending の提案を AutoCreateGate (resourceType ごとの enabled / threshold / maxPerDay) で評価し、通過したものだけを自動適用します。既定はすべて OFF (明示 opt-in が必要)。dryRun=true で適用せずに判定だけ確認できます。",
      inputSchema: {
        config: z.object({
          skills: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1), maxPerDay: z.number().int().min(0) }).optional(),
          tools: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1), maxPerDay: z.number().int().min(0) }).optional(),
          presets: z.object({ enabled: z.boolean(), threshold: z.number().min(0).max(1), maxPerDay: z.number().int().min(0) }).optional()
        }).optional(),
        denyList: z.array(z.object({
          resourceType: RESOURCE_TYPE,
          name: z.string().min(1).max(128)
        })).optional(),
        dryRun: z.boolean().optional(),
        overwrite: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ config, denyList, dryRun, overwrite, limit }: {
      config?: Partial<Record<ProposalResourceType, AutoCreatePolicy>>;
      denyList?: Array<{ resourceType: ProposalResourceType; name: string }>;
      dryRun?: boolean;
      overwrite?: boolean;
      limit?: number;
    }) => {
      const merged: AutoCreateConfig = {
        skills:  { ...DEFAULT_AUTO_CREATE_CONFIG.skills,  ...(config?.skills  ?? {}) },
        tools:   { ...DEFAULT_AUTO_CREATE_CONFIG.tools,   ...(config?.tools   ?? {}) },
        presets: { ...DEFAULT_AUTO_CREATE_CONFIG.presets, ...(config?.presets ?? {}) }
      };
      const approvedHistory = listProposals(outputsDir, { status: "approved" });
      const todayAppliedCount = countTodayApplied(approvedHistory);
      const pending = listProposals(outputsDir, { status: "pending", limit: limit ?? 50 });

      const decisions: Array<{
        id: string;
        resourceType: ProposalResourceType;
        name: string;
        confidence: number;
        allow: boolean;
        reasonCode?: string;
        reason?: string;
        applied?: boolean;
        filePath?: string;
      }> = [];

      let appliedCount = 0;
      for (const proposal of pending) {
        const decision = evaluateAutoCreateGate({ proposal, config: merged, todayAppliedCount, denyList });
        const entry: typeof decisions[number] = {
          id: proposal.id,
          resourceType: proposal.resourceType,
          name: proposal.name,
          confidence: proposal.confidence,
          allow: decision.allow,
          reasonCode: decision.reasonCode,
          reason: decision.reason
        };
        if (decision.allow) {
          if (dryRun === true) {
            entry.applied = false;
            entry.reason = "dry-run";
          } else {
            const r = applyProposal(proposal, { repoRoot, outputsDir, overwrite: overwrite === true });
            entry.applied = r.applied;
            entry.filePath = r.filePath;
            if (r.applied) {
              approveProposal(outputsDir, proposal.id);
              todayAppliedCount[proposal.resourceType] = (todayAppliedCount[proposal.resourceType] ?? 0) + 1;
              appliedCount += 1;
            } else {
              entry.reason = r.reason;
            }
          }
        }
        decisions.push(entry);
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            dryRun: dryRun === true,
            scanned: pending.length,
            applied: appliedCount,
            todayAppliedCountAfter: todayAppliedCount,
            decisions
          }, null, 2)
        }]
      };
    }
  );
}
