import type { PluginManifest, PluginKind } from "./plugin-manifest.js";
import { pluginId, pluginRef } from "./plugin-manifest.js";

/**
 * In-memory plugin registry
 * Manages loaded plugins, version resolution, and dependency tracking
 */
export class PluginRegistry {
  private plugins: Map<string, PluginManifest> = new Map();
  private byKind: Map<PluginKind, PluginManifest[]> = new Map();
  private latestVersions: Map<string, PluginManifest> = new Map(); // vendor/name -> latest

  /**
   * Register a plugin manifest
   */
  register(manifest: PluginManifest): void {
    const id = pluginId(manifest);
    const ref = pluginRef(manifest);

    // Check for duplicate
    if (this.plugins.has(id)) {
      throw new Error(`Plugin already registered: ${id}`);
    }

    this.plugins.set(id, manifest);

    // Index by kind
    if (!this.byKind.has(manifest.kind)) {
      this.byKind.set(manifest.kind, []);
    }
    this.byKind.get(manifest.kind)!.push(manifest);

    // Track latest version
    const current = this.latestVersions.get(ref);
    if (!current || this.compareVersions(manifest.metadata.version, current.metadata.version) > 0) {
      this.latestVersions.set(ref, manifest);
    }
  }

  /**
   * Get plugin by unversioned reference (returns latest)
   */
  get(vendor: string, name: string): PluginManifest | undefined {
    return this.latestVersions.get(`${vendor}/${name}`);
  }

  /**
   * Get plugin by exact version
   */
  getVersion(vendor: string, name: string, version: string): PluginManifest | undefined {
    return this.plugins.get(`${vendor}/${name}@${version}`);
  }

  /**
   * Get all plugins of a kind
   */
  getByKind(kind: PluginKind): PluginManifest[] {
    return this.byKind.get(kind) ?? [];
  }

  /**
   * List all registered plugins
   */
  list(): PluginManifest[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Check if dependency is satisfied
   */
  satisfiesDependency(vendor: string, name: string, versionRange?: string): boolean {
    const plugin = this.get(vendor, name);
    if (!plugin) return false;

    if (!versionRange) return true;

    // Simple semver range support: ^1.0.0, ~1.0.0, 1.0.0
    return this.matchesVersionRange(plugin.metadata.version, versionRange);
  }

  /**
   * Validate dependency chain (detect cycles)
   */
  validateDependencies(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const visited = new Set<string>();
    const inProgress = new Set<string>();

    const visit = (ref: string, path: string[] = []): boolean => {
      if (visited.has(ref)) return true;
      if (inProgress.has(ref)) {
        errors.push(`Circular dependency detected: ${[...path, ref].join(" -> ")}`);
        return false;
      }

      inProgress.add(ref);

      const plugin = this.latestVersions.get(ref);
      if (!plugin) {
        errors.push(`Dependency not found: ${ref}`);
        inProgress.delete(ref);
        return false;
      }

      const deps = plugin.spec.dependencies ?? [];
      let allValid = true;
      for (const dep of deps) {
        const depRef = `${dep.vendor || "sfai"}/${dep.name}`;
        if (!visit(depRef, [...path, ref])) {
          allValid = false;
        }
      }

      inProgress.delete(ref);
      visited.add(ref);
      return allValid;
    };

    // Check all plugins
    for (const ref of this.latestVersions.keys()) {
      if (!visited.has(ref)) {
        visit(ref);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Clear all plugins
   */
  clear(): void {
    this.plugins.clear();
    this.byKind.clear();
    this.latestVersions.clear();
  }

  // Helpers

  private compareVersions(v1: string, v2: string): number {
    const parse = (v: string) => v.split(".").map(Number);
    const [maj1, min1, pat1] = parse(v1);
    const [maj2, min2, pat2] = parse(v2);

    if (maj1 !== maj2) return maj1 - maj2;
    if (min1 !== min2) return min1 - min2;
    return pat1 - pat2;
  }

  private matchesVersionRange(version: string, range: string): boolean {
    if (range === "*" || range === "") return true;
    if (version === range) return true;

    // Simple caret/tilde matching
    if (range.startsWith("^")) {
      const target = range.slice(1);
      const [majTarget] = target.split(".").map(Number);
      const [maj] = version.split(".").map(Number);
      return maj === majTarget && this.compareVersions(version, target) >= 0;
    }

    if (range.startsWith("~")) {
      const target = range.slice(1);
      const [majTarget, minTarget] = target.split(".").map(Number);
      const [maj, min] = version.split(".").map(Number);
      return maj === majTarget && min === minTarget && this.compareVersions(version, target) >= 0;
    }

    return version === range;
  }
}

/**
 * Global plugin registry instance
 */
let globalRegistry: PluginRegistry | null = null;

export function getGlobalRegistry(): PluginRegistry {
  if (!globalRegistry) {
    globalRegistry = new PluginRegistry();
  }
  return globalRegistry;
}

export function resetGlobalRegistry(): void {
  globalRegistry = new PluginRegistry();
}
