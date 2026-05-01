const fs = require("fs");
const path = require("path");

const dir = path.resolve("agents");
const meta = {
  "apex-developer": { capability: "apex-implementation", triggerKeywords: ["apex", "trigger", "class", "soql", "governor"], suggestedSkills: ["apex", "unit-test", "performance"], defaultPersona: "engineer" },
  "architect": { capability: "solution-architecture", triggerKeywords: ["architecture", "design", "integration", "scalability"], suggestedSkills: ["architecture", "security", "integration"], defaultPersona: "strategist" },
  "ceo": { capability: "business-prioritization", triggerKeywords: ["business", "strategy", "roadmap", "roi"], suggestedSkills: ["planning", "prioritization", "release"], defaultPersona: "commander" },
  "data-modeler": { capability: "data-model-design", triggerKeywords: ["data model", "object", "field", "relationship"], suggestedSkills: ["data-model", "optimization", "integration"], defaultPersona: "engineer" },
  "debug-specialist": { capability: "incident-debugging", triggerKeywords: ["debug", "error", "stacktrace", "incident"], suggestedSkills: ["debugging", "logs", "root-cause-analysis"], defaultPersona: "detective" },
  "devops-engineer": { capability: "ci-cd-and-release-automation", triggerKeywords: ["ci", "cd", "pipeline", "deploy", "github actions"], suggestedSkills: ["devops", "deployment", "release"], defaultPersona: "speed-demon" },
  "documentation-writer": { capability: "technical-documentation", triggerKeywords: ["documentation", "readme", "guide", "changelog"], suggestedSkills: ["documentation", "developer-guide", "operations"], defaultPersona: "historian" },
  "flow-specialist": { capability: "salesforce-flow-automation", triggerKeywords: ["flow", "process builder", "approval", "automation"], suggestedSkills: ["flow", "declarative", "testing"], defaultPersona: "gardener" },
  "integration-developer": { capability: "system-integration", triggerKeywords: ["integration", "api", "callout", "platform event"], suggestedSkills: ["integration", "security", "performance"], defaultPersona: "engineer" },
  "lwc-developer": { capability: "lwc-frontend-development", triggerKeywords: ["lwc", "lightning web components", "ui", "frontend"], suggestedSkills: ["lwc", "ux", "testing"], defaultPersona: "inventor" },
  "performance-engineer": { capability: "performance-optimization", triggerKeywords: ["performance", "latency", "governor", "optimize"], suggestedSkills: ["performance", "profiling", "apex"], defaultPersona: "speed-demon" },
  "product-manager": { capability: "product-scope-and-priority", triggerKeywords: ["product", "requirements", "scope", "priority"], suggestedSkills: ["planning", "roadmap", "release"], defaultPersona: "strategist" },
  "qa-engineer": { capability: "quality-assurance", triggerKeywords: ["qa", "test", "coverage", "regression"], suggestedSkills: ["testing", "quality", "apex"], defaultPersona: "detective" },
  "refactor-specialist": { capability: "refactoring-and-maintainability", triggerKeywords: ["refactor", "cleanup", "maintainability", "code smell"], suggestedSkills: ["refactor", "architecture", "testing"], defaultPersona: "doctor" },
  "release-manager": { capability: "release-readiness-and-governance", triggerKeywords: ["release", "rollout", "go-no-go", "deploy"], suggestedSkills: ["release", "deployment", "governance"], defaultPersona: "commander" },
  "repository-analyst": { capability: "repository-analysis", triggerKeywords: ["repository", "codebase", "structure", "analysis"], suggestedSkills: ["analysis", "architecture", "documentation"], defaultPersona: "detective" },
  "security-engineer": { capability: "security-review-and-hardening", triggerKeywords: ["security", "permission", "auth", "vulnerability"], suggestedSkills: ["security", "compliance", "permission-set"], defaultPersona: "samurai" }
};

for (const [name, m] of Object.entries(meta)) {
  const filePath = path.join(dir, `${name}.md`);
  const src = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF?(?:---\r?\n[\s\S]*?\r?\n---\r?\n?)*/u, "");
  const fm = [
    "---",
    `name: ${name}`,
    `capability: ${m.capability}`,
    `triggerKeywords: [${m.triggerKeywords.join(", ")}]`,
    `suggestedSkills: [${m.suggestedSkills.join(", ")}]`,
    `defaultPersona: ${m.defaultPersona}`,
    "---",
    ""
  ].join("\n");
  fs.writeFileSync(filePath, fm + src, "utf8");
}

console.log(`normalized ${Object.keys(meta).length}`);
