import { existsSync, promises as fsPromises } from "fs";
import { join } from "path";

export interface ChatPreset {
  name: string;
  description: string;
  topic: string;
  agents: string[];
  skills: string[];
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

  async function createPreset(preset: ChatPreset): Promise<void> {
    await ensureDir(presetsDir);
    const fileName = preset.name.toLowerCase().replace(/\s+/g, "-");
    const filePath = join(presetsDir, fileName + ".json");
    await fsPromises.writeFile(filePath, JSON.stringify(preset, null, 2));
  }

  async function listPresetsData(): Promise<ChatPreset[]> {
    if (!existsSync(presetsDir)) return [];
    const files = await fsPromises.readdir(presetsDir);
    const presets: ChatPreset[] = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = await fsPromises.readFile(join(presetsDir, file), "utf-8");
          presets.push(JSON.parse(content));
        } catch {
          // skip corrupted files
        }
      }
    }
    return presets;
  }

  async function getPreset(name: string): Promise<ChatPreset | null> {
    const presets = await listPresetsData();
    return presets.find((p) => p.name === name) ?? null;
  }

  return { createPreset, listPresetsData, getPreset };
}
