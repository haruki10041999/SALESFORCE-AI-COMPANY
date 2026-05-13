#!/usr/bin/env tsx
import { promises as fsPromises } from "node:fs";
import { join, resolve, basename } from "node:path";
import { parseArgs } from "node:util";

type CliOptions = {
  sourceDir: string;
  outDir: string;
  datasourceUid: string;
};

function parseCliArgs(argv: string[]): CliOptions {
  const { values } = parseArgs({
    options: {
      "source-dir": { type: "string" },
      "out-dir": { type: "string" },
      "datasource-uid": { type: "string" }
    },
    allowPositionals: false,
    args: argv
  });

  return {
    sourceDir: resolve(values["source-dir"] ?? "infra/observability/grafana-dashboards/jsonnet"),
    outDir: resolve(values["out-dir"] ?? "infra/observability/grafana-dashboards/generated"),
    datasourceUid: values["datasource-uid"] ?? "${DS_PROMETHEUS}"
  };
}

function deepReplaceDatasource(value: unknown, datasourceUid: string): unknown {
  if (typeof value === "string") {
    return value === "$__DS_PROMETHEUS__" ? datasourceUid : value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => deepReplaceDatasource(item, datasourceUid));
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      next[k] = deepReplaceDatasource(v, datasourceUid);
    }
    return next;
  }

  return value;
}

async function renderDashboardFile(filePath: string, options: CliOptions): Promise<string> {
  const raw = await fsPromises.readFile(filePath, "utf-8");
  let parsed: unknown;
  try {
    // Templates are stored as JSON-compatible Jsonnet subset.
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON-compatible jsonnet template: ${filePath} (${String(error)})`);
  }

  const rendered = deepReplaceDatasource(parsed, options.datasourceUid);
  const outName = `${basename(filePath, ".jsonnet")}.json`;
  const outPath = join(options.outDir, outName);

  await fsPromises.mkdir(options.outDir, { recursive: true });
  await fsPromises.writeFile(outPath, `${JSON.stringify(rendered, null, 2)}\n`, "utf-8");

  return outPath;
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  const entries = await fsPromises.readdir(options.sourceDir, { withFileTypes: true });
  const templates = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonnet"))
    .map((entry) => join(options.sourceDir, entry.name))
    .sort();

  if (templates.length === 0) {
    throw new Error(`No jsonnet templates found in ${options.sourceDir}`);
  }

  const outputs: string[] = [];
  for (const templatePath of templates) {
    const outPath = await renderDashboardFile(templatePath, options);
    outputs.push(outPath);
  }

  console.log(JSON.stringify({ rendered: outputs.length, outputs }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
