import { test } from "node:test";
import { strict as assert } from "node:assert";
import { AppError, formatMessage, isAppError } from "../mcp/core/errors/messages.js";
import { setLocaleOverride, getLocale } from "../mcp/core/i18n/locale.js";

test("F8: AppError exposes code and params", () => {
  setLocaleOverride("ja");
  try {
    const err = new AppError("INVALID_PATH", { path: "/etc/passwd", detail: "absolute" });
    assert.equal(err.code, "INVALID_PATH");
    assert.equal(err.params.path, "/etc/passwd");
    assert.match(err.message, /パスが不正です/);
    assert.equal(isAppError(err), true);
  } finally {
    setLocaleOverride(undefined);
  }
});

test("F8: formatMessage renders both ja and en", () => {
  const ja = formatMessage("TOOL_NOT_FOUND", { name: "smart_chat" }, "ja");
  const en = formatMessage("TOOL_NOT_FOUND", { name: "smart_chat" }, "en");
  assert.match(ja, /ツールが見つかりません/);
  assert.match(en, /Tool not found/);
  assert.notEqual(ja, en);
});

test("F8: AppError.toLocale switches language without changing code", () => {
  setLocaleOverride("ja");
  try {
    const err = new AppError("TOOL_NOT_FOUND", { name: "smart_chat" });
    assert.match(err.toLocale("en"), /Tool not found/);
    assert.match(err.toLocale("ja"), /ツールが見つかりません/);
  } finally {
    setLocaleOverride(undefined);
  }
});

test("F8: getLocale honours SF_AI_LOCALE env", () => {
  const original = process.env.SF_AI_LOCALE;
  try {
    process.env.SF_AI_LOCALE = "en";
    setLocaleOverride(undefined);
    assert.equal(getLocale(), "en");
    process.env.SF_AI_LOCALE = "fr";
    assert.equal(getLocale(), "ja", "unsupported locale should fall back to ja");
    delete process.env.SF_AI_LOCALE;
    assert.equal(getLocale(), "ja");
  } finally {
    if (original === undefined) delete process.env.SF_AI_LOCALE;
    else process.env.SF_AI_LOCALE = original;
    setLocaleOverride(undefined);
  }
});

test("F8: isAppError discriminates plain Error", () => {
  assert.equal(isAppError(new Error("x")), false);
  assert.equal(isAppError(new AppError("INTERNAL_ERROR", { detail: "x" })), true);
});
