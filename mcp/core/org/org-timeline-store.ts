import { existsSync, promises as fsPromises } from "node:fs";
import { dirname, join } from "node:path";
import { FileUnitOfWork } from "../persistence/unit-of-work.js";

export interface OrgTimelineEvent {
  id: string;
  type: string;
  summary: string;
  metadata?: Record<string, unknown>;
  recordedAt: string;
}

export interface RecordOrgTimelineEventInput {
  type: string;
  summary: string;
  metadata?: Record<string, unknown>;
  recordedAt?: string;
}

function toTimelineFilePath(timelineDir: string, alias: string): string {
  return join(timelineDir, `${alias}.jsonl`);
}

async function loadTimelineFile(filePath: string): Promise<OrgTimelineEvent[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line) as OrgTimelineEvent;
        } catch {
          return null;
        }
      })
      .filter((row): row is OrgTimelineEvent => row !== null);
  } catch {
    return [];
  }
}

async function saveTimelineFile(filePath: string, events: OrgTimelineEvent[]): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const payload = events.map((event) => JSON.stringify(event)).join("\n");
  const unitOfWork = new FileUnitOfWork();
  await unitOfWork.stageFileWrite(filePath, payload.length > 0 ? `${payload}\n` : "");
  await unitOfWork.commit();
}

export async function recordOrgTimelineEvent(
  timelineDir: string,
  alias: string,
  input: RecordOrgTimelineEventInput
): Promise<OrgTimelineEvent> {
  const filePath = toTimelineFilePath(timelineDir, alias);
  const events = await loadTimelineFile(filePath);

  const event: OrgTimelineEvent = {
    id: `evt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    summary: input.summary,
    metadata: input.metadata,
    recordedAt: input.recordedAt ?? new Date().toISOString()
  };

  events.push(event);
  await saveTimelineFile(filePath, events);
  return event;
}

export async function getOrgTimelineEvents(
  timelineDir: string,
  alias: string,
  limit = 100
): Promise<OrgTimelineEvent[]> {
  const filePath = toTimelineFilePath(timelineDir, alias);
  const events = await loadTimelineFile(filePath);
  return events.slice(-Math.max(1, limit)).reverse();
}
