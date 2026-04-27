import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  getSpeechStyleForAgent,
  getSpeechStyleForPersona,
  renderSpeechStyleSection,
  DEFAULT_SPEECH_STYLE
} from "../mcp/core/context/speech-style-registry.js";

test("samurai persona uses archaic 拙者 / でござる", () => {
  const s = getSpeechStyleForPersona("samurai");
  assert.equal(s.firstPerson, "拙者");
  assert.ok(s.sentenceEndings.includes("でござる"));
  assert.equal(s.formality, "archaic");
});

test("speed-demon and engineer have distinguishable endings", () => {
  const speed = getSpeechStyleForPersona("speed-demon");
  const eng = getSpeechStyleForPersona("engineer");
  // 異なる formality / 語尾 が出ること
  assert.notDeepEqual(speed.sentenceEndings, eng.sentenceEndings);
  assert.notEqual(speed.formality, eng.formality);
});

test("agent fallback resolves to mapped persona (security-engineer → samurai)", () => {
  const s = getSpeechStyleForAgent("security-engineer");
  assert.equal(s.firstPerson, "拙者");
  // agent 固有 catchphrase が合成されること
  assert.ok(s.catchphrases?.some((c) => c.includes("セキュリティ")));
});

test("persona override takes precedence over agent default", () => {
  const s = getSpeechStyleForAgent("security-engineer", "diplomat");
  assert.equal(s.firstPerson, "私");
  assert.equal(s.formality, "honorific");
});

test("unknown agent falls back to default style", () => {
  const s = getSpeechStyleForAgent("nope-agent");
  assert.deepEqual(s, DEFAULT_SPEECH_STYLE);
});

test("renderSpeechStyleSection includes 一人称 and 語尾", () => {
  const md = renderSpeechStyleSection("apex-developer");
  assert.match(md, /一人称: 私/);
  assert.match(md, /文末語尾の例:/);
  assert.match(md, /敬語レベル:/);
});
