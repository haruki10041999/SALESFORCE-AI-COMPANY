#!/usr/bin/env node

import { spawn } from "node:child_process";
import net from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const DEFAULT_SERVER_ARGS = ["node", "dist/mcp/server.js"];
const DEFAULT_SERVICES = ["postgres", "ollama"];
const PROFILE_SERVICES = new Map([
  ["observability", ["jaeger", "prometheus", "grafana"]]
]);
const DEFAULT_SERVICE_PORTS = new Map([
  ["postgres", 5432],
  ["ollama", 11434],
  ["jaeger", 16686],
  ["prometheus", 9090],
  ["grafana", 3000]
]);
const DEFAULT_WAIT_PORTS = [5432, 11434];
const WAIT_TIMEOUT_MS = Number.parseInt(process.env.SF_AI_DOCKER_WAIT_TIMEOUT_MS ?? "120000", 10);
const WAIT_INTERVAL_MS = Number.parseInt(process.env.SF_AI_DOCKER_WAIT_INTERVAL_MS ?? "1000", 10);

function log(message) {
  process.stderr.write(`[start-mcp-with-docker] ${message}\n`);
}

function parseList(value, fallback) {
  if (!value) return fallback;
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values)];
}

function normalizeCommandArg(arg) {
  if (!arg) return arg;
  if (arg.startsWith("-") || isAbsolute(arg)) return arg;
  if (arg.includes(":/") || arg.includes(":\\")) return arg;
  if (arg.startsWith("dist/") || arg.startsWith("mcp/") || arg.startsWith("scripts/") || arg.startsWith("./") || arg.startsWith("../")) {
    return resolve(REPO_ROOT, arg);
  }
  return arg;
}

function resolveServerCommand(argv) {
  const separatorIndex = argv.indexOf("--");
  const explicitArgs = separatorIndex >= 0 ? argv.slice(separatorIndex + 1) : [];
  const rawArgs = explicitArgs.length > 0 ? explicitArgs : DEFAULT_SERVER_ARGS;
  const [command, ...args] = rawArgs.map(normalizeCommandArg);
  return { command, args };
}

function createDockerArgs() {
  const profile = process.env.SF_AI_DOCKER_PROFILE?.trim();
  const requestedServices = parseList(process.env.SF_AI_DOCKER_SERVICES, DEFAULT_SERVICES);
  const profileServices = profile ? (PROFILE_SERVICES.get(profile) ?? []) : [];
  const services = unique(requestedServices.concat(profileServices));
  const args = ["compose"];
  if (profile) {
    args.push("--profile", profile);
  }
  args.push("up", "-d", ...services);
  return { args, services };
}

async function getComposeServices() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", "config", "--services"], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `docker compose config --services exited with code ${code ?? -1}`));
        return;
      }
      resolvePromise(stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    });
  });
}

async function getComposePs() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("docker", ["compose", "ps", "--format", "json"], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf-8");
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectPromise(new Error(stderr.trim() || `docker compose ps --format json exited with code ${code ?? -1}`));
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        resolvePromise([]);
        return;
      }

      try {
        if (trimmed.startsWith("[")) {
          resolvePromise(JSON.parse(trimmed));
          return;
        }
        resolvePromise(trimmed.split(/\r?\n/).map((line) => JSON.parse(line)));
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}

function streamToStderr(prefix, chunk) {
  const text = chunk.toString("utf-8");
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      process.stderr.write(`[${prefix}] ${line}\n`);
    }
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      ...options
    });

    child.stdout?.on("data", (chunk) => streamToStderr(command, chunk));
    child.stderr?.on("data", (chunk) => streamToStderr(command, chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code ?? -1}`));
    });
  });
}

function waitForPort(port) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolvePromise();
    });
    socket.once("error", (error) => {
      socket.destroy();
      rejectPromise(error);
    });
  });
}

async function waitForPorts(ports) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  const remaining = unique(ports);

  while (remaining.length > 0) {
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const port = remaining[index];
      try {
        await waitForPort(port);
        log(`port ${port} is ready`);
        remaining.splice(index, 1);
      } catch {
        // Retry until timeout.
      }
    }

    if (remaining.length === 0) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ports: ${remaining.join(", ")}`);
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, WAIT_INTERVAL_MS));
  }
}

function getServiceHealth(record) {
  const raw = record?.Health ?? record?.health ?? record?.State ?? record?.state ?? "";
  return String(raw).toLowerCase();
}

function getServiceStatus(record) {
  const raw = record?.Status ?? record?.status ?? "";
  return String(raw).toLowerCase();
}

async function waitForServiceRecords(services) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  const remaining = unique(services);

  while (remaining.length > 0) {
    let records = [];
    try {
      records = await getComposePs();
    } catch {
      return;
    }

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const service = remaining[index];
      const record = records.find((item) => item.Service === service || item.service === service || item.Name?.includes(service) || item.name?.includes(service));
      if (!record) {
        continue;
      }

      const health = getServiceHealth(record);
      const status = getServiceStatus(record);
      const healthy = health.includes("healthy");
      const oneShotCompleted = status.includes("exited (0)");
      const startedWithoutHealthcheck = !health && (status.includes("running") || status.includes("up") || oneShotCompleted);
      if (healthy || startedWithoutHealthcheck) {
        log(`service ${service} is ready${health ? ` (${health})` : ""}`);
        remaining.splice(index, 1);
      }
    }

    if (remaining.length === 0) {
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for services: ${remaining.join(", ")}`);
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, WAIT_INTERVAL_MS));
  }
}

function inferPortsFromServices(services) {
  return services
    .map((service) => DEFAULT_SERVICE_PORTS.get(service))
    .filter((port) => Number.isFinite(port));
}

function spawnServer(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["inherit", "inherit", "inherit"],
      shell: false
    });

    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      process.exitCode = code ?? 0;
      resolvePromise();
    });
  });
}

async function main() {
  const skipDockerBootstrap = (process.env.SF_AI_SKIP_DOCKER_BOOTSTRAP ?? "false").toLowerCase() === "true";
  const { command, args } = resolveServerCommand(process.argv.slice(2));

  if (!skipDockerBootstrap) {
    const configured = createDockerArgs();
    const availableServices = await getComposeServices();
    const services = configured.services.filter((service) => availableServices.includes(service));
    const skippedServices = configured.services.filter((service) => !availableServices.includes(service));
    if (skippedServices.length > 0) {
      log(`skipping missing compose services: ${skippedServices.join(", ")}`);
    }
    if (services.length > 0) {
      const dockerArgs = configured.args.slice(0, configured.args.indexOf("up") + 2).concat(services);
      log(`bootstrapping docker services: ${services.join(", ")}`);
      await runCommand("docker", dockerArgs);
      log(`waiting for service status: ${services.join(", ")}`);
      await waitForServiceRecords(services);
    } else {
      log("no matching compose services to bootstrap; skipping docker compose up");
    }

    const waitPorts = parseList(
      process.env.SF_AI_WAIT_FOR_PORTS,
      (services.length > 0 ? inferPortsFromServices(services) : DEFAULT_WAIT_PORTS).map(String)
    ).map((value) => Number.parseInt(value, 10)).filter(Number.isFinite);
    if (waitPorts.length > 0) {
      log(`waiting for ports: ${waitPorts.join(", ")}`);
      await waitForPorts(waitPorts);
    }
  }

  log(`starting MCP server: ${command} ${args.join(" ")}`);
  await spawnServer(command, args);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  log(message);
  process.exitCode = 1;
});
