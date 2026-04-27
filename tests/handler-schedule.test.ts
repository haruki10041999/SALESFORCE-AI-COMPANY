import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  evaluateHandlerSchedule,
  evaluateAllHandlerSchedules,
  validateHandlerScheduleRule
} from "../mcp/core/governance/handler-schedule.js";

test("A19: tool with no rule is active by default", () => {
  const r = evaluateHandlerSchedule("any_tool", []);
  assert.equal(r.active, true);
  assert.equal(r.reason, "no-rule");
});

test("A19: allow rule activates tool only inside the window", () => {
  // 2026-04-27 is Monday.  10:00 UTC inside [9, 18) UTC window.
  const inside = new Date("2026-04-27T10:00:00Z");
  const outside = new Date("2026-04-27T20:00:00Z");
  const rules = [{ toolName: "x", startHour: 9, endHour: 18 }];
  assert.equal(evaluateHandlerSchedule("x", rules, inside).active, true);
  const r = evaluateHandlerSchedule("x", rules, outside);
  assert.equal(r.active, false);
  assert.equal(r.reason, "outside-allow-window");
});

test("A19: deny rule blocks even when allow window matches", () => {
  const at = new Date("2026-04-27T10:00:00Z");
  const rules = [
    { toolName: "x", startHour: 0, endHour: 24 },
    { toolName: "x", startHour: 9, endHour: 11, allow: false }
  ];
  const r = evaluateHandlerSchedule("x", rules, at);
  assert.equal(r.active, false);
  assert.equal(r.reason, "deny-rule-matched");
});

test("A19: timezone offset shifts window correctly", () => {
  // JST = +540min.  JST 10:00 == UTC 01:00 on the same day.
  const at = new Date("2026-04-27T01:00:00Z");
  const rules = [
    { toolName: "x", startHour: 9, endHour: 18, timezoneOffsetMinutes: 540 }
  ];
  assert.equal(evaluateHandlerSchedule("x", rules, at).active, true);
  // UTC 23:00 prev day == JST 08:00 → outside JST 9-18
  const before = new Date("2026-04-26T23:00:00Z");
  assert.equal(evaluateHandlerSchedule("x", rules, before).active, false);
});

test("A19: days filter restricts active weekdays", () => {
  // 2026-04-27 = Monday (1)
  const monday = new Date("2026-04-27T10:00:00Z");
  const sunday = new Date("2026-04-26T10:00:00Z");
  const rules = [{ toolName: "x", startHour: 0, endHour: 24, days: [1, 2, 3, 4, 5] }];
  assert.equal(evaluateHandlerSchedule("x", rules, monday).active, true);
  assert.equal(evaluateHandlerSchedule("x", rules, sunday).active, false);
});

test("A19: wrap-around window covers midnight", () => {
  // [22, 2) → 23:30 active, 03:00 inactive
  const late = new Date("2026-04-27T23:30:00Z");
  const earlyMorning = new Date("2026-04-27T03:00:00Z");
  const rules = [{ toolName: "x", startHour: 22, endHour: 2 }];
  assert.equal(evaluateHandlerSchedule("x", rules, late).active, true);
  // 01:30 should also match (inside [0, 2))
  const past_midnight = new Date("2026-04-27T01:30:00Z");
  assert.equal(evaluateHandlerSchedule("x", rules, past_midnight).active, true);
  assert.equal(evaluateHandlerSchedule("x", rules, earlyMorning).active, false);
});

test("A19: evaluateAllHandlerSchedules returns per-tool result", () => {
  const at = new Date("2026-04-27T10:00:00Z");
  const rules = [
    { toolName: "a", startHour: 9, endHour: 12 },
    { toolName: "b", startHour: 13, endHour: 17 }
  ];
  const r = evaluateAllHandlerSchedules(["a", "b", "c"], rules, at);
  assert.equal(r.find((e) => e.toolName === "a")!.active, true);
  assert.equal(r.find((e) => e.toolName === "b")!.active, false);
  assert.equal(r.find((e) => e.toolName === "c")!.active, true); // no rule
});

test("A19: validateHandlerScheduleRule reports invalid hours and days", () => {
  const errs = validateHandlerScheduleRule({
    toolName: "",
    startHour: 25,
    endHour: -1,
    days: [7]
  });
  assert.ok(errs.length >= 4);
});
