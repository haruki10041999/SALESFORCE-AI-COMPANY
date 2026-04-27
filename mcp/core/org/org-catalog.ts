/**
 * A1: ãƒãƒ«ãƒãƒ†ãƒŠãƒ³ãƒˆ Org ã‚«ã‚¿ãƒ­ã‚°
 *
 * è¤‡æ•°ã® Salesforce Org ãƒ¡ã‚¿ãƒ‡ãƒ¼ã‚¿ã‚’ä¸€å…ƒç®¡ç†ã™ã‚‹ãŸã‚ã®ãƒ‡ãƒ¼ã‚¿å±¤ã€‚
 * å‰¯ä½œç”¨ (ãƒ•ã‚¡ã‚¤ãƒ« I/O) ã¯å‘¼ã³å‡ºã—å´ãŒæ‹…å½“ã™ã‚‹ç´”ç²‹é–¢æ•°ç¾¤ã‚’æä¾›ã™ã‚‹ã€‚
 *
 * ã‚«ã‚¿ãƒ­ã‚°æ§‹é€ :
 * {
 *   version: 1,
 *   updatedAt: ISO,
 *   orgs: [
 *     { alias, instanceUrl, type: "production" | "sandbox" | "scratch",
 *       tags?: string[], notes?: string, registeredAt: ISO,
 *       lastSeenAt?: ISO, metadata?: { ... } }
 *   ]
 * }
 */

export const ORG_CATALOG_VERSION = 1;

export type OrgType = "production" | "sandbox" | "scratch" | "developer";

export interface OrgEntry {
  alias: string;
  instanceUrl: string;
  type: OrgType;
  tags?: string[];
  notes?: string;
  registeredAt: string;
  lastSeenAt?: string;
  metadata?: Record<string, unknown>;
}

export interface OrgCatalog {
  version: number;
  updatedAt: string;
  orgs: OrgEntry[];
}

