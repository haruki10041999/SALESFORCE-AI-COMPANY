#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ResourceType = "agent" | "skill" | "tool";

interface ParsedOptions {
  type: ResourceType;
  name: string;
  title?: string;
  description?: string;
  agents?: string[];
  skills?: string[];
  tags?: string[];
  persona?: string;
  overwrite: boolean;
  nonInteractive: boolean;
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
const TEMPLATE_DIR = join(ROOT, "scripts", "templates");

function printUsage(error?: string): void {
  if (error) {
    console.error(`[scaffold] ${error}`);
    console.error("");
  }

  console.error("Usage:");
  console.error("  npm run scaffold -- [--non-interactive] agent <name> [--title \"表示名\"] [--overwrite]");
  console.error("  npm run scaffold -- [--non-interactive] skill <category>/<name> [--title \"表示名\"] [--overwrite]");
  console.error("  npm run scaffold -- [--non-interactive] tool <name> --description \"説明\" --agents <a,b> [--skills <c/d,e/f>] [--tags <x,y>] [--persona <name>] [--overwrite]");
  console.error("  npm run scaffold --                   # 対話型 Wizard");
  console.error("");
  console.error("Examples:");
  console.error("  npm run scaffold -- agent release-coordinator");
  console.error("  npm run scaffold -- skill apex/trigger-audit");
  console.error("  npm run scaffold -- skill security/permission-audit --title \"Permission Audit\"");
  console.error("  npm run scaffold -- tool release_guard --description \"Release safety check\" --agents release-manager,qa-engineer");
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

function parseCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function validateSkillRef(value: string): boolean {
  const parts = value.split("/");
  return parts.length === 2 && isSafeSegment(parts[0]) && isSafeSegment(parts[1]);
}

function normalizeArgs(argv: string[]): { args: string[]; nonInteractive: boolean; forceInteractive: boolean } {
  let nonInteractive = false;
  let forceInteractive = false;
  const args = argv.filter((token) => {
    if (token === "--non-interactive") {
      nonInteractive = true;
      return false;
    }
    if (token === "--interactive") {
      forceInteractive = true;
      return false;
    }
    return true;
  });
  return { args, nonInteractive, forceInteractive };
}

function shouldUseInteractiveMode(args: string[], nonInteractive: boolean, forceInteractive: boolean): boolean {
  if (forceInteractive) return true;
  if (nonInteractive) return false;
  return args.length === 0;
}

function parseOptions(argv: string[]): ParsedOptions {
  const { args, nonInteractive } = normalizeArgs(argv);

  if (args.length < 2) {
    throw new Error("引数が不足しています。");
  }

  const type = args[0];
  if (type !== "agent" && type !== "skill" && type !== "tool") {
    throw new Error(`type は 'agent' / 'skill' / 'tool' を指定してください: ${type}`);
  }

  const name = args[1];
  if (!name) {
    throw new Error("name が未指定です。");
  }

  let title: string | undefined;
  let description: string | undefined;
  let agents: string[] | undefined;
  let skills: string[] | undefined;
  let tags: string[] | undefined;
  let persona: string | undefined;
  let overwrite = false;

  for (let i = 2; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--overwrite") {
      overwrite = true;
      continue;
    }

    if (token === "--title") {
      const raw = args.slice(i + 1);
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

    if (token === "--description") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--description には値が必要です。");
      }
      description = value;
      i += 1;
      continue;
    }

    if (token === "--agents") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--agents にはカンマ区切りの値が必要です。");
      }
      agents = parseCsv(value);
      i += 1;
      continue;
    }

    if (token === "--skills") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--skills にはカンマ区切りの値が必要です。");
      }
      skills = parseCsv(value);
      i += 1;
      continue;
    }

    if (token === "--tags") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--tags にはカンマ区切りの値が必要です。");
      }
      tags = parseCsv(value);
      i += 1;
      continue;
    }

    if (token === "--persona") {
      const value = args[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--persona には値が必要です。");
      }
      persona = value;
      i += 1;
      continue;
    }

    throw new Error(`未知のオプションです: ${token}`);
  }

  if (type === "tool") {
    if (!description) {
      throw new Error("tool 作成時は --description が必須です。");
    }
    if (!agents || agents.length === 0) {
      throw new Error("tool 作成時は --agents が必須です。");
    }
  }

  return { type, name, title, description, agents, skills, tags, persona, overwrite, nonInteractive };
}

