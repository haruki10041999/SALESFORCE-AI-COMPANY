import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type OutputsBackend = "fs" | "s3";

const DEFAULT_OUTPUTS_DIR = resolve(process.cwd(), "outputs");

function resolveOutputsRootDir(): string {
  const raw = process.env.SF_AI_OUTPUTS_DIR?.trim();
  if (!raw) {
    return DEFAULT_OUTPUTS_DIR;
  }
  return resolve(raw);
}

export function resolveOutputsBackend(): OutputsBackend {
  const backend = (process.env.OUTPUTS_BACKEND ?? process.env.SF_AI_OUTPUTS_BACKEND ?? "fs").trim().toLowerCase();
  return backend === "s3" ? "s3" : "fs";
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/^[/\\]+/, "").replaceAll("\\", "/");
}

function joinS3Url(baseUrl: string, relativePath: string): string {
  const base = baseUrl.replace(/[\/]+$/, "");
  const rel = normalizeRelativePath(relativePath);
  return `${base}/${rel}`;
}

export async function writeOutputsArtifact(
  relativePath: string,
  content: string,
  options: { contentType?: string } = {}
): Promise<{ backend: OutputsBackend; location: string }> {
  const backend = resolveOutputsBackend();

  if (backend === "fs") {
    const root = resolveOutputsRootDir();
    const fullPath = resolve(root, normalizeRelativePath(relativePath));
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
    return { backend, location: fullPath };
  }

  const baseUrl = process.env.SF_AI_OUTPUTS_S3_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("SF_AI_OUTPUTS_S3_BASE_URL is required when OUTPUTS_BACKEND=s3");
  }

  const targetUrl = joinS3Url(baseUrl, relativePath);
  const headers: Record<string, string> = {
    "content-type": options.contentType ?? "application/json"
  };

  const authHeader = process.env.SF_AI_OUTPUTS_S3_AUTH_HEADER?.trim();
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const response = await fetch(targetUrl, {
    method: "PUT",
    headers,
    body: content
  });

  if (!response.ok) {
    throw new Error(`S3 output write failed: ${response.status} ${response.statusText}`);
  }

  return { backend, location: targetUrl };
}
