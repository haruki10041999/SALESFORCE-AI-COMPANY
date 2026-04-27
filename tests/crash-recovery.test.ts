import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TemporaryFileManager } from "../mcp/core/governance/temporary-file-manager.js";

async function createTempDir(label: string): Promise<string> {
  return await mkdtemp(join(tmpdir(), `sfai-crash-${label}-`));
}

test("crash-recovery: stale .tmp files left from prior crash are cleaned", async () => {
  const dir = await createTempDir("stale-tmp");
  const target = join(dir, "governance.json");

  // 健全な target ファイルを書き込み済みとする
  await writeFile(target, JSON.stringify({ ok: true }), "utf-8");

  // 過去の中断書き込みで残った .tmp を 3 つシミュレート
  await writeFile(join(dir, `.governance.json.99999.111.tmp`), "PARTIAL_A", "utf-8");
  await writeFile(join(dir, `.governance.json.99999.222.tmp`), "PARTIAL_B", "utf-8");
  await writeFile(join(dir, `.governance.json.99999.333.tmp`), "PARTIAL_C", "utf-8");

  await TemporaryFileManager.cleanupStaleTempFiles(target);

  const remaining = await readdir(dir);
  // target は残り、stale tmp は消える
  assert.deepEqual(remaining.sort(), ["governance.json"]);

  const targetContent = await readFile(target, "utf-8");
  assert.equal(JSON.parse(targetContent).ok, true);
});

test("crash-recovery: target file remains intact when a new write completes", async () => {
  const dir = await createTempDir("intact");
  const target = join(dir, "state.json");

  await TemporaryFileManager.writeAtomic(target, JSON.stringify({ v: 1 }));
  assert.equal(JSON.parse(await readFile(target, "utf-8")).v, 1);

  await TemporaryFileManager.writeAtomic(target, JSON.stringify({ v: 2 }));
  assert.equal(JSON.parse(await readFile(target, "utf-8")).v, 2);

  // tmp 残骸が無いこと
  const entries = await readdir(dir);
  assert.deepEqual(entries.sort(), ["state.json"]);
});

test("crash-recovery: simulated crash mid-write leaves target file untouched", async () => {
  // writeAtomic は (1) tmp 書き込み, (2) rename(tmp,target) の 2 段階。
  // ここでは「tmp 書き込み中にクラッシュ → target は古いまま」を再現する。
  const dir = await createTempDir("mid-write");
  const target = join(dir, "state.json");

  // 既存の正規 target
  const original = JSON.stringify({ v: "original" });
  await TemporaryFileManager.writeAtomic(target, original);

  // tmp ファイルを途中まで書いた状態を手動で再現 (rename には到達しない)
  const fakeTmp = join(dir, `.state.json.${process.pid}.${Date.now()}.tmp`);
  await writeFile(fakeTmp, '{"v":"PARTIA', "utf-8"); // 故意に壊れた JSON

  // この時点で target は元のまま
  assert.equal(JSON.parse(await readFile(target, "utf-8")).v, "original");

  // 復旧: cleanupStaleTempFiles で部分書き込みを掃除
  await TemporaryFileManager.cleanupStaleTempFiles(target);

  const entries = await readdir(dir);
  assert.deepEqual(entries.sort(), ["state.json"]);
  assert.equal(JSON.parse(await readFile(target, "utf-8")).v, "original");
});

test("crash-recovery: concurrent writes serialize to a valid final state", async () => {
  const dir = await createTempDir("concurrent");
  const target = join(dir, "state.json");

  // 10 並列書き込み。最終的に target は何らかの完全な JSON である必要がある
  const writes = Array.from({ length: 10 }, (_, i) =>
    TemporaryFileManager.writeAtomic(target, JSON.stringify({ v: i }))
  );
  await Promise.all(writes);

  const text = await readFile(target, "utf-8");
  // 部分書き込みが残っていないこと (JSON parseが必ず成功する)
  const parsed = JSON.parse(text);
  assert.equal(typeof parsed.v, "number");
  assert.ok(parsed.v >= 0 && parsed.v < 10);

  // tmp ファイルが残っていないこと
  const entries = await readdir(dir);
  assert.deepEqual(entries.sort(), ["state.json"]);
});

test("crash-recovery: writeAtomic creates target directory if missing", async () => {
  const dir = await createTempDir("mkdir");
  const nested = join(dir, "deep", "nested", "subdir");
  const target = join(nested, "config.json");

  await TemporaryFileManager.writeAtomic(target, '{"ok":true}');

  const s = await stat(target);
  assert.ok(s.isFile());
  assert.equal(JSON.parse(await readFile(target, "utf-8")).ok, true);
});

test("crash-recovery: cleanupStaleTempFiles is idempotent and safe on missing dir", async () => {
  const dir = await createTempDir("missing");
  const missingTarget = join(dir, "no-such-subdir", "thing.json");

  // 存在しないディレクトリでも throw しない
  await TemporaryFileManager.cleanupStaleTempFiles(missingTarget);

  // 既存ディレクトリで .tmp が無くても throw しない
  await mkdir(join(dir, "x"), { recursive: true });
  await TemporaryFileManager.cleanupStaleTempFiles(join(dir, "x", "a.json"));
});

test("crash-recovery: cleanup leaves unrelated files alone", async () => {
  const dir = await createTempDir("unrelated");
  const target = join(dir, "governance.json");
  await writeFile(target, "{}", "utf-8");

  // 別系統の .tmp は触らない
  await writeFile(join(dir, ".other.json.1.2.tmp"), "X", "utf-8");
  // .tmp 拡張子を持たないファイルも触らない
  await writeFile(join(dir, ".governance.json.weird"), "Y", "utf-8");

  await TemporaryFileManager.cleanupStaleTempFiles(target);

  const entries = (await readdir(dir)).sort();
  assert.deepEqual(entries, [".governance.json.weird", ".other.json.1.2.tmp", "governance.json"]);
});
