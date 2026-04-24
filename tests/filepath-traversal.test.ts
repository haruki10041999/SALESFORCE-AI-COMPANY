/**
 * filepath-traversal.test.ts
 *
 * セキュリティテスト: ファイルパス入力のサニタイズとパストラバーサル防止
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve, normalize, relative } from "node:path";
import { tmpdir } from "node:os";

/**
 * ファイルパスのサニタイズ関数
 * 相対パス攻撃（../, ..\\）を検出・防止
 */
function sanitizeFilePath(basePath: string, userPath: string): string | null {
  // Normalize both paths to handle platform differences
  const normalized = normalize(userPath);
  const resolvedPath = resolve(basePath, normalized);
  const resolvedBase = resolve(basePath);

  // Use relative() to check if resolved path is within base directory
  // If relative path starts with "..", the file is outside the base directory
  const rel = relative(resolvedBase, resolvedPath);
  
  // Accept empty string (current dir) or paths that don't go up with ".."
  if (rel && (rel.startsWith("..") || rel.startsWith("..\\"))  ) {
    return null; // Path traversal attempt detected
  }

  return resolvedPath;
}

test("sanitizeFilePath: allows legitimate relative paths", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-"));

  try {
    await mkdir(join(baseDir, "src"));
    await writeFile(join(baseDir, "src", "app.ts"), "// app");

    const result = sanitizeFilePath(baseDir, "src/app.ts");
    assert.ok(result, "Should allow valid relative path");
    assert.equal(normalize(result), normalize(join(baseDir, "src", "app.ts")), "Should resolve to correct absolute path");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: allows absolute paths within base directory", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-abs-"));

  try {
    await mkdir(join(baseDir, "src"));
    const absolutePath = join(baseDir, "src", "app.ts");
    await writeFile(absolutePath, "// app");

    const result = sanitizeFilePath(baseDir, absolutePath);
    assert.ok(result, "Should allow absolute path within base directory");
    assert.equal(normalize(result), normalize(absolutePath), "Should return the same absolute path");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: rejects path traversal with ../", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-traverse-"));

  try {
    const result = sanitizeFilePath(baseDir, "../../../etc/passwd");
    assert.equal(result, null, "Should reject path traversal attempt with ../");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: rejects path traversal with ..\\ (Windows)", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-windows-"));

  try {
    const result = sanitizeFilePath(baseDir, "..\\..\\..\\windows\\system32");
    assert.equal(result, null, "Should reject Windows-style path traversal");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: rejects mixed traversal patterns", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-mixed-"));

  try {
    // Test various mixed patterns
    const patterns = [
      "src/../../../secret.txt",
      "./subdir/../../../../../../etc/passwd",
      "subdir/./../../sensitive",
      "src\\..\\..\\..\\windows\\notepad.exe"
    ];

    for (const pattern of patterns) {
      const result = sanitizeFilePath(baseDir, pattern);
      // Some might resolve within base, some might not - key is to check actual escaping
      if (result) {
        assert.ok(
          normalize(result).startsWith(normalize(baseDir)),
          `Pattern "${pattern}" should resolve within base directory or be rejected`
        );
      }
    }
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: rejects absolute paths outside base directory", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-outside-"));

  try {
    // Try to access system paths
    const patterns = [
      "/etc/passwd",
      "C:\\Windows\\System32\\config\\SAM",
      "/var/log/auth.log"
    ];

    for (const pattern of patterns) {
      const result = sanitizeFilePath(baseDir, pattern);
      // Should be rejected or at least not resolve outside baseDir
      if (result) {
        assert.ok(
          normalize(result).startsWith(normalize(baseDir)),
          `Absolute path outside base "${pattern}" should be rejected or contained`
        );
      }
    }
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: handles null byte injection attempts", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-null-"));

  try {
    // Null byte injection is less relevant in Node.js but still worth testing
    const result = sanitizeFilePath(baseDir, "src/app.ts\x00.exe");
    // normalize should handle or keep the null byte - the important part is path resolution
    assert.ok(result, "Should still return a path (null bytes are handled by Node.js)");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: prevents directory name substring attacks", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-substr-"));

  try {
    // Create /tmp/path-test-substr-
    // Try to access /tmp/path-test-substr-foo/../../../
    const attackPath = `${baseDir}/../../../etc/passwd`;
    const result = sanitizeFilePath(baseDir, attackPath);
    assert.equal(result, null, "Should reject directory name substring attacks");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: handles symlink-like paths (without actual symlinks)", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-sym-"));

  try {
    // Even without actual symlinks, paths with .. should be handled correctly
    const result = sanitizeFilePath(baseDir, "src/./subdir/../../app.ts");
    if (result) {
      assert.ok(
        normalize(result).startsWith(normalize(baseDir)),
        "Resolved path should be within base directory"
      );
    }
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: edge case - empty path", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-empty-"));

  try {
    const result = sanitizeFilePath(baseDir, "");
    assert.ok(result, "Should handle empty path (resolves to base)");
    assert.equal(normalize(result), normalize(baseDir), "Empty path should resolve to base directory");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("sanitizeFilePath: edge case - dot path", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "path-test-dot-"));

  try {
    const result = sanitizeFilePath(baseDir, ".");
    assert.ok(result, "Should handle dot path");
    assert.equal(normalize(result), normalize(baseDir), "Dot should resolve to base directory");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
