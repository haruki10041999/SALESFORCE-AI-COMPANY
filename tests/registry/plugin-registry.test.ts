import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginRegistry } from "../../mcp/core/registry/plugin-registry.js";
import { validateManifest, type PluginManifest } from "../../mcp/core/registry/plugin-manifest.js";

// Helper to create valid manifests for testing
function createManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  const base = {
    apiVersion: "sfai.io/v1" as const,
    kind: "Skill" as const,
    metadata: {
      name: "test",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
    ...overrides,
  };
  return validateManifest(base);
}

test("PluginRegistry registers and retrieves plugins", () => {
  const registry = new PluginRegistry();

  const manifest = createManifest({
    metadata: {
      name: "architect",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
  });

  registry.register(manifest);

  const retrieved = registry.get("sfai", "architect");
  assert.equal(retrieved?.metadata.version, "1.0.0");
});

test("PluginRegistry tracks latest version", () => {
  const registry = new PluginRegistry();

  const v1: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Skill",
    metadata: {
      name: "test-skill",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  const v2: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Skill",
    metadata: {
      name: "test-skill",
      version: "2.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  registry.register(v1);
  registry.register(v2);

  const latest = registry.get("sfai", "test-skill");
  assert.equal(latest?.metadata.version, "2.0.0");
});

test("PluginRegistry getVersion retrieves exact version", () => {
  const registry = new PluginRegistry();

  const manifest: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Persona",
    metadata: {
      name: "detective",
      version: "1.5.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  registry.register(manifest);

  const retrieved = registry.getVersion("sfai", "detective", "1.5.0");
  assert.equal(retrieved?.metadata.version, "1.5.0");

  const notFound = registry.getVersion("sfai", "detective", "1.0.0");
  assert.equal(notFound, undefined);
});

test("PluginRegistry filters by kind", () => {
  const registry = new PluginRegistry();

  const agent: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Agent",
    metadata: {
      name: "agent1",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  const skill: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Skill",
    metadata: {
      name: "skill1",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  registry.register(agent);
  registry.register(skill);

  assert.equal(registry.getByKind("Agent").length, 1);
  assert.equal(registry.getByKind("Skill").length, 1);
  assert.equal(registry.getByKind("Persona").length, 0);
});

test("PluginRegistry prevents duplicate registration", () => {
  const registry = new PluginRegistry();

  const manifest: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Agent",
    metadata: {
      name: "test",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  registry.register(manifest);

  assert.throws(() => {
    registry.register(manifest);
  }, /already registered/);
});

test("PluginRegistry detects circular dependencies", () => {
  const registry = new PluginRegistry();

  const a: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Skill",
    metadata: {
      name: "a",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {
      dependencies: [{ name: "b", vendor: "sfai" }],
    },
  };

  const b: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Skill",
    metadata: {
      name: "b",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {
      dependencies: [{ name: "a", vendor: "sfai" }],
    },
  };

  registry.register(a);
  registry.register(b);

  const result = registry.validateDependencies();
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Circular")));
});

test("PluginRegistry satisfies dependencies", () => {
  const registry = new PluginRegistry();

  const plugin: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Skill",
    metadata: {
      name: "test",
      version: "1.5.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  registry.register(plugin);

  // Exact match
  assert.ok(registry.satisfiesDependency("sfai", "test", "1.5.0"));

  // Caret range
  assert.ok(registry.satisfiesDependency("sfai", "test", "^1.0.0"));

  // Tilde range
  assert.ok(registry.satisfiesDependency("sfai", "test", "~1.5.0"));

  // Latest (no version)
  assert.ok(registry.satisfiesDependency("sfai", "test"));

  // Not found
  assert.equal(registry.satisfiesDependency("sfai", "notfound"), false);
});

test("PluginRegistry lists all plugins", () => {
  const registry = new PluginRegistry();

  const plugins: PluginManifest[] = [
    {
      apiVersion: "sfai.io/v1",
      kind: "Agent",
      metadata: {
        name: "agent1",
        version: "1.0.0",
        vendor: "sfai",
        description: "Test",
      },
      spec: {},
    },
    {
      apiVersion: "sfai.io/v1",
      kind: "Skill",
      metadata: {
        name: "skill1",
        version: "1.0.0",
        vendor: "acme",
        description: "Test",
      },
      spec: {},
    },
  ];

  plugins.forEach((p) => registry.register(p));

  assert.equal(registry.list().length, 2);
});

test("PluginRegistry can be cleared", () => {
  const registry = new PluginRegistry();

  const manifest: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Agent",
    metadata: {
      name: "test",
      version: "1.0.0",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  registry.register(manifest);
  assert.equal(registry.list().length, 1);

  registry.clear();
  assert.equal(registry.list().length, 0);
});
