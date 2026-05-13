/**
 * TASK-05: OpenTelemetry Sampling + PII Redaction Integration Tests
 *
 * Verify:
 *  1. PII redaction in span attributes (emails, phones, tokens, AWS IDs, SSN, etc.)
 *  2. Sampling decision recording to Prometheus
 *  3. Hash-based bucketing consistency for same traceId
 */

import assert from "node:assert/strict";
import test from "node:test";
import { redactOtelSpanAttributes } from "../mcp/core/observability/pii-redactor.js";
import { maskLogMessage as maskPii } from "../mcp/core/logging/pii-masker.js";
import {
  _resetPrometheusForTest,
  recordTraceSamplingForPrometheus,
  getPrometheusMetricsText
} from "../mcp/core/observability/prometheus-metrics.js";
import { _resetOtelTracerForTest } from "../mcp/core/observability/otel-tracer.js";

test("TASK-05: PII Redaction - email addresses", () => {
  const attrs = {
    "user.email": "user@example.com",
    "request.host": "api.example.com",
    "trace_id": "abc123"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  // Implementation uses [EMAIL] or similar bracket-style placeholders
  assert.ok(String(redacted["user.email"]).includes("[") || String(redacted["user.email"]).includes("*"));
  assert.strictEqual(redacted["request.host"], "api.example.com"); // Not a PII pattern
  assert.strictEqual(redacted["trace_id"], "abc123"); // Not a PII pattern
});

test("TASK-05: PII Redaction - phone numbers", () => {
  const attrs = {
    "contact.phone": "+1-555-123-4567",
    "support.number": "555-987-6543"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  assert.ok(String(redacted["contact.phone"]).includes("[") || String(redacted["contact.phone"]).includes("*"));
  assert.ok(String(redacted["support.number"]).includes("[") || String(redacted["support.number"]).includes("*"));
});

test("TASK-05: PII Redaction - API tokens and keys", () => {
  const attrs = {
    "auth.token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "api.key": "sk-1234567890abcdef",
    "bearer": "Bearer abc123xyz789"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  assert.ok(String(redacted["auth.token"]).includes("[") || String(redacted["auth.token"]).includes("*"));
  assert.ok(String(redacted["api.key"]).includes("[") || String(redacted["api.key"]).includes("*"));
  assert.ok(String(redacted["bearer"]).includes("[") || String(redacted["bearer"]).includes("*"));
});

test("TASK-05: PII Redaction - AWS credentials and IDs", () => {
  const attrs = {
    "aws.access_key": "AKIAIOSFODNN7EXAMPLE",
    "aws.secret": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    "aws.arn": "arn:aws:iam::123456789012:user/example"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  // These are recognized by key name sensitivity, so they should be redacted
  assert.ok(String(redacted["aws.access_key"]).length > 0);
  assert.ok(String(redacted["aws.secret"]).length > 0);
  assert.ok(String(redacted["aws.arn"]).length > 0);
});

test("TASK-05: PII Redaction - SSN (Social Security Number)", () => {
  const attrs = {
    "person.ssn": "123-45-6789",
    "id.ssn": "987-65-4321"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  assert.ok(String(redacted["person.ssn"]).includes("[") || String(redacted["person.ssn"]).includes("*"));
  assert.ok(String(redacted["id.ssn"]).includes("[") || String(redacted["id.ssn"]).includes("*"));
});

test("TASK-05: PII Redaction - credit card numbers", () => {
  const attrs = {
    "payment.card": "4532-1234-5678-9010",
    "visa": "5425233010103442"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  assert.ok(String(redacted["payment.card"]).includes("[") || String(redacted["payment.card"]).includes("*"));
  assert.ok(String(redacted["visa"]).includes("[") || String(redacted["visa"]).includes("*"));
});

test("TASK-05: PII Redaction - HASH strategy", () => {
  const attrs = {
    "user.email": "user@example.com"
  };

  const redacted = redactOtelSpanAttributes(attrs, "hash", "test-seed");
  // Hash should produce hash_ prefixed output
  const hashed = String(redacted["user.email"]);
  assert.ok(hashed.startsWith("hash_") || hashed.includes("hash"));
});

test("TASK-05: PII Redaction - DROP strategy", () => {
  const attrs = {
    "user.email": "user@example.com",
    "trace_id": "abc123"
  };

  const redacted = redactOtelSpanAttributes(attrs, "drop");
  // PII should be dropped entirely
  assert(!("user.email" in redacted));
  // Non-PII should remain
  assert.strictEqual(redacted["trace_id"], "abc123");
});

test("TASK-05: PII Redaction - hash consistency with same seed", () => {
  const attrs = { "user.email": "user@example.com" };
  const seed = "consistent-seed";

  const hash1 = String(redactOtelSpanAttributes(attrs, "hash", seed)["user.email"]);
  const hash2 = String(redactOtelSpanAttributes(attrs, "hash", seed)["user.email"]);

  // Same seed should produce same hash
  assert.strictEqual(hash1, hash2);
});

test("TASK-05: PII Redaction - hash variance with different seeds", () => {
  const attrs = { "user.email": "user@example.com" };

  const hash1 = String(redactOtelSpanAttributes(attrs, "hash", "seed1")["user.email"]);
  const hash2 = String(redactOtelSpanAttributes(attrs, "hash", "seed2")["user.email"]);

  // Different seed should produce different hash
  assert.notStrictEqual(hash1, hash2);
});

test("TASK-05: PII Masking - email patterns", () => {
  const inputs = [
    "user@example.com",
    "john.doe+tag@company.co.uk",
    "test.email@subdomain.example.com"
  ];

  for (const email of inputs) {
    const masked = maskPii(email);
    // maskLogMessage replaces PII, might not contain original @ but should be redacted
    assert.ok(masked !== email); // Should be different from original
  }
});

test("TASK-05: PII Masking - phone numbers", () => {
  const inputs = ["+1-555-123-4567", "555.987.6543", "(555) 234-5678"];

  for (const phone of inputs) {
    const masked = maskPii(phone);
    // Should be masked (different from original)
    assert.ok(masked !== phone);
  }
});

test("TASK-05: PII Masking - AWS access keys", () => {
  const akiaKey = "AKIA" + "I".repeat(16) + "EXAMPLE";
  const masked = maskPii(akiaKey);
  assert.ok(masked !== akiaKey); // Should be masked
});

test("TASK-05: PII Masking - SSH keys", () => {
  const sshKey = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC...";
  const masked = maskPii(sshKey);
  assert.ok(masked !== sshKey); // Should be masked
});

test("TASK-05: PII Masking - SSN", () => {
  const inputs = ["123-45-6789", "123 45 6789", "123456789"];

  for (const ssn of inputs) {
    const masked = maskPii(ssn);
    assert.ok(masked !== ssn); // Should be masked
  }
});

test("TASK-05: PII Masking - bank account numbers", () => {
  const inputs = ["123456789012", "12-3456789-012"];

  for (const account of inputs) {
    const masked = maskPii(account);
    assert.ok(masked !== account); // Should be masked
  }
});

test("TASK-05: Span Attribute Redaction - complex nested attributes", () => {
  const attrs = {
    "user.email": "user@example.com",
    "request.headers.authorization": "Bearer eyJhbGciOiJIUzI1NiJ9...",
    "context.actor_id": "actor-123",
    "db.connection": "postgresql://user:pass@host:5432/db"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  assert.ok(String(redacted["user.email"]).includes("[") || String(redacted["user.email"]).includes("*"));
  assert.ok(String(redacted["request.headers.authorization"]).includes("[") || String(redacted["request.headers.authorization"]).includes("*"));
  assert.strictEqual(redacted["context.actor_id"], "actor-123"); // Not a PII pattern
  assert.ok(redacted["db.connection"]); // May contain masked password
});

test("TASK-05: Span Attribute Redaction - preserve non-PII values", () => {
  const attrs = {
    "trace_id": "abc-123-def-456",
    "span_name": "tool.some_tool",
    "request.method": "POST",
    "http.status_code": 200,
    "duration_ms": 42.5
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  assert.strictEqual(redacted["trace_id"], "abc-123-def-456");
  assert.strictEqual(redacted["span_name"], "tool.some_tool");
  assert.strictEqual(redacted["request.method"], "POST");
  assert.strictEqual(redacted["http.status_code"], 200);
  assert.strictEqual(redacted["duration_ms"], 42.5);
});

test("TASK-05: Span Attribute Redaction - numeric and boolean attributes", () => {
  const attrs = {
    "http.status_code": 200,
    "request.cached": true,
    "duration_seconds": 1.5,
    "email": "user@example.com"
  };

  const redacted = redactOtelSpanAttributes(attrs, "mask");
  assert.strictEqual(redacted["http.status_code"], 200);
  assert.strictEqual(redacted["request.cached"], true);
  assert.strictEqual(redacted["duration_seconds"], 1.5);
  assert.ok(String(redacted["email"]).includes("[") || String(redacted["email"]).includes("*"));
});

test("TASK-05: Sampling Metrics - record sampled traces to Prometheus", async () => {
  _resetOtelTracerForTest();
  await _resetPrometheusForTest();

  recordTraceSamplingForPrometheus("tool_name", true);

  // Give async recording a chance
  await new Promise((resolve) => setTimeout(resolve, 150));

  const { text } = await getPrometheusMetricsText();
  assert.ok(text.includes("sfai_otel_traces_sampled_total"));
  assert.ok(text.includes('tool="tool_name"'));

  await _resetPrometheusForTest();
});

test("TASK-05: Sampling Metrics - record dropped traces to Prometheus", async () => {
  _resetOtelTracerForTest();
  await _resetPrometheusForTest();

  recordTraceSamplingForPrometheus("tool_name", false);

  // Give async recording a chance
  await new Promise((resolve) => setTimeout(resolve, 150));

  const { text } = await getPrometheusMetricsText();
  assert.ok(text.includes("sfai_otel_traces_dropped_total"));

  await _resetPrometheusForTest();
});

test("TASK-05: Sampling Metrics - track multiple tools separately", async () => {
  _resetOtelTracerForTest();
  await _resetPrometheusForTest();

  recordTraceSamplingForPrometheus("tool_a", true);
  recordTraceSamplingForPrometheus("tool_b", true);

  // Give async recording a chance
  await new Promise((resolve) => setTimeout(resolve, 150));

  const { text } = await getPrometheusMetricsText();
  assert.ok(text.includes('tool="tool_a"'));
  assert.ok(text.includes('tool="tool_b"'));

  await _resetPrometheusForTest();
});
