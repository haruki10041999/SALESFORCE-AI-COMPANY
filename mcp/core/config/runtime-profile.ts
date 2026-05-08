import { parseBooleanEnv } from "./env-flags.js";

export type RuntimeProfile = "local" | "operations" | "custom";

interface ProfilePreset {
  SF_AI_STATE_BACKEND: string;
  SF_AI_PROPOSAL_QUEUE_BACKEND: string;
  SF_AI_VECTOR_BACKEND: string;
}

const PROFILE_PRESETS: Record<Exclude<RuntimeProfile, "custom">, ProfilePreset> = {
  local: {
    SF_AI_STATE_BACKEND: "sqlite",
    SF_AI_PROPOSAL_QUEUE_BACKEND: "file",
    SF_AI_VECTOR_BACKEND: "tfidf"
  },
  operations: {
    SF_AI_STATE_BACKEND: "postgres",
    SF_AI_PROPOSAL_QUEUE_BACKEND: "pg-boss",
    SF_AI_VECTOR_BACKEND: "pgvector"
  }
};

export interface AppliedRuntimeProfile {
  profile: RuntimeProfile;
  changed: string[];
  overridden: string[];
}

export function resolveRuntimeProfile(value: string | undefined): RuntimeProfile {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "operations") {
    return normalized;
  }
  return "custom";
}

export function applyRuntimeProfile(env: NodeJS.ProcessEnv = process.env): AppliedRuntimeProfile {
  const rawProfile = env.SF_AI_PROFILE ?? env.SF_AI_RUNTIME_PROFILE;
  const profile = resolveRuntimeProfile(rawProfile);
  if (profile === "custom") {
    return { profile, changed: [], overridden: [] };
  }

  const preset = PROFILE_PRESETS[profile];
  const changed: string[] = [];
  const overridden: string[] = [];
  const strict = parseBooleanEnv(env.SF_AI_PROFILE_STRICT, true);

  for (const [key, value] of Object.entries(preset)) {
    const before = env[key];
    if (before !== undefined && before !== value) {
      overridden.push(key);
      if (!strict) {
        continue;
      }
    }
    if (before !== value) {
      env[key] = value;
      changed.push(key);
    }
  }

  return { profile, changed, overridden };
}
