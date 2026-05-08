import { z } from "zod";

/**
 * Plugin Manifest Schema (sfai.io/v1)
 *
 * Unified manifest for agents, skills, personas, and tool packs.
 * Enables version pinning, dependency resolution, and dynamic loading.
 */

export const PluginManifestSchema = z.object({
  apiVersion: z.literal("sfai.io/v1"),
  kind: z.enum(["Agent", "Skill", "Persona", "ToolPack"]),
  metadata: z.object({
    name: z.string().regex(/^[a-z0-9-]+$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    vendor: z.string().regex(/^[a-z0-9-]+$/).optional().default("sfai"),
    description: z.string(),
    labels: z.record(z.string()).optional(),
  }),
  spec: z.object({
    role: z.string().optional(),
    expertise: z.array(z.string()).optional(),
    systemPrompt: z.string().optional(),
    skillCategory: z.enum(["analysis", "generation", "orchestration", "governance"]).optional(),
    parameters: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean().optional(),
      description: z.string().optional(),
    })).optional(),
    archetype: z.string().optional(),
    traits: z.array(z.string()).optional(),
    dependencies: z.array(z.object({
      name: z.string(),
      vendor: z.string().optional().default("sfai"),
      version: z.string().optional(),
      optional: z.boolean().optional(),
    })).optional(),
    capabilities: z.array(z.string()).optional(),
    compatibilityMode: z.boolean().optional(),
  }).default({}),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export type PluginKind = PluginManifest["kind"];

/**
 * Unique plugin identifier in namespace: vendor/name@version
 */
export function pluginId(manifest: PluginManifest): string {
  return `${manifest.metadata.vendor}/${manifest.metadata.name}@${manifest.metadata.version}`;
}

/**
 * Unversioned plugin reference: vendor/name
 */
export function pluginRef(manifest: PluginManifest): string {
  return `${manifest.metadata.vendor}/${manifest.metadata.name}`;
}

/**
 * Parse plugin reference "vendor/name" or "vendor/name@version"
 */
export function parsePluginRef(ref: string): { vendor: string; name: string; version?: string } {
  const [nameWithVersion, ...rest] = ref.split("@");
  const [vendor, name] = nameWithVersion.split("/");

  if (!vendor || !name) {
    throw new Error(`Invalid plugin reference: ${ref}`);
  }

  return {
    vendor: vendor || "sfai",
    name,
    version: rest.length > 0 ? rest[0] : undefined,
  };
}

/**
 * Validate manifest against schema
 */
export function validateManifest(data: unknown): PluginManifest {
  return PluginManifestSchema.parse(data);
}
