# Plugin Development Guide

## Overview

The Salesforce AI plugin system provides a unified way to develop, package, and distribute agents, skills, personas, and tool packs. All plugins follow the **sfai.io/v1** manifest specification for consistent version management, dependency resolution, and dynamic loading.

## Plugin Types

### Agent
Specialized autonomous roles with domain expertise and decision-making capability.

```yaml
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
    - api-design
    - performance-optimization
  capabilities:
    - read:memory
    - execute:tool
```

### Skill
Reusable capabilities for analysis, generation, or orchestration.

```yaml
apiVersion: sfai.io/v1
kind: Skill
metadata:
  name: apex-analyzer
  version: 1.2.0
  vendor: sfai
  description: Analyzes Apex code for issues
spec:
  skillCategory: analysis
  parameters:
    - name: code
      type: string
      required: true
      description: Apex code to analyze
  capabilities:
    - execute:tool
```

### Persona
Communication patterns and behavioral traits for AI interactions.

```yaml
apiVersion: sfai.io/v1
kind: Persona
metadata:
  name: detective
  version: 1.0.0
  vendor: sfai
  description: Investigative problem solver
spec:
  archetype: investigator
  traits:
    - methodical
    - curious
    - detail-oriented
```

### ToolPack
Bundled collection of related tools and handlers (for future use).

## Creating a Plugin

### 1. Create the Manifest

Create a markdown file with YAML frontmatter in your category:

```markdown
---
apiVersion: sfai.io/v1
kind: Agent
metadata:
  name: my-agent
  version: 1.0.0
  vendor: yourcompany
  description: Brief description
spec:
  role: your-role
  expertise:
    - expertise1
    - expertise2
  dependencies:
    - name: base-skill
      vendor: sfai
      version: "^1.0.0"
  capabilities:
    - read:memory
    - execute:tool
---

# My Agent

Detailed documentation...
```

### 2. Plugin Naming Conventions

- **name**: lowercase, hyphen-separated, alphanumeric
- **vendor**: lowercase, reverse domain notation recommended (e.g., `com.company`)
- **version**: semantic versioning (MAJOR.MINOR.PATCH)

Examples:
- `sfai/architect@1.0.0`
- `acme/custom-analyzer@2.1.0`

### 3. Dependency Management

Specify dependencies in `spec.dependencies`:

```yaml
spec:
  dependencies:
    - name: foundation-skill
      vendor: sfai
      version: "^1.0.0"
      optional: false
    - name: optional-feature
      vendor: third-party
      version: "~2.1"
      optional: true
```

Version ranges:
- `1.0.0` - exact version
- `^1.0.0` - compatible with 1.x.x
- `~1.2.0` - compatible with 1.2.x

### 4. Capabilities Declaration

Declare what your plugin requires/provides:

```yaml
spec:
  capabilities:
    - read:memory
    - write:memory
    - execute:tool
    - listen:events
    - write:audit
```

## Bootstrap & Loading

### Automatic Discovery

Plugins are automatically discovered from standard directories:

```
agents/
  ├── architect.md
  ├── developer.md
  └── qa-engineer.md
skills/
  ├── analysis/
  │   └── apex-analyzer.md
  └── generation/
      └── prompt-writer.md
personas/
  ├── detective.md
  └── mentor.md
```

### Manual Plugin Loading

```typescript
import { getGlobalRegistry } from "mcp/core/registry/plugin-registry.js";
import { loadPluginManifests } from "mcp/core/registry/plugin-loader.js";

const registry = getGlobalRegistry();
await loadPluginManifests(registry, process.cwd());

// List all agents
const agents = registry.getByKind("Agent");
```

### Version Resolution

The registry automatically tracks the latest version of each plugin:

```typescript
// Get latest version
const agent = registry.get("sfai", "architect");

// Get specific version
const agent = registry.getVersion("sfai", "architect", "1.0.0");
```

## CLI Commands

### List Plugins

```bash
npm run ai -- plugin list
npm run ai -- plugin list --kind Agent
npm run ai -- plugin list --vendor sfai
```

### Verify Plugin Integrity

```bash
npm run ai -- plugin verify --name my-agent
npm run ai -- plugin verify --check-deps  # Check all dependencies
```

### Scaffold New Plugin

```bash
npm run ai -- plugin scaffold --kind Agent --name my-agent --vendor company
```

## Compatibility Mode

Legacy plugins without v1 manifest format are automatically converted to v1 with `compatibilityMode: true`:

```typescript
// Old-style markdown frontmatter
---
name: Legacy Agent
description: Old style
role: developer
expertise:
  - coding
---

// Automatically converted to:
// {
//   apiVersion: "sfai.io/v1",
//   kind: "Agent",
//   metadata: { name: "legacy-agent", version: "1.0.0", ... },
//   spec: { role: "developer", compatibilityMode: true, ... }
// }
```

## Publishing Plugins

Plugins can be published to:

1. **Internal Repository** (default): `vendors/` directory in main repo
2. **Package Registry** (future): npm/yarn package with manifest
3. **Custom Registry** (future): Plugin marketplace API

## Best Practices

1. **Version Early**: Start at 1.0.0, follow semantic versioning
2. **Document Clearly**: Add comprehensive description and examples in markdown
3. **Declare Dependencies**: Be explicit about required/optional dependencies
4. **Test Manifest**: Use `plugin verify` before committing
5. **Lock Versions**: Pin exact versions in production dependencies
6. **Monitor Usage**: Track plugin load times and failures in observability dashboards

## Troubleshooting

### Plugin Not Found

```bash
# Check if manifest is in correct directory
ls agents/*.md

# Verify manifest syntax
npm run ai -- plugin verify --name <plugin-name>
```

### Dependency Conflict

```bash
# Check dependency graph
npm run ai -- plugin list --check-deps

# View specific plugin dependencies
npm run ai -- plugin inspect <plugin-name>
```

### Legacy Compatibility Issues

If a plugin works in compatibility mode but not in v1 mode:
1. Check the v1 manifest conversion in logs
2. Ensure all required fields are present in metadata
3. Verify spec fields match expected types
