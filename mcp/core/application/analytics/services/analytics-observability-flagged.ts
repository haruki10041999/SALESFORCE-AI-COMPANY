import type { GovernanceState } from "../../../governance/governance-state.js";
import type { ObservabilityGovernanceFlagged } from "../../../observability/dashboard.js";

export function buildGovernanceFlaggedResources(state: GovernanceState): ObservabilityGovernanceFlagged[] {
  const flagged: ObservabilityGovernanceFlagged[] = [];
  const types: Array<"skills" | "tools" | "presets"> = ["skills", "tools", "presets"];

  for (const t of types) {
    for (const name of state.disabled?.[t] ?? []) {
      flagged.push({ resourceType: t, name, reason: "disabled" });
    }
    const bugThreshold = state.config?.thresholds?.bugSignalToFlag ?? 5;
    const bugMap = state.bugSignals?.[t] ?? {};
    for (const [name, count] of Object.entries(bugMap)) {
      if (typeof count === "number" && count >= bugThreshold) {
        flagged.push({ resourceType: t, name, reason: `bugSignals=${count}` });
      }
    }
  }

  return flagged;
}