export interface OrgUpsertInput {
  alias: string;
  instanceUrl: string;
  type: OrgType;
  tags?: string[];
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface OrgListFilter {
  type?: OrgType;
  tag?: string;
  query?: string;
}

const ALIAS_PATTERN = /^[A-Za-z0-9._\-]{1,64}$/;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

export function buildEmptyOrgCatalog(now: Date = new Date()): OrgCatalog {
  return {
    version: ORG_CATALOG_VERSION,
    updatedAt: now.toISOString(),
    orgs: []
  };
}

export function validateOrgInput(input: OrgUpsertInput): string[] {
  const errs: string[] = [];
  if (!ALIAS_PATTERN.test(input.alias ?? "")) errs.push(`invalid-alias:${input.alias}`);
  if (!URL_PATTERN.test(input.instanceUrl ?? "")) errs.push(`invalid-instanceUrl`);
  const validTypes: OrgType[] = ["production", "sandbox", "scratch", "developer"];
  if (!validTypes.includes(input.type)) errs.push(`invalid-type:${input.type}`);
  if (input.tags) {
    for (const tag of input.tags) {
      if (typeof tag !== "string" || tag.length === 0 || tag.length > 64) {
        errs.push(`invalid-tag:${tag}`);
      }
    }
  }
  return errs;
}

function normaliseCatalog(catalog: OrgCatalog | null | undefined, now: Date): OrgCatalog {
  if (!catalog || !Array.isArray(catalog.orgs)) {
    return buildEmptyOrgCatalog(now);
  }
  return {
    version: ORG_CATALOG_VERSION,
    updatedAt: catalog.updatedAt ?? now.toISOString(),
    orgs: catalog.orgs.filter((o) => o && typeof o.alias === "string")
  };
}

export function upsertOrg(
  catalog: OrgCatalog | null,
  input: OrgUpsertInput,
  now: Date = new Date()
): { catalog: OrgCatalog; entry: OrgEntry; created: boolean; errors: string[] } {
  const errors = validateOrgInput(input);
  const safe = normaliseCatalog(catalog, now);
  if (errors.length > 0) {
    return { catalog: safe, entry: { ...input, registeredAt: now.toISOString() } as OrgEntry, created: false, errors };
  }

  const idx = safe.orgs.findIndex((o) => o.alias === input.alias);
  let created = false;
  let entry: OrgEntry;
  if (idx === -1) {
    entry = {
      alias: input.alias,
      instanceUrl: input.instanceUrl,
      type: input.type,
      tags: input.tags,
      notes: input.notes,
      metadata: input.metadata,
      registeredAt: now.toISOString(),
      lastSeenAt: now.toISOString()
    };
    safe.orgs.push(entry);
    created = true;
  } else {
    const prev = safe.orgs[idx];
    entry = {
      ...prev,
      instanceUrl: input.instanceUrl,
      type: input.type,
      tags: input.tags ?? prev.tags,
      notes: input.notes ?? prev.notes,
      metadata: input.metadata ?? prev.metadata,
      lastSeenAt: now.toISOString()
    };
    safe.orgs[idx] = entry;
  }
  safe.updatedAt = now.toISOString();
  return { catalog: safe, entry, created, errors: [] };
}

export function removeOrg(
  catalog: OrgCatalog | null,
  alias: string,
  now: Date = new Date()
): { catalog: OrgCatalog; removed: boolean } {
  const safe = normaliseCatalog(catalog, now);
  const before = safe.orgs.length;
  safe.orgs = safe.orgs.filter((o) => o.alias !== alias);
  const removed = safe.orgs.length < before;
  if (removed) safe.updatedAt = now.toISOString();
  return { catalog: safe, removed };
}

export function getOrg(catalog: OrgCatalog | null, alias: string): OrgEntry | null {
  if (!catalog) return null;
  return catalog.orgs.find((o) => o.alias === alias) ?? null;
}

export function listOrgs(catalog: OrgCatalog | null, filter: OrgListFilter = {}): OrgEntry[] {
  if (!catalog) return [];
  let result = [...catalog.orgs];
  if (filter.type) result = result.filter((o) => o.type === filter.type);
  if (filter.tag) result = result.filter((o) => (o.tags ?? []).includes(filter.tag!));
  if (filter.query) {
    const q = filter.query.toLowerCase();
    result = result.filter(
      (o) =>
        o.alias.toLowerCase().includes(q) ||
        o.instanceUrl.toLowerCase().includes(q) ||
        (o.notes ?? "").toLowerCase().includes(q)
    );
  }
  return result.sort((a, b) => a.alias.localeCompare(b.alias));
}

export function summariseCatalog(catalog: OrgCatalog | null): {
  total: number;
  byType: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
} {
  if (!catalog) return { total: 0, byType: {}, topTags: [] };
  const byType: Record<string, number> = {};
  const tagCounts = new Map<string, number>();
  for (const org of catalog.orgs) {
    byType[org.type] = (byType[org.type] ?? 0) + 1;
    for (const tag of org.tags ?? []) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 20);
  return { total: catalog.orgs.length, byType, topTags };
}

/**
 * “¯ŠúƒXƒPƒWƒ…[ƒ‹—pƒ†[ƒeƒBƒŠƒeƒBB
 *
 * Še Org ƒGƒ“ƒgƒŠ‚Ì lastSeenAt ‚ğŠî€‚ÉAintervalMs ‚ğ’´‚¦‚ÄŒo‰ß‚µ‚½ƒGƒ“ƒgƒŠ‚ğ
 * ’Šo‚·‚éBÀÛ‚Ìƒƒ^ƒf[ƒ^æ“¾ (sf org list metadata “™) ‚ÍŒÄ‚Ño‚µ‘¤‚ª’S“–‚µA
 * æ“¾Œã `upsertOrg` ‚Å metadata ‚ğXV‚·‚é‚±‚Æ‚Å lastSeenAt ‚ªXV‚³‚ê‚éB
 */
export interface OrgSyncStaleness {
  alias: string;
  lastSeenAt?: string;
  ageMs: number;
}

export function findStaleOrgs(
  catalog: OrgCatalog | null,
  intervalMs: number,
  now: Date = new Date()
): OrgSyncStaleness[] {
  if (!catalog || !Array.isArray(catalog.orgs)) return [];
  const cutoff = now.getTime() - intervalMs;
  const stale: OrgSyncStaleness[] = [];
  for (const org of catalog.orgs) {
    const last = org.lastSeenAt ? Date.parse(org.lastSeenAt) : 0;
    if (last <= cutoff) {
      stale.push({
        alias: org.alias,
        lastSeenAt: org.lastSeenAt,
        ageMs: now.getTime() - (last || now.getTime())
      });
    }
  }
  return stale.sort((a, b) => b.ageMs - a.ageMs);
}

/**
 * 2 ‚Â‚Ì Org ‚Ì metadata ·•ª‚ğŠÈˆÕ’Šo‚·‚éB
 * ’l‚ªˆê’v‚µ‚È‚¢ƒL[A•Ğ‘¤‚Ì‚İ‘¶İ‚·‚éƒL[‚ğ‚»‚ê‚¼‚êƒŠƒXƒg‚·‚éB
 */
export interface MetadataDiffEntry {
  key: string;
  status: "added" | "removed" | "changed";
  left?: unknown;
  right?: unknown;
}

export function diffOrgMetadata(
  left: OrgEntry | null,
  right: OrgEntry | null
): MetadataDiffEntry[] {
  const a = (left?.metadata ?? {}) as Record<string, unknown>;
  const b = (right?.metadata ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  const diff: MetadataDiffEntry[] = [];
  for (const k of keys) {
    const inA = Object.prototype.hasOwnProperty.call(a, k);
    const inB = Object.prototype.hasOwnProperty.call(b, k);
    if (inA && !inB) diff.push({ key: k, status: "removed", left: a[k] });
    else if (!inA && inB) diff.push({ key: k, status: "added", right: b[k] });
    else if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      diff.push({ key: k, status: "changed", left: a[k], right: b[k] });
    }
  }
  return diff.sort((x, y) => x.key.localeCompare(y.key));
}
