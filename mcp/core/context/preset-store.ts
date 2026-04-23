import { existsSync, promises as fsPromises } from "fs";
import { join } from "path";

export interface ChatPreset {
  name: string;
  description: string;
  topic: string;
  agents: string[];
  skills: string[];
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  persona?: string;
  filePaths?: string[];
  triggerRules?: Array<{
    whenAgent: string;
    thenAgent: string;
    messageIncludes?: string;
    reason?: string;
    once?: boolean;
  }>;
}

interface PresetStoreDeps {
  presetsDir: string;
  ensureDir: (dir: string) => Promise<void>;
}

export function createPresetStore(deps: PresetStoreDeps) {
  const { presetsDir, ensureDir } = deps;

  function toPresetSlug(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, "-");
  }

  async function resolveNextPresetVersion(versionDir: string): Promise<number> {
    if (!existsSync(versionDir)) {
      return 1;
    }
    const entries = await fsPromises.readdir(versionDir);
    const versions = entries
      .map((fileName) => {
        const match = /^v(\d+)\.json$/.exec(fileName);
        return match ? Number.parseInt(match[1], 10) : undefined;
      })
      .filter((version): version is number => version !== undefined && version > 0);
    return versions.length === 0 ? 1 : Math.max(...versions) + 1;
  }

  async function createPreset(preset: ChatPreset): Promise<void> {
    await ensureDir(presetsDir);
    const slug = toPresetSlug(preset.name);
    const versionDir = join(presetsDir, slug);
    await ensureDir(versionDir);

    const nextVersion = await resolveNextPresetVersion(versionDir);
    const now = new Date().toISOString();
    const versionedPreset: ChatPreset = {
      ...preset,
      version: nextVersion,
      createdAt: preset.createdAt ?? now,
      updatedAt: now,
      skills: preset.skills ?? []
    };

    const versionFilePath = join(versionDir, `v${nextVersion}.json`);
    const latestFilePath = join(presetsDir, slug + ".json");
    await fsPromises.writeFile(versionFilePath, JSON.stringify(versionedPreset, null, 2), "utf-8");
    await fsPromises.writeFile(latestFilePath, JSON.stringify(versionedPreset, null, 2), "utf-8");
  }

  async function listPresetsData(): Promise<ChatPreset[]> {
    if (!existsSync(presetsDir)) return [];
    const files = await fsPromises.readdir(presetsDir);
    const latestByName = new Map<string, ChatPreset>();

    function keepLatest(preset: ChatPreset): void {
      const current = latestByName.get(preset.name);
      const nextVersion = preset.version ?? 0;
      const currentVersion = current?.version ?? 0;
      if (!current || nextVersion >= currentVersion) {
        latestByName.set(preset.name, preset);
      }
    }

    for (const file of files) {
      const fullPath = join(presetsDir, file);
      const stat = await fsPromises.stat(fullPath);
      if (stat.isDirectory()) {
        const versionFiles = await fsPromises.readdir(fullPath);
        for (const versionFile of versionFiles) {
          if (!/^v\d+\.json$/.test(versionFile)) {
            continue;
          }
          try {
            const content = await fsPromises.readFile(join(fullPath, versionFile), "utf-8");
            keepLatest(JSON.parse(content));
          } catch {
            // skip corrupted files
          }
        }
        continue;
      }

      if (file.endsWith(".json") && !/^v\d+\.json$/.test(file)) {
        try {
          const content = await fsPromises.readFile(fullPath, "utf-8");
          keepLatest(JSON.parse(content));
        } catch {
          // skip corrupted files
        }
      }
    }

    return [...latestByName.values()];
  }

  async function getPreset(name: string): Promise<ChatPreset | null> {
    const presets = await listPresetsData();
    return presets.find((p) => p.name === name) ?? null;
  }

  return { createPreset, listPresetsData, getPreset };
}
