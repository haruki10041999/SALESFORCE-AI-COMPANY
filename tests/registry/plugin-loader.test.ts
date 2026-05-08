import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { promises as fsPromises } from "node:fs";
import { resolve } from "node:path";
import { PluginLoader } from "../../mcp/core/registry/plugin-loader.js";
import { PluginRegistry } from "../../mcp/core/registry/plugin-registry.js";
import type { PluginManifest } from "../../mcp/core/registry/plugin-manifest.js";

test("PluginLoader loads manifest from JSON file", async () => {
  const tmpDir = tmpdir();
  const testDir = resolve(tmpDir, `plugin-loader-${Date.now()}-json`);
  await fsPromises.mkdir(testDir, { recursive: true });

  try {
    const manifest: PluginManifest = {
      apiVersion: "sfai.io/v1",
      kind: "Agent",
      metadata: {
        name: "test-agent",
        version: "1.0.0",
        vendor: "sfai",
        description: "Test",
      },
      spec: {},
    };

    const jsonPath = resolve(testDir, "manifest.json");
    await fsPromises.writeFile(jsonPath, JSON.stringify(manifest));

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
    const loaded = await loader.loadFile(jsonPath);

    assert.equal(loaded.metadata.name, "test-agent");
    assert.equal(loaded.kind, "Agent");
  } finally {
    await fsPromises.rm(testDir, { recursive: true });
  }
});

test("PluginLoader extracts manifest from markdown frontmatter", async () => {
  const tmpDir = tmpdir();
  const testDir = resolve(tmpDir, `plugin-loader-${Date.now()}-md`);
  await fsPromises.mkdir(testDir, { recursive: true });

  try {
    const content = `---
apiVersion: sfai.io/v1
kind: Agent
metadata:
  name: architect
  version: 1.0.0
  vendor: sfai
  description: Architecture specialist
spec:
  role: architect
  expertise:
    - system-design
---

# Architect Agent

This is the architect agent.
`;

    const mdPath = resolve(testDir, "architect.md");
    await fsPromises.writeFile(mdPath, content);

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
    const loaded = await loader.loadFile(mdPath);

    assert.equal(loaded.metadata.name, "architect");
    assert.equal(loaded.spec.role, "architect");
  } finally {
    await fsPromises.rm(testDir, { recursive: true });
  }
});

test("PluginLoader converts legacy frontmatter to v1 manifest", async () => {
  const tmpDir = tmpdir();
  const testDir = resolve(tmpDir, `plugin-loader-${Date.now()}-legacy`);
  await fsPromises.mkdir(testDir, { recursive: true });

  try {
    const content = `---
name: Test Agent
description: A legacy agent
role: developer
expertise:
  - coding
  - testing
---

# Test Agent

Legacy content
`;

    const mdPath = resolve(testDir, "test-agent.md");
    await fsPromises.writeFile(mdPath, content);

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
    const loaded = await loader.loadFile(mdPath);

    assert.equal(loaded.apiVersion, "sfai.io/v1");
    assert.equal(loaded.metadata.version, "1.0.0");
    assert.equal(loaded.spec.compatibilityMode, true);
    assert.equal(loaded.spec.role, "developer");
  } finally {
    await fsPromises.rm(testDir, { recursive: true });
  }
});