function ensureParentDir(filePath: string): void {
  const normalized = resolve(filePath, "..");
  if (!existsSync(normalized)) {
    mkdirSync(normalized, { recursive: true });
  }
}

function loadTemplate(templateName: string): string {
  const templatePath = join(TEMPLATE_DIR, templateName);
  if (!existsSync(templatePath)) {
    throw new Error(`template が見つかりません: ${templatePath}`);
  }
  return readFileSync(templatePath, "utf-8");
}

function buildAgentTemplate(name: string, title?: string): string {
  const resolvedTitle = title ?? toTitleCase(name);
  const template = loadTemplate("agent.md");
  return template
    .replaceAll("{{TITLE}}", resolvedTitle)
    .replaceAll("{{NAME}}", name);
}

function buildSkillTemplate(name: string, title?: string): string {
  const skillSlug = name.includes("/") ? name.split("/")[1] : name;
  const resolvedTitle = title ?? toTitleCase(skillSlug);
  const template = loadTemplate("skill.md");
  return template
    .replaceAll("{{TITLE}}", resolvedTitle)
    .replaceAll("{{NAME}}", name);
}

function buildToolTemplate(options: ParsedOptions): string {
  if (!options.description || !options.agents || options.agents.length === 0) {
    throw new Error("tool template の生成に必要な値が不足しています。");
  }

  const payload = {
    name: options.name,
    description: options.description,
    agents: options.agents,
    skills: options.skills ?? [],
    tags: options.tags ?? [],
    persona: options.persona,
    createdAt: new Date().toISOString()
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
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

function resolveToolFilePath(name: string): string {
  if (!isSafeSegment(name)) {
    throw new Error(`tool 名は英小文字・数字・ハイフンのみ使用できます: ${name}`);
  }
  return join(ROOT, "outputs", "custom-tools", `${name}.json`);
}

async function promptUntil(
  rl: ReturnType<typeof createInterface>,
  question: string,
  validate: (value: string) => string | null,
  optional = false
): Promise<string> {
  for (;;) {
    const raw = await rl.question(question);
    const value = raw.trim();
    if (optional && value.length === 0) {
      return "";
    }
    const err = validate(value);
    if (!err) {
      return value;
    }
    console.log(`[scaffold] ${err}`);
  }
}

async function runWizard(argv: string[]): Promise<ParsedOptions> {
  const { nonInteractive } = normalizeArgs(argv);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    console.log("[scaffold] Interactive Wizard");
    const type = await promptUntil(
      rl,
      "resource type (agent/skill/tool): ",
      (value) => (value === "agent" || value === "skill" || value === "tool" ? null : "agent/skill/tool のいずれかを入力してください。")
    ) as ResourceType;

    if (type === "agent") {
      const name = await promptUntil(
        rl,
        "agent name (kebab-case): ",
        (value) => (isSafeSegment(value) ? null : "英小文字・数字・ハイフンのみ使用できます。")
      );
      const title = await promptUntil(rl, "title (optional): ", () => null, true);
      const overwrite = (await promptUntil(rl, "overwrite if exists? (y/N): ", () => null, true)).toLowerCase() === "y";
      return { type, name, title: title || undefined, overwrite, nonInteractive };
    }

    if (type === "skill") {
      const category = await promptUntil(
        rl,
        "skill category (kebab-case): ",
        (value) => (isSafeSegment(value) ? null : "英小文字・数字・ハイフンのみ使用できます。")
      );
      const skillName = await promptUntil(
        rl,
        "skill name (kebab-case): ",
        (value) => (isSafeSegment(value) ? null : "英小文字・数字・ハイフンのみ使用できます。")
      );
      const title = await promptUntil(rl, "title (optional): ", () => null, true);
      const overwrite = (await promptUntil(rl, "overwrite if exists? (y/N): ", () => null, true)).toLowerCase() === "y";
      return { type, name: `${category}/${skillName}`, title: title || undefined, overwrite, nonInteractive };
    }

    const name = await promptUntil(
      rl,
      "tool name (kebab-case): ",
      (value) => (isSafeSegment(value) ? null : "英小文字・数字・ハイフンのみ使用できます。")
    );
    const description = await promptUntil(
      rl,
      "description: ",
      (value) => (value.length > 0 ? null : "description は必須です。")
    );
    const agentsRaw = await promptUntil(
      rl,
      "agents (comma-separated): ",
      (value) => {
        const items = parseCsv(value);
        if (items.length === 0) {
          return "1つ以上の agent 名が必要です。";
        }
        if (!items.every((item) => isSafeSegment(item))) {
          return "agent 名は英小文字・数字・ハイフンのみ使用できます。";
        }
        return null;
      }
    );
    const skillsRaw = await promptUntil(rl, "skills (comma-separated, optional category/name): ", () => null, true);
    const tagsRaw = await promptUntil(rl, "tags (comma-separated, optional): ", () => null, true);
    const persona = await promptUntil(rl, "persona (optional): ", () => null, true);
    const overwrite = (await promptUntil(rl, "overwrite if exists? (y/N): ", () => null, true)).toLowerCase() === "y";

    const agents = parseCsv(agentsRaw);
    const skills = parseCsv(skillsRaw);
    if (!skills.every((skill) => validateSkillRef(skill))) {
      throw new Error("skills は category/name 形式で指定してください。");
    }

    return {
      type,
      name,
      description,
      agents,
      skills,
      tags: parseCsv(tagsRaw),
      persona: persona || undefined,
      overwrite,
      nonInteractive
    };
  } finally {
    rl.close();
  }
}

function writeTemplate(filePath: string, content: string, overwrite: boolean): void {
  if (existsSync(filePath) && !overwrite) {
    throw new Error(`既存ファイルがあるため作成を中断しました: ${filePath} (上書きするには --overwrite)`);
  }

  ensureParentDir(filePath);
  writeFileSync(filePath, content, "utf-8");
}

function validateOptions(options: ParsedOptions): void {
  if (options.type === "tool") {
    if (!isSafeSegment(options.name)) {
      throw new Error(`tool 名は英小文字・数字・ハイフンのみ使用できます: ${options.name}`);
    }
    if (!options.description || options.description.trim().length === 0) {
      throw new Error("tool の description が未指定です。");
    }
    if (!options.agents || options.agents.length === 0) {
      throw new Error("tool の agents が未指定です。");
    }
    if (!options.agents.every((agent) => isSafeSegment(agent))) {
      throw new Error("tool の agents は英小文字・数字・ハイフンのみ使用できます。");
    }
    if (options.skills && !options.skills.every((skill) => validateSkillRef(skill))) {
      throw new Error("tool の skills は category/name 形式で指定してください。");
    }
  }
}

async function run(argv: string[]): Promise<number> {
  const { args, nonInteractive, forceInteractive } = normalizeArgs(argv);
  let options: ParsedOptions;

  try {
    options = shouldUseInteractiveMode(args, nonInteractive, forceInteractive)
      ? await runWizard(argv)
      : parseOptions(argv);
    validateOptions(options);
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

    if (options.type === "tool") {
      const target = resolveToolFilePath(options.name);
      writeTemplate(target, buildToolTemplate(options), options.overwrite);
      console.log(`[scaffold] tool template created: ${target}`);
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

process.exit(await run(process.argv.slice(2)));
