import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmarkSuite } from "../mcp/tools/benchmark-suite.js";

type CliOptions = {
  output: string;
  recentTraceLimit: number;
  scenarios: string[];
  /** TASK-F9: when true, ingest scenarios from outputs/tool-catalog.json. */
  useRegisteredTools: boolean;
  toolCatalogPath: string;
};

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_OUTPUT = join(ROOT, "outputs", "reports", "benchmark-suite.json");

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    output: DEFAULT_OUTPUT,
    recentTraceLimit: parsePositiveInt(process.env.SF_AI_BENCHMARK_TRACE_LIMIT, 300),
    scenarios: [],
    useRegisteredTools: false,
    toolCatalogPath: join(ROOT, "outputs", "tool-catalog.json")
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--output" && argv[i + 1]) {
      options.output = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--limit" && argv[i + 1]) {
      options.recentTraceLimit = parsePositiveInt(argv[i + 1], options.recentTraceLimit);
      i += 1;
      continue;
    }
    if (token === "--scenario" && argv[i + 1]) {
      options.scenarios.push(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--use-registered-tools") {
      options.useRegisteredTools = true;
      continue;
    }
    if (token === "--tool-catalog" && argv[i + 1]) {
      options.toolCatalogPath = resolve(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  return options;
}

function loadRegisteredScenariosFromCatalog(catalogPath: string): string[] {
  if (!existsSync(catalogPath)) {
    console.warn(`[benchmark] tool catalog not found: ${catalogPath} (run 'npm run tools:catalog' first)`);
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    const tools = Array.isArray(raw?.tools) ? raw.tools : [];
    return tools.map((t: { name?: unknown }) => String(t?.name ?? "")).filter((s: string) => s.length > 0);
  } catch (err) {
    console.warn(`[benchmark] failed to read tool catalog: ${(err as Error).message}`);
    return [];
  }
}

function run(): void {
  const options = parseArgs(process.argv.slice(2));

  const result = runBenchmarkSuite({
    scenarios: options.scenarios.length > 0 ? options.scenarios : undefined,
    recentTraceLimit: options.recentTraceLimit,
    useRegisteredTools: options.useRegisteredTools,
    loadRegisteredScenarios: () => loadRegisteredScenariosFromCatalog(options.toolCatalogPath)
  });

  const outputPayload = {
    generatedAt: new Date().toISOString(),
    input: {
      recentTraceLimit: options.recentTraceLimit,
      scenarios: options.scenarios
    },
    result
  };

  if (!existsSync(dirname(options.output))) {
    mkdirSync(dirname(options.output), { recursive: true });
  }
  writeFileSync(options.output, `${JSON.stringify(outputPayload, null, 2)}\n`, "utf-8");

  console.log(`[benchmark] output: ${options.output}`);
  console.log(`[benchmark] overallScore=${result.overallScore} grade=${result.grade}`);
  console.log(`[benchmark] successRate=${result.metricsSnapshot.successRate} p95=${result.metricsSnapshot.p95DurationMs}ms`);
}

run();
