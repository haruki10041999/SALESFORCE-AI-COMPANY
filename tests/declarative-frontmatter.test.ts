import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseFrontmatter,
  AgentFrontmatterSchema,
  SkillFrontmatterSchema
} from "../mcp/core/declarative/frontmatter.js";

test("Frontmatter: returns empty data when no frontmatter", () => {
  const r = parseFrontmatter("# Title\nbody");
  assert.deepEqual(r.data, {});
  assert.equal(r.body, "# Title\nbody");
});

test("Frontmatter: parses scalar / array / boolean / number", () => {
  const r = parseFrontmatter([
    "---",
    "name: architect",
    "role: \"system designer\"",
    "expertise: [apex, lwc]",
    "deprecated: false",
    "weight: 3",
    "---",
    "# Body"
  ].join("\n"));
  assert.equal(r.data.name, "architect");
  assert.equal(r.data.role, "system designer");
  assert.deepEqual(r.data.expertise, ["apex", "lwc"]);
  assert.equal(r.data.deprecated, false);
  assert.equal(r.data.weight, 3);
  assert.equal(r.body.startsWith("# Body"), true);
});

test("Frontmatter: AgentFrontmatterSchema validates parsed data", () => {
  const { data } = parseFrontmatter([
    "---",
    "name: architect",
    "expertise: [a, b]",
    "deprecated: true",
    "---",
    ""
  ].join("\n"));
  const meta = AgentFrontmatterSchema.parse(data);
  assert.equal(meta.deprecated, true);
  assert.deepEqual(meta.expertise, ["a", "b"]);
});

test("Frontmatter: SkillFrontmatterSchema rejects unknown keys (strict)", () => {
  const r = SkillFrontmatterSchema.safeParse({ name: "x", unknown: 1 });
  assert.equal(r.success, false);
});

test("Frontmatter: handles CRLF and quoted single-quote", () => {
  const r = parseFrontmatter("---\r\nname: 'foo'\r\n---\r\nbody");
  assert.equal(r.data.name, "foo");
});

test("Frontmatter: empty frontmatter block yields no keys", () => {
  const r = parseFrontmatter("---\n\n---\nbody");
  assert.deepEqual(r.data, {});
});