test("PluginLoader loads all plugins from directory", async () => {
  const tmpDir = tmpdir();
  const testDir = resolve(tmpDir, `plugin-loader-${Date.now()}-dir`);
  const agentsDir = resolve(testDir, "agents");
  await fsPromises.mkdir(agentsDir, { recursive: true });

  try {
    // Create 2 agent manifests
    const agent1: PluginManifest = {
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

    const agent2: PluginManifest = {
      apiVersion: "sfai.io/v1",
      kind: "Agent",
      metadata: {
        name: "agent2",
        version: "1.0.0",
        vendor: "sfai",
        description: "Test",
      },
      spec: {},
    };

    await fsPromises.writeFile(resolve(agentsDir, "agent1.json"), JSON.stringify(agent1));
    await fsPromises.writeFile(resolve(agentsDir, "agent2.json"), JSON.stringify(agent2));

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
    const loaded = await loader.loadFromDirectory(agentsDir);

    assert.equal(loaded.length, 2);
    assert.ok(loaded.some((p) => p.metadata.name === "agent1"));
    assert.ok(loaded.some((p) => p.metadata.name === "agent2"));
  } finally {
    await fsPromises.rm(testDir, { recursive: true });
  }
});

test("PluginLoader filters by kind", async () => {
  const tmpDir = tmpdir();
  const testDir = resolve(tmpDir, `plugin-loader-${Date.now()}-filter`);
  const dir = resolve(testDir, "plugins");
  await fsPromises.mkdir(dir, { recursive: true });

  try {
    const agent: PluginManifest = {
      apiVersion: "sfai.io/v1",
      kind: "Agent",
      metadata: {
        name: "test-agent",
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
        name: "test-skill",
        version: "1.0.0",
        vendor: "sfai",
        description: "Test",
      },
      spec: {},
    };

    await fsPromises.writeFile(resolve(dir, "agent.json"), JSON.stringify(agent));
    await fsPromises.writeFile(resolve(dir, "skill.json"), JSON.stringify(skill));

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
    const agents = await loader.loadFromDirectory(dir, "Agent");

    assert.equal(agents.length, 1);
    assert.equal(agents[0].kind, "Agent");
  } finally {
    await fsPromises.rm(testDir, { recursive: true });
  }
});

test("PluginLoader infers kind from path", async () => {
  const tmpDir = tmpdir();
  const testDir = resolve(tmpDir, `plugin-loader-${Date.now()}-infer`);
  const agentsDir = resolve(testDir, "agents");
  const skillsDir = resolve(testDir, "skills");
  await fsPromises.mkdir(agentsDir, { recursive: true });
  await fsPromises.mkdir(skillsDir, { recursive: true });

  try {
    // Agent with legacy frontmatter
    const agentMd = `---
name: Legacy Agent
description: Test
---
Content`;

    // Skill with legacy frontmatter
    const skillMd = `---
name: Legacy Skill
description: Test
skillCategory: analysis
---
Content`;

    await fsPromises.writeFile(resolve(agentsDir, "agent.md"), agentMd);
    await fsPromises.writeFile(resolve(skillsDir, "skill.md"), skillMd);

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);

    const agent = await loader.loadFile(resolve(agentsDir, "agent.md"));
    const skill = await loader.loadFile(resolve(skillsDir, "skill.md"));

    assert.equal(agent.kind, "Agent");
    assert.equal(skill.kind, "Skill");
  } finally {
    await fsPromises.rm(testDir, { recursive: true });
  }
});

test("PluginLoader bootstrap loads agents/skills/personas", async () => {
  const tmpDir = tmpdir();
  const baseDir = resolve(tmpDir, `plugin-loader-${Date.now()}-bootstrap`);
  const agentsDir = resolve(baseDir, "agents");
  const skillsDir = resolve(baseDir, "skills");
  const personasDir = resolve(baseDir, "personas");

  await fsPromises.mkdir(agentsDir, { recursive: true });
  await fsPromises.mkdir(skillsDir, { recursive: true });
  await fsPromises.mkdir(personasDir, { recursive: true });

  try {
    const agent: PluginManifest = {
      apiVersion: "sfai.io/v1",
      kind: "Agent",
      metadata: {
        name: "test-agent",
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
        name: "test-skill",
        version: "1.0.0",
        vendor: "sfai",
        description: "Test",
      },
      spec: {},
    };

    const persona: PluginManifest = {
      apiVersion: "sfai.io/v1",
      kind: "Persona",
      metadata: {
        name: "test-persona",
        version: "1.0.0",
        vendor: "sfai",
        description: "Test",
      },
      spec: {},
    };

    await fsPromises.writeFile(resolve(agentsDir, "agent.json"), JSON.stringify(agent));
    await fsPromises.writeFile(resolve(skillsDir, "skill.json"), JSON.stringify(skill));
    await fsPromises.writeFile(resolve(personasDir, "persona.json"), JSON.stringify(persona));

    const registry = new PluginRegistry();
    const loader = new PluginLoader(registry);
    const result = await loader.bootstrap(baseDir);

    assert.equal(result.agents.length, 1);
    assert.equal(result.skills.length, 1);
    assert.equal(result.personas.length, 1);
  } finally {
    await fsPromises.rm(baseDir, { recursive: true });
  }
});
