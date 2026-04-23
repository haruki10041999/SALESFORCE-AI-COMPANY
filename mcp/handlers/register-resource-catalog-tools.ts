import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";

type ListMdFiles = (dir: string) => { name: string; summary: string }[];
type GetMdFile = (dir: string, name: string) => string;

interface RegisterResourceCatalogToolsDeps {
  govTool: GovTool;
  listMdFiles: ListMdFiles;
  getMdFile: GetMdFile;
}

export function registerResourceCatalogTools(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, listMdFiles, getMdFile } = deps;

  govTool(
    "list_agents",
    {
      title: "List Agents",
      description: "List all available AI agents with a short description each.",
      inputSchema: {}
    },
    async () => {
      const agents = listMdFiles("agents");
      return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
    }
  );

  govTool(
    "get_agent",
    {
      title: "Get Agent Definition",
      description: "Return the full definition markdown for a specific agent by name.",
      inputSchema: { name: z.string() }
    },
    async ({ name }: { name: string }) => {
      const content = getMdFile("agents", name);
      return { content: [{ type: "text", text: content }] };
    }
  );

  govTool(
    "list_skills",
    {
      title: "List Skills",
      description: "List all available Salesforce skills with a short description each.",
      inputSchema: {}
    },
    async () => {
      const skills = listMdFiles("skills");
      return { content: [{ type: "text", text: JSON.stringify(skills, null, 2) }] };
    }
  );

  govTool(
    "get_skill",
    {
      title: "Get Skill Definition",
      description: "Return the full skill markdown for a specific skill by name.",
      inputSchema: { name: z.string() }
    },
    async ({ name }: { name: string }) => {
      const content = getMdFile("skills", name);
      return { content: [{ type: "text", text: content }] };
    }
  );

  govTool(
    "list_personas",
    {
      title: "List Personas",
      description: "List all available AI personas (personality/communication styles).",
      inputSchema: {}
    },
    async () => {
      const personas = listMdFiles("personas");
      return { content: [{ type: "text", text: JSON.stringify(personas, null, 2) }] };
    }
  );
}

