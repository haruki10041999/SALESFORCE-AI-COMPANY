import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildEmptyOrgCatalog,
  upsertOrg,
  findStaleOrgs,
  diffOrgMetadata
} from "../mcp/core/org/org-catalog.js";

test("findStaleOrgs returns orgs older than interval", () => {
  let catalog = buildEmptyOrgCatalog(new Date("2026-01-01T00:00:00Z"));
  catalog = upsertOrg(catalog, {
    alias: "prod", instanceUrl: "https://x.example.com", type: "production"
  }, new Date("2026-01-01T00:00:00Z")).catalog;
  catalog = upsertOrg(catalog, {
    alias: "sandbox", instanceUrl: "https://y.example.com", type: "sandbox"
  }, new Date("2026-04-27T00:00:00Z")).catalog;

  const stale = findStaleOrgs(catalog, 7 * 24 * 3600 * 1000, new Date("2026-04-27T00:00:00Z"));
  assert.equal(stale.length, 1);
  assert.equal(stale[0].alias, "prod");
});

test("diffOrgMetadata reports added/removed/changed keys", () => {
  const a = { alias: "a", instanceUrl: "https://a", type: "production" as const, registeredAt: "", metadata: { perms: 5, users: 100 } };
  const b = { alias: "b", instanceUrl: "https://b", type: "production" as const, registeredAt: "", metadata: { perms: 6, fields: 30 } };
  const diff = diffOrgMetadata(a, b);
  const byKey = Object.fromEntries(diff.map((d) => [d.key, d.status]));
  assert.equal(byKey.perms, "changed");
  assert.equal(byKey.users, "removed");
  assert.equal(byKey.fields, "added");
});
