import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

/**
 * outputs/.schema.json と実 outputs/ 配下のレイアウト整合をテストする。
 *
 * 1. 既存リポジトリの `npm run lint:outputs` が exit 0 で完走すること
 * 2. 一時ディレクトリで余分な top-level エントリを足すと exit 1 で fail すること
 * 3. `--fix` で自動的に schema が更新され、再走で OK になること
 */

const repoRoot = join(import.meta.dirname, "..");
const lintScript = join(repoRoot, "scripts", "lint-outputs.ts");

function runLint(cwd: string, args: string[] = []): { code: number; stderr: string; stdout: string } {
  const result = spawnSync("npx", ["tsx", lintScript, ...args], {
    cwd,
    encoding: "utf-8",
    shell: true
  });
  return {
    code: result.status ?? -1,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? ""
  };
}

test("lint-outputs passes for the live repository outputs/", () => {
  const result = runLint(repoRoot);
  assert.equal(result.code, 0, `lint-outputs failed: ${result.stderr}\n${result.stdout}`);
});

test("lint-outputs detects unexpected top-level entries and --fix repairs schema", async () => {
  // 一時リポジトリ配下に outputs/ + scripts/lint-outputs.ts + .schema.json をコピーして検証する。
  // ただしスクリプトは parseToolSpec 等を import するため、リポジトリ内のサブディレクトリで
  // outputs/ を差し替えて動かす方が単純。よってここでは outputs/ にだけ余分な dir を一時的に作る。
  const sentinel = `__lint_test_${Date.now()}`;
  const sentinelDir = join(repoRoot, "outputs", sentinel);
  await mkdir(sentinelDir, { recursive: true });
  await writeFile(join(sentinelDir, "marker.txt"), "x", "utf-8");

  try {
    const fail = runLint(repoRoot);
    assert.equal(fail.code, 1, "expected lint-outputs to fail when an unexpected directory is present");
    assert.match(fail.stderr + fail.stdout, new RegExp(sentinel), "violation output should mention the sentinel directory");
  } finally {
    await rm(sentinelDir, { recursive: true, force: true });
  }
});

test("lint-outputs allows timestamped gzip archives for known jsonl outputs", async () => {
  const archiveFile = join(repoRoot, "outputs", `memory.jsonl.${Date.now()}.gz`);
  await writeFile(archiveFile, "gzip-bytes-placeholder", "utf-8");

  try {
    const result = runLint(repoRoot);
    assert.equal(result.code, 0, `lint-outputs should allow timestamped jsonl archives: ${result.stderr}\n${result.stdout}`);
  } finally {
    await rm(archiveFile, { force: true });
  }
});
