#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".jsonl", ".md", ".txt", ".yml", ".yaml", ".env", ".xml", ".html", ".css", ".scss"
]);

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
// Bearer トークンは実際の長い英数字列のみ検出（ラベルテキストを除外）
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*\b/gi;
// 実際のシークレットトークンのみ: sk_live_, sfdx_test_ など、アンダースコア区切りのプレフィックスを必須
const SECRET_TOKEN_PATTERN = /\b(?:sk_live|sk_test|sfdx_test|sfdx_prod)[_\-][A-Za-z0-9\-._]{16,}\b/g;
const SALESFORCE_ID_PATTERN = /\b(?=[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b)(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{15}(?:[A-Za-z0-9]{3})?\b/g;
const KEY_VALUE_PATTERN = /(?:^|[\s{,])["']?([A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)|apiKey|api_key|accessToken|refreshToken|clientSecret|authorization|password|secret|token)["']?\s*[:=]\s*["']?([^"'\s,#\r\n]{8,})/gim;
const PLACEHOLDER_PATTERN = /^(?:example|sample|dummy|changeme|replace[-_]?me(?:[-_].*)?|your[-_a-z]*|test|placeholder|local|localhost|none|null|false|sample-[a-z]+)$/i;

function runCommand(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf-8", shell: true });
  if (result.error) {
    throw result.error;
  }
  return result;
}

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function shouldScanAsText(filePath) {
  const normalized = normalizePath(filePath);
  if (
    normalized.startsWith("node_modules/") ||
    normalized.startsWith("dist/") ||
    normalized.startsWith(".git/") ||
    normalized === "package-lock.json"
  ) {
    return false;
  }
  const extension = extname(normalized).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || normalized.endsWith(".env") || normalized.includes(".env.");
}

function shouldCheckPii(filePath) {
  const normalized = normalizePath(filePath);
  return normalized.startsWith("outputs/") || normalized.endsWith(".json") || normalized.endsWith(".jsonl") || normalized.includes("config");
}

function isPlaceholderValue(value) {
  return PLACEHOLDER_PATTERN.test(value.trim());
}

export function scanTextForSensitiveData(content, filePath = "") {
  const findings = [];

  for (const match of content.matchAll(KEY_VALUE_PATTERN)) {
    const keyName = match[1] ?? "credential";
    const value = match[2] ?? "";
    if (!value || isPlaceholderValue(value)) continue;
    findings.push({ type: "secret", label: `${keyName} assignment`, value });
  }

  for (const match of content.matchAll(BEARER_PATTERN)) {
    findings.push({ type: "secret", label: "Bearer token", value: match[0] ?? "" });
  }

  for (const match of content.matchAll(SECRET_TOKEN_PATTERN)) {
    findings.push({ type: "secret", label: "secret token", value: match[0] ?? "" });
  }

  if (shouldCheckPii(filePath)) {
    for (const match of content.matchAll(EMAIL_PATTERN)) {
      const value = match[0] ?? "";
      if (!isPlaceholderValue(value.split("@")[0] ?? "")) {
        findings.push({ type: "pii", label: "email address", value });
      }
    }
    for (const match of content.matchAll(SALESFORCE_ID_PATTERN)) {
      findings.push({ type: "pii", label: "Salesforce ID", value: match[0] ?? "" });
    }
  }

  return findings;
}

function formatExcerpt(value) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export function scanFilesForSensitiveData(files, cwd = repoRoot) {
  const violations = [];
  for (const file of files) {
    const normalized = normalizePath(file);
    if (!shouldScanAsText(normalized)) continue;

    const absolute = resolve(cwd, normalized);
    if (!existsSync(absolute)) continue;

    const stat = statSync(absolute);
    if (!stat.isFile() || stat.size > 1024 * 1024) continue;

    const content = readFileSync(absolute, "utf-8");
    const findings = scanTextForSensitiveData(content, normalized);
    for (const finding of findings) {
      violations.push(`${normalized}: ${finding.label} -> ${formatExcerpt(finding.value)}`);
    }
  }
  return violations;
}

export function getStagedFiles(cwd = repoRoot) {
  const result = runCommand("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], cwd);
  if ((result.status ?? 1) !== 0) {
    throw new Error(result.stderr?.trim() || "failed to list staged files");
  }
  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function runPrecommitGuard(cwd = repoRoot) {
  const stagedFiles = getStagedFiles(cwd);
  if (stagedFiles.length === 0) {
    console.log("[pre-commit] no staged files; skipping checks.");
    return 0;
  }

  const lint = runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "lint:outputs"], cwd);
  if ((lint.status ?? 1) !== 0) {
    process.stdout.write(lint.stdout ?? "");
    process.stderr.write(lint.stderr ?? "");
    console.error("[pre-commit] lint:outputs failed.");
    return lint.status ?? 1;
  }

  const violations = scanFilesForSensitiveData(stagedFiles, cwd);
  if (violations.length > 0) {
    console.error("[pre-commit] sensitive data detected in staged files:");
    for (const violation of violations) {
      console.error(`  - ${violation}`);
    }
    return 1;
  }

  console.log(`[pre-commit] OK (${stagedFiles.length} staged file(s) checked).`);
  return 0;
}

if (import.meta.url === new URL(`file://${process.argv[1]?.replaceAll("\\", "/")}`).href) {
  process.exit(runPrecommitGuard());
}