/**
 * Prompt rendering facade.
 *
 * server.ts holds project-root and markdown-catalog wiring. This module exposes a
 * thin factory that captures those dependencies and returns the legacy
 * `buildChatPrompt` / `buildChatPromptCompat` signatures used by the MCP server
 * boundary. The actual composition lives in `chat-prompt-builder.ts`.
 *
 * TASK-F2: extracted from server.ts to keep the entry file focused on tool
 * registration and lifecycle wiring.
 */
import { buildChatPromptFromContext } from "./chat-prompt-builder.js";

export type FindMdFilesRecursiveFn = (dir: string) => string[];
export type ToPosixPathFn = (p: string) => string;
export type TruncateContentFn = (text: string, maxChars: number, label?: string) => string;
export type GetMdFileAsyncFn = (dir: string, name: string) => Promise<string>;

export interface PromptRendererDeps {
  root: string;
  findMdFilesRecursive: FindMdFilesRecursiveFn;
  toPosixPath: ToPosixPathFn;
  truncateContent: TruncateContentFn;
  getMdFileAsync: GetMdFileAsyncFn;
}

export interface PromptRenderer {
  buildChatPrompt(
    topic: string,
    agentNames: string[],
    personaName: string | undefined,
    skillNames: string[],
    filePaths: string[],
    turns: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ): Promise<string>;
  buildChatPromptCompat(
    topic: string,
    agentNames: string[],
    personaName?: string,
    skillNames?: string[],
    filePaths?: string[],
    turns?: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ): Promise<string>;
}

/**
 * Build a prompt-renderer bound to a specific project root and catalog helpers.
 *
 * The legacy positional API (`buildChatPrompt` / `buildChatPromptCompat`) is
 * preserved verbatim so that registered tool handlers can keep their existing
 * call sites untouched.
 */
export function createPromptRenderer(deps: PromptRendererDeps): PromptRenderer {
  const buildChatPrompt: PromptRenderer["buildChatPrompt"] = (
    topic,
    agentNames,
    personaName,
    skillNames,
    filePaths,
    turns,
    maxContextChars,
    appendInstruction,
    includeProjectContext
  ) =>
    buildChatPromptFromContext(
      {
        topic,
        agentNames,
        personaName,
        skillNames,
        filePaths,
        turns,
        maxContextChars,
        appendInstruction,
        includeProjectContext
      },
      {
        root: deps.root,
        findMdFilesRecursive: deps.findMdFilesRecursive,
        toPosixPath: deps.toPosixPath,
        truncateContent: deps.truncateContent,
        getMdFileAsync: deps.getMdFileAsync
      }
    );

  const buildChatPromptCompat: PromptRenderer["buildChatPromptCompat"] = (
    topic,
    agentNames,
    personaName,
    skillNames,
    filePaths,
    turns,
    maxContextChars,
    appendInstruction,
    includeProjectContext
  ) =>
    buildChatPrompt(
      topic,
      agentNames,
      personaName,
      skillNames ?? [],
      filePaths ?? [],
      turns ?? 6,
      maxContextChars,
      appendInstruction,
      includeProjectContext
    );

  return { buildChatPrompt, buildChatPromptCompat };
}
