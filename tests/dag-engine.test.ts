import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDagExecutionLayers,
  validateDag,
  type DagNode
} from "../mcp/core/orchestration/dag-engine.js";

test("buildDagExecutionLayers splits independent nodes into parallel layers", () => {
  const nodes: DagNode[] = [
    { id: "A" },
    { id: "B", dependsOn: ["A"] },
    { id: "C", dependsOn: ["A"] },
    { id: "D", dependsOn: ["B", "C"] },
    { id: "E" }
  ];

  const layers = buildDagExecutionLayers(nodes);

  assert.deepEqual(layers, [["A", "E"], ["B", "C"], ["D"]]);
});

test("validateDag reports missing dependency and duplicate ids", () => {
  const result = validateDag([
    { id: "A", dependsOn: ["X"] },
    { id: "A" }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("duplicate node id: A")), true);
  assert.equal(result.errors.some((error) => error.includes("missing dependency: A -> X")), true);
});

test("validateDag detects cycle", () => {
  const result = validateDag([
    { id: "A", dependsOn: ["B"] },
    { id: "B", dependsOn: ["A"] }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.includes("cycle detected")), true);
});
