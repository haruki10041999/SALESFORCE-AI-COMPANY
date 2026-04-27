import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildApexDependencyGraphIncremental,
  diffFingerprints,
  loadCache
} from "../mcp/tools/apex-dependency-graph-incremental.js";

function makeRoot(): { root: string; cache: string } {
  const root = mkdtempSync(join(tmpdir(), "apex-incr-"));
  mkdirSync(join(root, "classes"), { recursive: true });
  writeFileSync(join(root, "classes", "Foo.cls"), `public class Foo { public void run(){} }`, "utf-8");
  writeFileSync(join(root, "classes", "Bar.cls"), `public class Bar { public void go(){ Foo f = new Foo(); } }`, "utf-8");
  return { root, cache: join(root, ".cache", "apex-graph.json") };
}

test("A18: first run reports all files as added and persists cache", () => {
  const { root, cache } = makeRoot();
  try {
    const r = buildApexDependencyGraphIncremental({ rootDir: root, cacheFile: cache });
    assert.equal(r.incremental.cacheHit, false);
    assert.equal(r.incremental.delta.added.length, 2);
    assert.equal(r.incremental.delta.modified.length, 0);
    assert.equal(r.incremental.delta.deleted.length, 0);
    assert.ok(loadCache(cache));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A18: second run with no changes reports zero deltas", () => {
  const { root, cache } = makeRoot();
  try {
    buildApexDependencyGraphIncremental({ rootDir: root, cacheFile: cache });
    const r = buildApexDependencyGraphIncremental({ rootDir: root, cacheFile: cache });
    assert.equal(r.incremental.cacheHit, true);
    assert.equal(r.incremental.delta.added.length, 0);
    assert.equal(r.incremental.delta.modified.length, 0);
    assert.equal(r.incremental.delta.deleted.length, 0);
    assert.ok(r.incremental.delta.unchanged >= 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A18: detects modified and deleted files between runs", () => {
  const { root, cache } = makeRoot();
  try {
    buildApexDependencyGraphIncremental({ rootDir: root, cacheFile: cache });
    // Modify Bar.cls (different content -> different hash)
    writeFileSync(join(root, "classes", "Bar.cls"), `public class Bar { public void go(){ Foo f = new Foo(); f.run(); } }`, "utf-8");
    // Delete Foo.cls
    rmSync(join(root, "classes", "Foo.cls"));
    // Add a new class
    writeFileSync(join(root, "classes", "Baz.cls"), `public class Baz {}`, "utf-8");

    const r = buildApexDependencyGraphIncremental({ rootDir: root, cacheFile: cache });
    assert.deepEqual(r.incremental.delta.modified, ["classes/Bar.cls"]);
    assert.deepEqual(r.incremental.delta.deleted, ["classes/Foo.cls"]);
    assert.deepEqual(r.incremental.delta.added, ["classes/Baz.cls"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A18: diffFingerprints unit handles empty inputs", () => {
  const d1 = diffFingerprints([], []);
  assert.deepEqual(d1, { added: [], modified: [], deleted: [], unchanged: 0 });

  const d2 = diffFingerprints([], [{ relativePath: "x.cls", mtimeMs: 1, size: 1, hash: "h" }]);
  assert.deepEqual(d2.added, ["x.cls"]);

  const d3 = diffFingerprints([{ relativePath: "x.cls", mtimeMs: 1, size: 1, hash: "h" }], []);
  assert.deepEqual(d3.deleted, ["x.cls"]);
});
