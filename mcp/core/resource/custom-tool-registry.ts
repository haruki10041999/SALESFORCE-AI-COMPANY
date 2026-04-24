import { z } from "zod";
import { existsSync, promises as fsPromises } from "fs";
import { join } from "path";
import type { GovTool } from "@mcp/tool-types.js";

export interface CustomToolDefinition {
  name: string;
  description: string;
  agents: string[];
  skills: string[];
  tags?: string[];
  persona?: string;
  createdAt: string;
}

interface CreateCustomToolRegistryDeps {
  govTool: GovTool;
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  buildChatPrompt: (
    topic: string,
    agents: string[],
    persona?: string,
    skills?: string[],
    filePaths?: string[],
    maxFiles?: number,
    maxContextChars?: number,
    appendInstruction?: string
  ) => Promise<string>;
}

export function createCustomToolRegistry(deps: CreateCustomToolRegistryDeps) {
  const { govTool, filterDisabledSkills, buildChatPrompt } = deps;
  const loadedCustomToolNames = new Set<string>();

  function registerCustomTool(def: CustomToolDefinition): void {
    if (loadedCustomToolNames.has(def.name)) return;
    loadedCustomToolNames.add(def.name);
    govTool(
      def.name,
      {
        title: def.name,
        description: def.description,
        tags: def.tags ?? [],
        inputSchema: {
          topic: z.string().optional(),
          maxContextChars: z.number().int().min(500).max(200000).optional()
        }
      },
      async ({ topic, maxContextChars }: { topic?: string; maxContextChars?: number }) => {
        const { enabled: enabledSkills } = await filterDisabledSkills(def.skills ?? []);
        const prompt = await buildChatPrompt(
          topic ?? def.name,
          def.agents,
          def.persona,
          enabledSkills,
          [],
          6,
          maxContextChars
        );
        return { content: [{ type: "text", text: prompt }] };
      }
    );
  }

  function unregisterCustomTool(name: string): void {
    loadedCustomToolNames.delete(name);
  }

  async function loadCustomToolsFromDir(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    let files: string[];
    try {
      files = await fsPromises.readdir(dir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = await fsPromises.readFile(join(dir, file), "utf-8");
        const def = JSON.parse(raw) as CustomToolDefinition;
        registerCustomTool(def);
      } catch {
        // 壊れたファイルはスキップ
      }
    }
  }

  return {
    loadedCustomToolNames,
    registerCustomTool,
    unregisterCustomTool,
    loadCustomToolsFromDir
  };
}

