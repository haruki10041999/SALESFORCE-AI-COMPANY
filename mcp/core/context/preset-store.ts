import { existsSync, promises as fsPromises } from "fs";
import { join } from "path";
import type { ChatPreset, StoredPreset } from "../types/index.js";
import { FileUnitOfWork } from "../persistence/unit-of-work.js";

export type { ChatPreset, StoredPreset };

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
    const payload = JSON.stringify(versionedPreset, null, 2);
    const unitOfWork = new FileUnitOfWork();
    await unitOfWork.stageFileWrite(versionFilePath, payload);
    await unitOfWork.stageFileWrite(latestFilePath, payload);
    await unitOfWork.commit();
  }

  async function listPresetsData(): Promise<StoredPreset[]> {
    if (!existsSync(presetsDir)) return [];
    const files = await fsPromises.readdir(presetsDir);
    const latestByName = new Map<string, StoredPreset>();

    function keepLatest(preset: ChatPreset): void {
      const stored: StoredPreset = {
        ...preset,
        skills: preset.skills ?? []
      };
      const current = latestByName.get(stored.name);
      const nextVersion = stored.version ?? 0;
      const currentVersion = current?.version ?? 0;
      if (!current || nextVersion >= currentVersion) {
        latestByName.set(stored.name, stored);
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

  async function getPreset(name: string): Promise<StoredPreset | null> {
    const presets = await listPresetsData();
    return presets.find((p) => p.name === name) ?? null;
  }

  return { createPreset, listPresetsData, getPreset };
}
