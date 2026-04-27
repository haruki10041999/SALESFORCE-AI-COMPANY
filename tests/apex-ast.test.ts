import test from "node:test";
import assert from "node:assert/strict";

import { analyzeApexSource as analyzeApex } from "../mcp/core/parsers/apex-ast.js";

test("apex-ast: parses simple class with method and field", () => {
  const src = `
    public with sharing class AccountService {
      public Integer count;
      public AccountService() {}
      public Integer findActive(String name) {
        return 1;
      }
    }
  `;
  const r = analyzeApex(src);
  assert.equal(r.errors.length, 0);
  assert.equal(r.units.length, 1);
  const unit = r.units[0]!;
  assert.equal(unit.kind, "class");
  assert.equal(unit.name, "AccountService");
  assert.ok(unit.modifiers.includes("public"));
  assert.equal(unit.fields.find((f) => f.name === "count")?.type, "Integer");
  assert.ok(unit.methods.find((m) => m.name === "findActive"));
  assert.ok(unit.methods.find((m) => m.returnType === "<constructor>"));
});

test("apex-ast: parses annotations on class and methods", () => {
  const src = `
    @SuppressWarnings('PMD')
    public class MyController {
      @AuraEnabled(cacheable=true)
      public static String hello() { return 'hi'; }

      @InvocableMethod(label='Run')
      public static void run(List<Id> ids) {}
    }
  `;
  const r = analyzeApex(src);
  assert.equal(r.errors.length, 0);
  const unit = r.units[0]!;
  assert.ok(unit.annotations.some((a) => a.includes("SuppressWarnings")));
  const hello = unit.methods.find((m) => m.name === "hello")!;
  assert.ok(hello.annotations.some((a) => a.includes("AuraEnabled")));
  const run = unit.methods.find((m) => m.name === "run")!;
  assert.ok(run.annotations.some((a) => a.includes("InvocableMethod")));
});

test("apex-ast: parses interface with methods", () => {
  const src = `
    public interface Searchable {
      List<SObject> find(String query);
      Integer countAll();
    }
  `;
  const r = analyzeApex(src);
  assert.equal(r.errors.length, 0);
  const unit = r.units[0]!;
  assert.equal(unit.kind, "interface");
  assert.equal(unit.name, "Searchable");
  assert.equal(unit.methods.length, 2);
});

test("apex-ast: parses trigger with events and target object", () => {
  const src = `
    trigger AccountTrigger on Account (before insert, after update) {
      if (Trigger.isInsert) { insert new Contact(); }
    }
  `;
  const r = analyzeApex(src);
  assert.equal(r.errors.length, 0);
  const unit = r.units[0]!;
  assert.equal(unit.kind, "trigger");
  assert.equal(unit.name, "AccountTrigger");
  assert.equal(unit.triggerObject, "Account");
  assert.ok(unit.triggerEvents && unit.triggerEvents.length === 2);
  assert.equal(r.dmlCount, 1);
});

test("apex-ast: parses inheritance (extends + implements)", () => {
  const src = `
    public class Child extends Base implements Searchable, Cacheable {
    }
  `;
  const r = analyzeApex(src);
  assert.equal(r.errors.length, 0);
  const unit = r.units[0]!;
  assert.equal(unit.superType, "Base");
  assert.deepEqual(unit.implementsTypes, ["Searchable", "Cacheable"]);
});

test("apex-ast: handles inner classes", () => {
  const src = `
    public class Outer {
      public class Inner1 {}
      public interface InnerIface {}
      public enum InnerEnum { A, B }
    }
  `;
  const r = analyzeApex(src);
  const unit = r.units[0]!;
  assert.equal(unit.innerTypes.length, 3);
  const kinds = unit.innerTypes.map((t) => t.kind).sort();
  assert.deepEqual(kinds, ["class", "enum", "interface"]);
});

test("apex-ast: collects parse errors gracefully", () => {
  const src = "public class Broken { void foo( ";
  const r = analyzeApex(src);
  assert.ok(r.errors.length > 0);
});

test("apex-ast: counts SOQL and DML", () => {
  const src = `
    public class Mixed {
      public void doStuff() {
        List<Account> a = [SELECT Id FROM Account];
        List<Contact> c = [SELECT Id FROM Contact];
        insert new Account();
        update existingRec;
        delete oldRec;
      }
    }
  `;
  const r = analyzeApex(src);
  // SOQL/DML counts come from regex pre-pass (independent of AST errors)
  assert.equal(r.soqlCount, 2);
  assert.equal(r.dmlCount, 3);
});

test("apex-ast: ignores keywords inside string literals and comments", () => {
  const src = `
    public class StringHolder {
      public String s = 'insert here, [SELECT not real]';
      // insert this comment
      /* delete also ignored */
      public void clean() {}
    }
  `;
  const r = analyzeApex(src);
  assert.equal(r.soqlCount, 0);
  assert.equal(r.dmlCount, 0);
});

test("apex-ast: parses property declarations", () => {
  const src = `
    public class Bean {
      public String name { get; set; }
      public Integer age { get; private set; }
    }
  `;
  const r = analyzeApex(src);
  const unit = r.units[0]!;
  assert.equal(unit.properties.length, 2);
  assert.equal(unit.properties[0]!.name, "name");
  assert.equal(unit.properties[0]!.type, "String");
});
