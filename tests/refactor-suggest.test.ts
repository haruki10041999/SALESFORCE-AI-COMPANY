import { test } from "node:test";
import { strict as assert } from "node:assert";
import { suggestRefactors } from "../mcp/tools/refactor-suggest.js";

test("A7: detects long methods exceeding the line threshold", () => {
  const body = Array.from({ length: 80 }, (_, i) => `  Integer x${i} = ${i};`).join("\n");
  const apex = `public class Big {\n  public void run() {\n${body}\n  }\n}`;
  const r = suggestRefactors({ source: apex, maxMethodLines: 30 });
  const longMethods = r.suggestions.filter((s) => s.kind === "long-method");
  assert.equal(longMethods.length, 1);
  assert.equal(longMethods[0].details!.method, "run");
});

test("A7: detects deep nesting once per peak", () => {
  const apex = `public class N {
    public void go() {
      if (a) {
        if (b) {
          if (c) {
            if (d) {
              if (e) { doIt(); }
            }
          }
        }
      }
    }
  }`;
  const r = suggestRefactors({ source: apex, maxNestingDepth: 4 });
  const deep = r.suggestions.filter((s) => s.kind === "deep-nesting");
  assert.ok(deep.length >= 1, `expected at least one deep-nesting suggestion`);
});

test("A7: detects duplicate string literals above threshold", () => {
  const apex = `public class L {
    void a() { String s = 'AccountName'; }
    void b() { String s = 'AccountName'; }
    void c() { String s = 'AccountName'; }
  }`;
  const r = suggestRefactors({ source: apex, minLiteralOccurrences: 3 });
  const dups = r.suggestions.filter((s) => s.kind === "duplicate-literal");
  assert.equal(dups.length, 1);
  assert.equal(dups[0].details!.literal, "AccountName");
});

test("A7: ignores 0/1/-1 magic numbers", () => {
  const apex = `public class M {
    void a() { Integer x = 1; Integer y = 0; Integer z = -1; }
    void b() { Integer x = 1; Integer y = 0; Integer z = -1; }
    void c() { Integer x = 1; Integer y = 0; Integer z = -1; }
  }`;
  const r = suggestRefactors({ source: apex, minMagicOccurrences: 2 });
  assert.equal(r.suggestionsByKind["magic-number"], 0);
});

test("A7: flags repeating non-trivial magic numbers", () => {
  const apex = `public class M {
    void a() { Integer x = 42; }
    void b() { Integer y = 42; }
    void c() { Integer z = 42; }
  }`;
  const r = suggestRefactors({ source: apex, minMagicOccurrences: 3 });
  const magic = r.suggestions.filter((s) => s.kind === "magic-number");
  assert.equal(magic.length, 1);
  assert.equal(magic[0].details!.value, "42");
});

test("A7: returns counts grouped by kind", () => {
  const apex = `public class C {
    void a() { String s = 'X12345'; String t = 'X12345'; String u = 'X12345'; }
  }`;
  const r = suggestRefactors({ source: apex });
  assert.equal(typeof r.totalSuggestions, "number");
  assert.equal(typeof r.suggestionsByKind["duplicate-literal"], "number");
});
