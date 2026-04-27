import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildEmptyOrgCatalog,
  upsertOrg,
  removeOrg,
  getOrg,
  listOrgs,
  summariseCatalog,
  validateOrgInput
} from "../mcp/core/org/org-catalog.js";

const NOW = new Date("2026-04-27T00:00:00Z");

test("A1: empty catalog has version and empty orgs", () => {
  const c = buildEmptyOrgCatalog(NOW);
  assert.equal(c.version, 1);
  assert.equal(c.orgs.length, 0);
});

test("A1: upsertOrg inserts a new entry", () => {
  const r = upsertOrg(null, {
    alias: "prod",
    instanceUrl: "https://example.my.salesforce.com",
    type: "production",
    tags: ["pii", "tier-1"]
  }, NOW);
  assert.equal(r.created, true);
  assert.equal(r.errors.length, 0);
  assert.equal(r.catalog.orgs.length, 1);
  assert.equal(r.entry.alias, "prod");
});

test("A1: upsertOrg updates an existing entry", () => {
  const after = upsertOrg(
    upsertOrg(null, {
      alias: "sb",
      instanceUrl: "https://example--sb.sandbox.my.salesforce.com",
      type: "sandbox"
    }, NOW).catalog,
    {
      alias: "sb",
      instanceUrl: "https://example--sb.sandbox.my.salesforce.com",
      type: "sandbox",
      notes: "QA"
    },
    NOW
  );
  assert.equal(after.created, false);
  assert.equal(after.entry.notes, "QA");
});

test("A1: validation rejects invalid alias and url", () => {
  const r = upsertOrg(null, {
    alias: "bad alias!",
    instanceUrl: "not-a-url",
    type: "production"
  }, NOW);
  assert.ok(r.errors.length >= 2);
  assert.equal(r.catalog.orgs.length, 0);
});

test("A1: removeOrg deletes by alias", () => {
  let cat = upsertOrg(null, {
    alias: "x",
    instanceUrl: "https://x.example.com",
    type: "scratch"
  }, NOW).catalog;
  const r = removeOrg(cat, "x", NOW);
  assert.equal(r.removed, true);
  assert.equal(r.catalog.orgs.length, 0);
});

test("A1: listOrgs filters by type and tag and query", () => {
  let cat = buildEmptyOrgCatalog(NOW);
  for (const cfg of [
    { alias: "prod1", type: "production" as const, tags: ["pii"] },
    { alias: "prod2", type: "production" as const, tags: ["analytics"] },
    { alias: "sb1", type: "sandbox" as const, tags: ["pii"] }
  ]) {
    cat = upsertOrg(cat, {
      alias: cfg.alias,
      instanceUrl: `https://${cfg.alias}.example.com`,
      type: cfg.type,
      tags: cfg.tags
    }, NOW).catalog;
  }
  assert.equal(listOrgs(cat, { type: "production" }).length, 2);
  assert.equal(listOrgs(cat, { tag: "pii" }).length, 2);
  assert.equal(listOrgs(cat, { query: "sb" }).length, 1);
});

test("A1: getOrg returns null when missing", () => {
  const cat = buildEmptyOrgCatalog(NOW);
  assert.equal(getOrg(cat, "missing"), null);
});

test("A1: summariseCatalog reports counts and top tags", () => {
  let cat = buildEmptyOrgCatalog(NOW);
  for (const cfg of [
    { alias: "a", type: "production" as const, tags: ["pii"] },
    { alias: "b", type: "production" as const, tags: ["pii"] },
    { alias: "c", type: "sandbox" as const, tags: ["analytics"] }
  ]) {
    cat = upsertOrg(cat, {
      alias: cfg.alias,
      instanceUrl: `https://${cfg.alias}.example.com`,
      type: cfg.type,
      tags: cfg.tags
    }, NOW).catalog;
  }
  const s = summariseCatalog(cat);
  assert.equal(s.total, 3);
  assert.equal(s.byType["production"], 2);
  assert.equal(s.byType["sandbox"], 1);
  assert.equal(s.topTags[0].tag, "pii");
  assert.equal(s.topTags[0].count, 2);
});

test("A1: validateOrgInput returns no errors for valid input", () => {
  const errs = validateOrgInput({
    alias: "ok-alias_1",
    instanceUrl: "https://ok.example.com",
    type: "developer",
    tags: ["t1", "t2"]
  });
  assert.equal(errs.length, 0);
});
