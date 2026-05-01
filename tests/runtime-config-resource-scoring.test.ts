import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getResourceScoringOverrideByAgent
} from "../mcp/core/config/runtime-config.js";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

test("resource scoring override defaults to empty when env is unset", () => {
  const originalAi = process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;
  const originalSf = process.env.SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;

  try {
    delete process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;
    delete process.env.SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;

    assert.deepEqual(getResourceScoringOverrideByAgent(), {});
  } finally {
    restoreEnv("AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT", originalAi);
    restoreEnv("SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT", originalSf);
  }
});

test("resource scoring override parses AI_* JSON payload", () => {
  const original = process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;

  try {
    process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT = JSON.stringify({
      "security-engineer": {
        tools: {
          bugPenaltyWeight: 8,
          embeddingMode: "off"
        }
      }
    });

    assert.deepEqual(getResourceScoringOverrideByAgent(), {
      "security-engineer": {
        tools: {
          bugPenaltyWeight: 8,
          embeddingMode: "off"
        }
      }
    });
  } finally {
    restoreEnv("AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT", original);
  }
});

test("resource scoring override falls back to SF_AI_* when AI_* is missing", () => {
  const originalAi = process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;
  const originalSf = process.env.SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;

  try {
    delete process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;
    process.env.SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT = JSON.stringify({
      architect: {
        skills: {
          exactNameMatchWeight: 44
        }
      }
    });

    const result = getResourceScoringOverrideByAgent();
    assert.equal(result.architect?.skills?.exactNameMatchWeight, 44);
  } finally {
    restoreEnv("AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT", originalAi);
    restoreEnv("SF_AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT", originalSf);
  }
});

test("resource scoring override returns empty object on invalid JSON", () => {
  const original = process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;

  try {
    process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT = "{ invalid-json";
    assert.deepEqual(getResourceScoringOverrideByAgent(), {});
  } finally {
    restoreEnv("AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT", original);
  }
});

test("resource scoring override sanitizes unsupported keys", () => {
  const original = process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT;

  try {
    process.env.AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT = JSON.stringify({
      "security-engineer": {
        tools: {
          bugPenaltyWeight: 8,
          unsupportedKey: 999
        },
        invalidType: {
          bugPenaltyWeight: 10
        }
      }
    });

    assert.deepEqual(getResourceScoringOverrideByAgent(), {
      "security-engineer": {
        tools: {
          bugPenaltyWeight: 8
        }
      }
    });
  } finally {
    restoreEnv("AI_RESOURCE_SCORING_WEIGHTS_BY_AGENT", original);
  }
});
