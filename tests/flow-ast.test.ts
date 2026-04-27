import test from "node:test";
import assert from "node:assert/strict";

import { parseFlowXml, analyzeFlowAst } from "../mcp/core/parsers/flow-ast.js";

const SAMPLE_FLOW = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
  <apiVersion>62.0</apiVersion>
  <label>Account Onboarding</label>
  <status>Active</status>
  <start>
    <triggerType>RecordAfterSave</triggerType>
    <object>Account</object>
    <scheduledPaths>
      <name>Day1</name>
      <offsetNumber>1</offsetNumber>
      <offsetUnit>Days</offsetUnit>
    </scheduledPaths>
  </start>
  <decisions>
    <name>IsCustomer</name>
    <label>Is Customer</label>
    <defaultConnector>
      <targetReference>End</targetReference>
    </defaultConnector>
    <rules>
      <name>YesRule</name>
      <conditionLogic>and</conditionLogic>
      <conditions>
        <leftValueReference>$Record.Type</leftValueReference>
        <operator>EqualTo</operator>
        <rightValue>
          <stringValue>Customer</stringValue>
        </rightValue>
      </conditions>
      <connector>
        <targetReference>CreateOpp</targetReference>
      </connector>
    </rules>
  </decisions>
  <recordCreates>
    <name>CreateOpp</name>
    <object>Opportunity</object>
  </recordCreates>
  <recordUpdates>
    <name>UpdateAcc</name>
    <object>Account</object>
  </recordUpdates>
  <actionCalls>
    <name>CallApex</name>
    <actionName>MyApexAction</actionName>
    <actionType>apex</actionType>
    <apexClass>MyController</apexClass>
  </actionCalls>
  <subflows>
    <name>Sub1</name>
    <flowName>OtherFlow</flowName>
  </subflows>
  <formulas>
    <name>FullName</name>
    <expression>FirstName + ' ' + LastName</expression>
    <dataType>String</dataType>
  </formulas>
</Flow>`;

test("flow-ast: parses well-formed Flow with all node types", () => {
  const { document, isWellFormed, parseErrors } = parseFlowXml(SAMPLE_FLOW);
  assert.equal(isWellFormed, true);
  assert.deepEqual(parseErrors, []);
  assert.equal(document.apiVersion, "62.0");
  assert.equal(document.label, "Account Onboarding");
  assert.equal(document.triggerType, "RecordAfterSave");
  assert.equal(document.startObject, "Account");
  assert.equal(document.scheduledPathCount, 1);
});

test("flow-ast: extracts decisions with rules and conditions", () => {
  const { document } = parseFlowXml(SAMPLE_FLOW);
  assert.equal(document.decisions.length, 1);
  const dec = document.decisions[0]!;
  assert.equal(dec.name, "IsCustomer");
  assert.equal(dec.defaultConnector, "End");
  assert.equal(dec.rules.length, 1);
  const rule = dec.rules[0]!;
  assert.equal(rule.connector, "CreateOpp");
  assert.equal(rule.conditionLogic, "and");
  assert.equal(rule.conditions[0]?.leftValueReference, "$Record.Type");
  assert.equal(rule.conditions[0]?.operator, "EqualTo");
  assert.equal(rule.conditions[0]?.rightValueLiteral, "Customer");
});

test("flow-ast: classifies record ops and action calls", () => {
  const { document } = parseFlowXml(SAMPLE_FLOW);
  const ops = document.recordOps;
  assert.equal(ops.find((o) => o.op === "create")?.name, "CreateOpp");
  assert.equal(ops.find((o) => o.op === "update")?.name, "UpdateAcc");
  const action = document.actionCalls[0]!;
  assert.equal(action.name, "CallApex");
  assert.equal(action.isApex, true);
  assert.equal(action.apexClass, "MyController");
  assert.equal(document.subflows[0]?.flowName, "OtherFlow");
  assert.equal(document.formulas[0]?.expression, "FirstName + ' ' + LastName");
});

test("flow-ast: analyzeFlowAst produces counts and risk hints", () => {
  const r = analyzeFlowAst(SAMPLE_FLOW);
  assert.equal(r.counts.decisionCount, 1);
  assert.equal(r.counts.recordCreateCount, 1);
  assert.equal(r.counts.recordUpdateCount, 1);
  assert.equal(r.counts.apexActionCount, 1);
  assert.equal(r.counts.subflowCount, 1);
  assert.equal(r.counts.formulaCount, 1);
  // Apex + Scheduled path のヒント
  assert.ok(r.riskHints.some((h) => h.includes("Apexアクション")));
  assert.ok(r.riskHints.some((h) => h.includes("Scheduled path")));
});

test("flow-ast: defaultConnector missing -> orphan decision warning", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow><apiVersion>62.0</apiVersion>
  <decisions><name>D1</name><rules><name>R1</name><conditions><operator>EqualTo</operator></conditions></rules></decisions>
</Flow>`;
  const r = analyzeFlowAst(xml);
  assert.ok(r.riskHints.some((h) => h.includes("defaultConnector")));
});

test("flow-ast: invalid XML reports parseErrors", () => {
  const r = analyzeFlowAst("<Flow><decisions></Flow>");
  assert.equal(r.isWellFormed, false);
  assert.ok(r.parseErrors.length > 0);
});

test("flow-ast: handles many DML ops -> governor risk hint", () => {
  const ops = Array.from({ length: 6 }, (_, i) => `<recordCreates><name>C${i}</name><object>Account</object></recordCreates>`).join("");
  const xml = `<?xml version="1.0"?><Flow>${ops}</Flow>`;
  const r = analyzeFlowAst(xml);
  assert.equal(r.counts.recordCreateCount, 6);
  assert.ok(r.riskHints.some((h) => h.includes("ガバナ制限")));
});

test("flow-ast: handles many subflows -> tracking complexity hint", () => {
  const subs = Array.from({ length: 4 }, (_, i) => `<subflows><name>S${i}</name><flowName>F${i}</flowName></subflows>`).join("");
  const xml = `<?xml version="1.0"?><Flow>${subs}</Flow>`;
  const r = analyzeFlowAst(xml);
  assert.equal(r.counts.subflowCount, 4);
  assert.ok(r.riskHints.some((h) => h.includes("Subflow")));
});

test("flow-ast: empty Flow root yields zero counts and no errors", () => {
  const xml = '<?xml version="1.0"?><Flow></Flow>';
  const r = analyzeFlowAst(xml);
  assert.equal(r.isWellFormed, true);
  assert.equal(r.counts.decisionCount, 0);
  assert.equal(r.counts.subflowCount, 0);
  assert.deepEqual(r.riskHints, []);
});

test("flow-ast: decision with multiple rules each having multiple conditions", () => {
  const xml = `<?xml version="1.0"?><Flow><decisions>
  <name>D</name>
  <defaultConnector><targetReference>End</targetReference></defaultConnector>
  <rules>
    <name>R1</name>
    <conditions><leftValueReference>a</leftValueReference><operator>EqualTo</operator></conditions>
    <conditions><leftValueReference>b</leftValueReference><operator>NotEqualTo</operator></conditions>
  </rules>
  <rules>
    <name>R2</name>
    <conditions><leftValueReference>c</leftValueReference><operator>GreaterThan</operator></conditions>
  </rules>
</decisions></Flow>`;
  const r = analyzeFlowAst(xml);
  assert.equal(r.document.decisions[0]?.rules.length, 2);
  assert.equal(r.document.decisions[0]?.rules[0]?.conditions.length, 2);
});
