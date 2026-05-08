import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateManifest,
  pluginId,
  pluginRef,
  parsePluginRef,
  type PluginManifest,
} from "../../mcp/core/registry/plugin-manifest.js";

test("validateManifest accepts valid v1 manifest", () => {
  const data = {
    apiVersion: "sfai.io/v1",
    kind: "Agent",
    metadata: {
      name: "architect",
      version: "1.0.0",
      vendor: "sfai",
      description: "Architecture specialist",
    },
    spec: {
      role: "architect",
      expertise: ["system-design", "api-design"],
    },
  };

  const manifest = validateManifest(data);
  assert.equal(manifest.metadata.name, "architect");
  assert.equal(manifest.kind, "Agent");
});

test("validateManifest rejects invalid apiVersion", () => {
  const invalid = {
    apiVersion: "v2.0",
    kind: "Agent",
    metadata: {
      name: "test",
      version: "1.0.0",
      description: "Test",
    },
    spec: {},
  };

  assert.throws(() => validateManifest(invalid));
});

test("validateManifest rejects invalid kind", () => {
  const invalid = {
    apiVersion: "sfai.io/v1",
    kind: "InvalidKind",
    metadata: {
      name: "test",
      version: "1.0.0",
      description: "Test",
    },
    spec: {},
  };

  assert.throws(() => validateManifest(invalid));
});

test("validateManifest enforces semver version format", () => {
  const invalid = {
    apiVersion: "sfai.io/v1",
    kind: "Agent",
    metadata: {
      name: "test",
      version: "1.0",
      description: "Test",
    },
    spec: {},
  };

  assert.throws(() => validateManifest(invalid));
});

test("validateManifest accepts optional fields", () => {
  const data = {
    apiVersion: "sfai.io/v1",
    kind: "Skill",
    metadata: {
      name: "my-skill",
      version: "0.1.0",
      description: "A test skill",
    },
    spec: {},
  };

  const manifest = validateManifest(data);
  assert.equal(manifest.metadata.vendor, "sfai"); // default value
});

test("pluginId generates correct identifier", () => {
  const manifest: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Agent",
    metadata: {
      name: "architect",
      version: "2.1.0",
      vendor: "acme",
      description: "Test",
    },
    spec: {},
  };

  assert.equal(pluginId(manifest), "acme/architect@2.1.0");
});

test("pluginRef generates unversioned reference", () => {
  const manifest: PluginManifest = {
    apiVersion: "sfai.io/v1",
    kind: "Persona",
    metadata: {
      name: "detective",
      version: "1.5.3",
      vendor: "sfai",
      description: "Test",
    },
    spec: {},
  };

  assert.equal(pluginRef(manifest), "sfai/detective");
});

test("parsePluginRef parses vendor/name format", () => {
  const parsed = parsePluginRef("acme/my-plugin");
  assert.equal(parsed.vendor, "acme");
  assert.equal(parsed.name, "my-plugin");
  assert.equal(parsed.version, undefined);
});

test("parsePluginRef parses vendor/name@version format", () => {
  const parsed = parsePluginRef("acme/my-plugin@1.2.3");
  assert.equal(parsed.vendor, "acme");
  assert.equal(parsed.name, "my-plugin");
  assert.equal(parsed.version, "1.2.3");
});

test("parsePluginRef rejects invalid format", () => {
  assert.throws(() => parsePluginRef("invalid"));
  assert.throws(() => parsePluginRef("/name"));
});
