import { test } from "node:test";
import { strict as assert } from "node:assert";
import { scanBranchAndExceptionScaffold } from "../mcp/tools/test-scaffold-extractor.js";

test("A8: counts if/else if branches and proposes AllBranches test", () => {
  const apex = `
    public class FooService {
      public Integer pick(Integer n) {
        if (n > 10) { return 1; }
        else if (n > 0) { return 2; }
        else { return 3; }
      }
    }
  `;
  const r = scanBranchAndExceptionScaffold(apex, "FooService");
  assert.equal(r.className, "FooService");
  assert.ok(r.branchCount >= 2, `expected >=2 branches, got ${r.branchCount}`);
  assert.ok(r.suggestedTests.includes("testFooService_AllBranches"));
});

test("A8: detects catch blocks and proposes RecoversFromException test", () => {
  const apex = `
    public class Bar {
      public void run() {
        try { Integer x = 1 / 0; }
        catch (System.MathException e) { Logger.log(e); }
      }
    }
  `;
  const r = scanBranchAndExceptionScaffold(apex, "Bar");
  assert.equal(r.catchCount, 1);
  assert.ok(r.suggestedTests.includes("testBar_RecoversFromException"));
});

test("A8: extracts thrown exception types and emits per-type test names", () => {
  const apex = `
    public class Validator {
      public void check(Boolean ok) {
        if (!ok) { throw new MyException('bad'); }
        if (ok == null) { throw new System.NullPointerException(); }
      }
    }
  `;
  const r = scanBranchAndExceptionScaffold(apex, "Validator");
  assert.deepEqual(r.throwTypes, ["MyException", "System.NullPointerException"]);
  assert.ok(r.suggestedTests.includes("testValidator_ThrowsMyException"));
  assert.ok(r.suggestedTests.includes("testValidator_ThrowsSystem_NullPointerException"));
});

test("A8: ignores branch keywords inside comments and strings", () => {
  const apex = `
    public class Quiet {
      // if (x) should not count
      String msg = 'if (this) is a string';
      public void noop() {}
    }
  `;
  const r = scanBranchAndExceptionScaffold(apex, "Quiet");
  assert.equal(r.branchCount, 0);
  assert.equal(r.catchCount, 0);
  assert.deepEqual(r.suggestedTests, []);
});

test("A8: includes NegativeBranch suggestion when 3+ branches exist", () => {
  const apex = `
    public class Many {
      public void go(Integer n) {
        if (n == 1) {} else if (n == 2) {} else if (n == 3) {} else {}
      }
    }
  `;
  const r = scanBranchAndExceptionScaffold(apex, "Many");
  assert.ok(r.branchCount >= 3);
  assert.ok(r.suggestedTests.includes("testMany_NegativeBranch"));
});
