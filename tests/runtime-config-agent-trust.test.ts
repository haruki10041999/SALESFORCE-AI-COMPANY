import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getAgentTrustScoringEnabled,
  getAgentTrustThreshold
} from "../mcp/core/config/runtime-config.js";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

test("agent trust config defaults when env is unset", () => {
  const originalAiEnabled = process.env.AI_AGENT_TRUST_SCORING_ENABLED;
  const originalSfEnabled = process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED;
  const originalAiThreshold = process.env.AI_AGENT_TRUST_THRESHOLD;
  const originalSfThreshold = process.env.SF_AI_AGENT_TRUST_THRESHOLD;

  try {
    delete process.env.AI_AGENT_TRUST_SCORING_ENABLED;
    delete process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED;
    delete process.env.AI_AGENT_TRUST_THRESHOLD;
    delete process.env.SF_AI_AGENT_TRUST_THRESHOLD;

    assert.equal(getAgentTrustScoringEnabled(), false);
    assert.equal(getAgentTrustThreshold(), 0.55);
  } finally {
    restoreEnv("AI_AGENT_TRUST_SCORING_ENABLED", originalAiEnabled);
    restoreEnv("SF_AI_AGENT_TRUST_SCORING_ENABLED", originalSfEnabled);
    restoreEnv("AI_AGENT_TRUST_THRESHOLD", originalAiThreshold);
    restoreEnv("SF_AI_AGENT_TRUST_THRESHOLD", originalSfThreshold);
  }
});

test("agent trust config accepts AI_* env vars", () => {
  const originalEnabled = process.env.AI_AGENT_TRUST_SCORING_ENABLED;
  const originalThreshold = process.env.AI_AGENT_TRUST_THRESHOLD;

  try {
    process.env.AI_AGENT_TRUST_SCORING_ENABLED = "true";
    process.env.AI_AGENT_TRUST_THRESHOLD = "0.72";

    assert.equal(getAgentTrustScoringEnabled(), true);
    assert.equal(getAgentTrustThreshold(), 0.72);
  } finally {
    restoreEnv("AI_AGENT_TRUST_SCORING_ENABLED", originalEnabled);
    restoreEnv("AI_AGENT_TRUST_THRESHOLD", originalThreshold);
  }
});

test("agent trust config falls back to SF_AI_* env vars", () => {
  const originalAiEnabled = process.env.AI_AGENT_TRUST_SCORING_ENABLED;
  const originalSfEnabled = process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED;
  const originalAiThreshold = process.env.AI_AGENT_TRUST_THRESHOLD;
  const originalSfThreshold = process.env.SF_AI_AGENT_TRUST_THRESHOLD;

  try {
    delete process.env.AI_AGENT_TRUST_SCORING_ENABLED;
    delete process.env.AI_AGENT_TRUST_THRESHOLD;
    process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED = "yes";
    process.env.SF_AI_AGENT_TRUST_THRESHOLD = "0.61";

    assert.equal(getAgentTrustScoringEnabled(), true);
    assert.equal(getAgentTrustThreshold(), 0.61);
  } finally {
    restoreEnv("AI_AGENT_TRUST_SCORING_ENABLED", originalAiEnabled);
    restoreEnv("SF_AI_AGENT_TRUST_SCORING_ENABLED", originalSfEnabled);
    restoreEnv("AI_AGENT_TRUST_THRESHOLD", originalAiThreshold);
    restoreEnv("SF_AI_AGENT_TRUST_THRESHOLD", originalSfThreshold);
  }
});

test("agent trust config prefers AI_* over SF_AI_* when both are set", () => {
  const originalAiEnabled = process.env.AI_AGENT_TRUST_SCORING_ENABLED;
  const originalSfEnabled = process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED;
  const originalAiThreshold = process.env.AI_AGENT_TRUST_THRESHOLD;
  const originalSfThreshold = process.env.SF_AI_AGENT_TRUST_THRESHOLD;

  try {
    process.env.AI_AGENT_TRUST_SCORING_ENABLED = "false";
    process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED = "true";
    process.env.AI_AGENT_TRUST_THRESHOLD = "0.49";
    process.env.SF_AI_AGENT_TRUST_THRESHOLD = "0.9";

    assert.equal(getAgentTrustScoringEnabled(), false);
    assert.equal(getAgentTrustThreshold(), 0.49);
  } finally {
    restoreEnv("AI_AGENT_TRUST_SCORING_ENABLED", originalAiEnabled);
    restoreEnv("SF_AI_AGENT_TRUST_SCORING_ENABLED", originalSfEnabled);
    restoreEnv("AI_AGENT_TRUST_THRESHOLD", originalAiThreshold);
    restoreEnv("SF_AI_AGENT_TRUST_THRESHOLD", originalSfThreshold);
  }
});

test("agent trust config ignores invalid boolean and uses fallback", () => {
  const originalAiEnabled = process.env.AI_AGENT_TRUST_SCORING_ENABLED;
  const originalSfEnabled = process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED;

  try {
    process.env.AI_AGENT_TRUST_SCORING_ENABLED = "not-a-bool";
    process.env.SF_AI_AGENT_TRUST_SCORING_ENABLED = "true";

    // AI_* has priority, invalid value should fall back to default(false)
    assert.equal(getAgentTrustScoringEnabled(), false);
  } finally {
    restoreEnv("AI_AGENT_TRUST_SCORING_ENABLED", originalAiEnabled);
    restoreEnv("SF_AI_AGENT_TRUST_SCORING_ENABLED", originalSfEnabled);
  }
});

test("agent trust config ignores out-of-range threshold and uses fallback", () => {
  const originalAiThreshold = process.env.AI_AGENT_TRUST_THRESHOLD;
  const originalSfThreshold = process.env.SF_AI_AGENT_TRUST_THRESHOLD;

  try {
    process.env.AI_AGENT_TRUST_THRESHOLD = "2.0";
    process.env.SF_AI_AGENT_TRUST_THRESHOLD = "0.2";

    // AI_* has priority, out-of-range value should fall back to default(0.55)
    assert.equal(getAgentTrustThreshold(), 0.55);
  } finally {
    restoreEnv("AI_AGENT_TRUST_THRESHOLD", originalAiThreshold);
    restoreEnv("SF_AI_AGENT_TRUST_THRESHOLD", originalSfThreshold);
  }
});
