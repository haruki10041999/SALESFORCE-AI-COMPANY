#!/usr/bin/env node
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ResourceType = "agent" | "skill";

interface ParsedOptions {
  type: ResourceType;
  name: string;
  title?: string;
  overwrite: boolean;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

function printUsage(error?: string): void {
  if (error) {
    console.error(`[scaffold] ${error}`);
    console.error("");
  }

  console.error("Usage:");
  console.error("  npm run scaffold -- agent <name> [--title \"表示名\"] [--overwrite]");
  console.error("  npm run scaffold -- skill <category>/<name> [--title \"表示名\"] [--overwrite]");
  console.error("");
  console.error("Examples:");
  console.error("  npm run scaffold -- agent release-coordinator");
  console.error("  npm run scaffold -- skill apex/trigger-audit");
  console.error("  npm run scaffold -- skill security/permission-audit --title \"Permission Audit\"");
}

function isSafeSegment(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function toTitleCase(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseOptions(argv: string[]): ParsedOptions {
  if (argv.length < 2) {
    throw new Error("引数が不足しています。");
  }

  const type = argv[0];
  if (type !== "agent" && type !== "skill") {
    throw new Error(`type は 'agent' または 'skill' を指定してください: ${type}`);
  }

  const name = argv[1];
  if (!name) {
    throw new Error("name が未指定です。");
  }

  let title: string | undefined;
  let overwrite = false;

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--overwrite") {
      overwrite = true;
      continue;
    }

    if (token === "--title") {
      const raw = argv.slice(i + 1);
      const valueTokens: string[] = [];
      for (const item of raw) {
        if (item.startsWith("--")) {
          break;
        }
        valueTokens.push(item);
      }

      if (valueTokens.length === 0) {
        throw new Error("--title には値が必要です。");
      }

      title = valueTokens.join(" ");
      i += valueTokens.length;
      continue;
    }

    throw new Error(`未知のオプションです: ${token}`);
  }

  return { type, name, title, overwrite };
}

function ensureParentDir(filePath: string): void {
  const normalized = resolve(filePath, "..");
  if (!existsSync(normalized)) {
    mkdirSync(normalized, { recursive: true });
  }
}

function buildAgentTemplate(name: string, title?: string): string {
  const resolvedTitle = title ?? toTitleCase(name);
  return `# ${resolvedTitle}

## 役割
ここに役割を記述してください。担当範囲と責任を明確にします。

## 専門領域
- 専門領域 1
- 専門領域 2
- 専門領域 3

## 発言スタイル
- 判断の根拠を先に示す
- 前提と制約を明確にする
- 必要に応じて代替案を提示する

## 他エージェントとの役割分担
| エージェント | 境界 |
|---|---|
| architect | 設計判断が必要な場合に連携する |

## リソース管理時の役割
スキル・エージェント・プリセットの拡張提案時に、このエージェントがどの観点でレビューするかを記述します。

## 禁止事項
- 担当外の最終判断を断定しない
- 根拠のない推測で結論を出さない
`;
}

function buildSkillTemplate(name: string, title?: string): string {
  const skillSlug = name.includes("/") ? name.split("/")[1] : name;
  const resolvedTitle = title ?? toTitleCase(skillSlug);

  return `# ${resolvedTitle}

## 概要
このスキルが解決する課題と適用目的を記述してください。

## いつ使うか
- 利用シーン 1
- 利用シーン 2
- 利用シーン 3

## 重要な原則
- 原則 1
- 原則 2
- 原則 3

## プラットフォーム固有の制約・数値
- 制約または上限 1
- 制約または上限 2

## よい例・悪い例
### 悪い例
- ここに悪い例を記述

### よい例
- ここに良い例を記述

## チェックリスト
- [ ] 前提条件を満たしている
- [ ] 制約に抵触していない
- [ ] 検証手順が定義されている
`;
}

function resolveAgentFilePath(name: string): string {
  if (!isSafeSegment(name)) {
    throw new Error(`agent 名は英小文字・数字・ハイフンのみ使用できます: ${name}`);
  }
  return join(ROOT, "agents", `${name}.md`);
}

function resolveSkillFilePath(name: string): string {
  const parts = name.split("/");
  if (parts.length !== 2) {
    throw new Error(`skill 名は '<category>/<name>' 形式で指定してください: ${name}`);
  }

  const [category, skillName] = parts;
  if (!isSafeSegment(category) || !isSafeSegment(skillName)) {
    throw new Error(`skill の category/name は英小文字・数字・ハイフンのみ使用できます: ${name}`);
  }

  return join(ROOT, "skills", category, `${skillName}.md`);
}

function writeTemplate(filePath: string, content: string, overwrite: boolean): void {
  if (existsSync(filePath) && !overwrite) {
    throw new Error(`既存ファイルがあるため作成を中断しました: ${filePath} (上書きするには --overwrite)`);
  }

  ensureParentDir(filePath);
  writeFileSync(filePath, content, "utf-8");
}

function run(argv: string[]): number {
  let options: ParsedOptions;

  try {
    options = parseOptions(argv);
  } catch (error) {
    printUsage(String(error));
    return 1;
  }

  try {
    if (options.type === "agent") {
      const target = resolveAgentFilePath(options.name);
      writeTemplate(target, buildAgentTemplate(options.name, options.title), options.overwrite);
      console.log(`[scaffold] agent template created: ${target}`);
      return 0;
    }

    const target = resolveSkillFilePath(options.name);
    writeTemplate(target, buildSkillTemplate(options.name, options.title), options.overwrite);
    console.log(`[scaffold] skill template created: ${target}`);
    return 0;
  } catch (error) {
    console.error(`[scaffold] ${String(error)}`);
    return 1;
  }
}

process.exit(run(process.argv.slice(2)));
