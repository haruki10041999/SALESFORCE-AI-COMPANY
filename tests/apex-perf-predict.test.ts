import { test } from "node:test";
import { strict as assert } from "node:assert";
import { predictApexPerformance } from "../mcp/tools/apex-perf-predict.js";

test("A10: detects SOQL inside a for loop as high risk", () => {
  const source = `
public class Foo {
  public void run(List<Id> ids) {
    for (Id id : ids) {
      Account a = [SELECT Id FROM Account WHERE Id = :id];
    }
  }
}`;
  const r = predictApexPerformance([{ filePath: "Foo.cls", source }]);
  const issue = r.findings.find((f) => f.rule === "soql-in-loop");
  assert.ok(issue, "expected soql-in-loop");
  assert.equal(issue!.risk, "high");
});

test("A10: detects DML inside a loop", () => {
  const source = `
public class Foo {
  public void run(List<Account> rows) {
    for (Account a : rows) {
      update a;
    }
  }
}`;
  const r = predictApexPerformance([{ filePath: "Foo.cls", source }]);
  assert.ok(r.findings.find((f) => f.rule === "dml-in-loop"));
});

test("A10: ignores SOQL outside a loop", () => {
  const source = `
public class Foo {
  public void run() {
    Account a = [SELECT Id FROM Account LIMIT 1];
  }
}`;
  const r = predictApexPerformance([{ filePath: "Foo.cls", source }]);
  assert.equal(r.findings.filter((f) => f.rule === "soql-in-loop").length, 0);
});

test("A10: detects deeply nested loops (depth >= 3)", () => {
  const source = `
public class Foo {
  public void run(List<List<List<Id>>> data) {
    for (List<List<Id>> a : data) {
      for (List<Id> b : a) {
        for (Id id : b) {
          // body
        }
      }
    }
  }
}`;
  const r = predictApexPerformance([{ filePath: "Foo.cls", source }]);
  assert.ok(r.findings.find((f) => f.rule === "deeply-nested-loop"));
});

test("A10: detects long methods", () => {
  const body = Array.from({ length: 110 }, () => "    Integer x = 1;").join("\n");
  const source = `
public class Foo {
  public void big() {
${body}
  }
}`;
  const r = predictApexPerformance([{ filePath: "Foo.cls", source }]);
  assert.ok(r.findings.find((f) => f.rule === "long-method"));
});

test("A10: detects .size() in for loop condition", () => {
  const source = `
public class Foo {
  public void run(List<Id> ids) {
    for (Integer i = 0; i < ids.size(); i++) {
      // body
    }
  }
}`;
  const r = predictApexPerformance([{ filePath: "Foo.cls", source }]);
  assert.ok(r.findings.find((f) => f.rule === "size-in-loop-condition"));
});

test("A10: aggregates findingsByRisk and computes riskScore", () => {
  const source = `
public class Foo {
  public void run(List<Id> ids) {
    for (Id id : ids) {
      Account a = [SELECT Id FROM Account WHERE Id = :id];
      update a;
    }
  }
}`;
  const r = predictApexPerformance([{ filePath: "Foo.cls", source }]);
  assert.ok(r.findingsByRisk.high >= 2);
  assert.ok(r.riskScore >= 10);
});
