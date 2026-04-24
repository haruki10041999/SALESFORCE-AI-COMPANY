import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApexDependencyGraph } from "../mcp/tools/apex-dependency-graph.js";

test("buildApexDependencyGraph extracts dependencies and mermaid", () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-apex-graph-"));
  try {
    const classesDir = join(root, "classes");
    const triggersDir = join(root, "triggers");
    mkdirSync(classesDir, { recursive: true });
    mkdirSync(triggersDir, { recursive: true });

    writeFileSync(
      join(classesDir, "OrderService.cls"),
      `public with sharing class OrderService {
  public void run() {
    BillingService b = new BillingService();
    DomainFacade.call();
    b.execute();
  }
}`,
      "utf-8"
    );

    writeFileSync(
      join(classesDir, "BillingService.cls"),
      `public with sharing class BillingService {
  public void execute() {
    DomainFacade.call();
  }
}`,
      "utf-8"
    );

    writeFileSync(
      join(classesDir, "DomainFacade.cls"),
      `public with sharing class DomainFacade {
  public static void call() {
  }
}`,
      "utf-8"
    );

    writeFileSync(
      join(classesDir, "OrderServiceTest.cls"),
      `@IsTest
private class OrderServiceTest {
  @IsTest static void testRun() {
    OrderService s = new OrderService();
    s.run();
  }
}`,
      "utf-8"
    );

    writeFileSync(
      join(triggersDir, "OrderTrigger.trigger"),
      `trigger OrderTrigger on Order__c (before insert) {
  new OrderService().run();
}`,
      "utf-8"
    );

    const result = buildApexDependencyGraph({
      rootDir: root,
      includeTests: false,
      sampleLimit: 10
    });

    assert.equal(result.summary.classCount, 3);
    assert.equal(result.summary.triggerCount, 1);
    assert.ok(result.summary.edgeCount >= 3);
    assert.ok(result.edges.some((edge) => edge.from === "OrderService" && edge.to === "BillingService"));
    assert.ok(result.edges.some((edge) => edge.from === "OrderService" && edge.to === "DomainFacade"));
    assert.ok(result.edges.some((edge) => edge.from === "OrderTrigger" && edge.to === "OrderService"));
    assert.ok(result.mermaid.includes("graph LR"));
    assert.ok(result.topFanIn.some((item) => item.startsWith("DomainFacade:")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("buildApexDependencyGraph detects cycles", () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-apex-cycle-"));
  try {
    const classesDir = join(root, "classes");
    mkdirSync(classesDir, { recursive: true });

    writeFileSync(
      join(classesDir, "A.cls"),
      `public class A {
  public void run() {
    new B().run();
  }
}`,
      "utf-8"
    );

    writeFileSync(
      join(classesDir, "B.cls"),
      `public class B {
  public void run() {
    new A().run();
  }
}`,
      "utf-8"
    );

    const result = buildApexDependencyGraph({
      rootDir: root,
      includeTests: true
    });

    assert.ok(result.summary.cycleCount >= 1);
    assert.ok(result.cycles.some((group) => group.includes("A") && group.includes("B")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
