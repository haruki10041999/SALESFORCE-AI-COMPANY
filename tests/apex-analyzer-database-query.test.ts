import { test } from "node:test";
import { strict as assert } from "node:assert";
import { __testables } from "../mcp/tools/apex-analyzer.js";

const { extractDynamicQueryArguments } = __testables;

test("F1: simple Database.query is captured", () => {
  const src = `String s = Database.query('SELECT Id FROM Account');`;
  const args = extractDynamicQueryArguments(src);
  assert.deepEqual(args, ["'SELECT Id FROM Account'"]);
});

test("F1: nested parens inside String.format are not truncated", () => {
  const src = `Database.query(String.format('SELECT Id FROM {0} WHERE Name = :name', new List<String>{ objType }));`;
  const args = extractDynamicQueryArguments(src);
  assert.equal(args.length, 1);
  assert.ok(args[0].includes("String.format"), `should keep String.format, got: ${args[0]}`);
  assert.ok(args[0].includes("List<String>"), "should keep nested List<String>");
});

test("F1: ) inside string literal does not close the call", () => {
  const src = `Database.query('SELECT Id FROM Account WHERE Name = \\')\\'');`;
  const args = extractDynamicQueryArguments(src);
  assert.equal(args.length, 1);
  assert.ok(args[0].includes("Name ="), "argument should retain Name = portion");
});

test("F1: multi-line concatenation is captured as a single argument", () => {
  const src = `
    Database.query(
      'SELECT Id FROM ' + objectType +
      ' WHERE Name = :' + bindName
    );
  `;
  const args = extractDynamicQueryArguments(src);
  assert.equal(args.length, 1);
  assert.ok(args[0].includes("+"));
  assert.ok(args[0].includes("objectType"));
  assert.ok(args[0].includes("bindName"));
});

test("F1: multiple Database.query calls are all captured", () => {
  const src = `
    Database.query('SELECT Id FROM A');
    Database.countQuery('SELECT count() FROM B');
  `;
  const args = extractDynamicQueryArguments(src);
  assert.equal(args.length, 2);
  assert.ok(args[0].includes("FROM A"));
  assert.ok(args[1].includes("FROM B"));
});
