import { test } from "node:test";
import assert from "node:assert/strict";

import { getRubricCriteriaOverrideByAgent } from "../mcp/core/config/runtime-config.js";

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

test("rubric criteria override defaults to empty when env is unset", () => {
  const originalAi = process.env.AI_RUBRIC_CRITERIA_BY_AGENT;
  const originalSf = process.env.SF_AI_RUBRIC_CRITERIA_BY_AGENT;

  try {
    delete process.env.AI_RUBRIC_CRITERIA_BY_AGENT;
    delete process.env.SF_AI_RUBRIC_CRITERIA_BY_AGENT;
    assert.deepEqual(getRubricCriteriaOverrideByAgent(), {});
  } finally {
    restoreEnv("AI_RUBRIC_CRITERIA_BY_AGENT", originalAi);
    restoreEnv("SF_AI_RUBRIC_CRITERIA_BY_AGENT", originalSf);
  }
});

test("rubric criteria override parses AI_* JSON payload", () => {
  const original = process.env.AI_RUBRIC_CRITERIA_BY_AGENT;

  try {
    process.env.AI_RUBRIC_CRITERIA_BY_AGENT = JSON.stringify({
      architect: {
        completeness: {
          weight: 0.4,
          label: "Coverage"
        }
      }
    });

    assert.deepEqual(getRubricCriteriaOverrideByAgent(), {
      architect: {
        completeness: {
          weight: 0.4,
          label: "Coverage"
        }
      }
    });
  } finally {
    restoreEnv("AI_RUBRIC_CRITERIA_BY_AGENT", original);
  }
});

test("rubric criteria override sanitizes invalid keys and values", () => {
  const original = process.env.AI_RUBRIC_CRITERIA_BY_AGENT;

  try {
    process.env.AI_RUBRIC_CRITERIA_BY_AGENT = JSON.stringify({
      architect: {
        completeness: {
          weight: 0.4,
          unsupported: 1
        },
        relevance: {
          weight: -1
        }
      }
    });

    assert.deepEqual(getRubricCriteriaOverrideByAgent(), {
      architect: {
        completeness: {
          weight: 0.4
        }
      }
    });
  } finally {
    restoreEnv("AI_RUBRIC_CRITERIA_BY_AGENT", original);
  }
});
