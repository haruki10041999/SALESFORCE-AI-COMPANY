/**
 * Replay Tools — TASK-15: Replay Debugger UI
 *
 * Registers MCP tools that expose event-store replay data.
 * All tools are read-only; no writes to event_store.
 *
 * Tools registered:
 *   - replay_list_streams   — list recent event streams
 *   - replay_timeline       — full timeline for a session
 *   - replay_stream_events  — raw events for a specific stream
 *   - replay_stream_diff    — per-event payload diff for a stream
 */

import { z } from "zod";
import { ReplayReader } from "../core/persistence/replay-reader.js";
import type { RegisterGovToolDeps } from "./types.js";

export interface RegisterReplayToolsDeps extends RegisterGovToolDeps {
  /** DATABASE_URL for event store. Omit to disable replay tools. */
  databaseUrl?: string;
}

function makeReader(databaseUrl?: string): ReplayReader | null {
  if (!databaseUrl?.trim()) return null;
  return ReplayReader.create({ databaseUrl: databaseUrl.trim() });
}

export function registerReplayTools(deps: RegisterReplayToolsDeps): void {
  const { govTool, databaseUrl } = deps;
  const reader = makeReader(databaseUrl);

  // ------------------------------------------------------------------
  // replay_list_streams
  // ------------------------------------------------------------------
  govTool(
    "replay_list_streams",
    {
      title: "イベントストリーム一覧",
      description:
        "event_store 内の最近のストリームを一覧表示します。Replay Debugger UI 用の読み取り専用ツールです。",
      inputSchema: {
        prefix: z.string().optional().describe("ストリーム ID プレフィックスフィルター (例: 'session:')"),
        tenantId: z.string().optional().describe("テナント ID フィルター"),
        limit: z.number().int().min(1).max(200).optional().describe("最大件数 (既定: 50)"),
        since: z.string().optional().describe("ISO-8601 日時: この日時以降に更新されたストリームのみ"),
      },
    },
    async (input: { prefix?: string; tenantId?: string; limit?: number; since?: string }) => {
      if (!reader) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "DATABASE_URL not configured — replay tools disabled." }) }],
        };
      }
      const streams = await reader.listStreams({
        prefix: input.prefix,
        tenantId: input.tenantId,
        limit: input.limit,
        since: input.since,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ streams }, null, 2) }],
      };
    }
  );

  // ------------------------------------------------------------------
  // replay_timeline
  // ------------------------------------------------------------------
  govTool(
    "replay_timeline",
    {
      title: "セッション Replay タイムライン",
      description:
        "指定セッション ID に属するすべてのイベントをグローバルシーケンス順に返します。Replay Debugger UI 用。",
      inputSchema: {
        sessionId: z.string().describe("セッション ID"),
        tenantId: z.string().optional().describe("テナント ID フィルター"),
        limit: z.number().int().min(1).max(1000).optional().describe("最大イベント数 (既定: 200)"),
      },
    },
    async (input: { sessionId: string; tenantId?: string; limit?: number }) => {
      if (!reader) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "DATABASE_URL not configured — replay tools disabled." }) }],
        };
      }
      const result = await reader.sessionTimeline(input.sessionId, {
        tenantId: input.tenantId,
        limit: input.limit,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ------------------------------------------------------------------
  // replay_stream_events
  // ------------------------------------------------------------------
  govTool(
    "replay_stream_events",
    {
      title: "ストリームイベント取得",
      description: "指定ストリームの生イベント一覧をバージョン昇順で返します。",
      inputSchema: {
        streamId: z.string().describe("ストリーム ID (例: 'session:abc123')"),
        tenantId: z.string().optional(),
        fromVersion: z.number().int().min(0).optional().describe("開始バージョン (既定: 0)"),
        limit: z.number().int().min(1).max(500).optional(),
        includeDeleted: z.boolean().optional().describe("tombstoned イベントを含めるか (既定: false)"),
      },
    },
    async (input: { streamId: string; tenantId?: string; fromVersion?: number; limit?: number; includeDeleted?: boolean }) => {
      if (!reader) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "DATABASE_URL not configured — replay tools disabled." }) }],
        };
      }
      const events = await reader.readStream(input.streamId, {
        tenantId: input.tenantId,
        fromVersion: input.fromVersion,
        limit: input.limit,
        includeDeleted: input.includeDeleted,
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ streamId: input.streamId, events }, null, 2) }],
      };
    }
  );

  // ------------------------------------------------------------------
  // replay_stream_diff
  // ------------------------------------------------------------------
  govTool(
    "replay_stream_diff",
    {
      title: "ストリーム Payload Diff",
      description:
        "ストリームの各イベント間での payload 差分 (added / removed フィールド) を返します。",
      inputSchema: {
        streamId: z.string().describe("ストリーム ID"),
        tenantId: z.string().optional(),
      },
    },
    async (input: { streamId: string; tenantId?: string }) => {
      if (!reader) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "DATABASE_URL not configured — replay tools disabled." }) }],
        };
      }
      const result = await reader.streamDiff(input.streamId, {
        tenantId: input.tenantId,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
