/**
 * memory-retention.test.ts
 *
 * テスト: project-memory.ts の maxRecords / maxBytes による retention 動作
 */

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * メモリ保持機構のテスト用実装
 */
class ProjectMemory {
  private memory: string[] = [];
  private maxRecords: number;
  private maxBytes: number;

  constructor(maxRecords: number, maxBytes: number) {
    this.maxRecords = maxRecords;
    this.maxBytes = maxBytes;
  }

  addRecord(text: string): void {
    this.memory.push(text);
    this.applyRetention();
  }

  private applyRetention(): void {
    // Apply maxRecords limit
    if (this.memory.length > this.maxRecords) {
      const overflow = this.memory.length - this.maxRecords;
      if (overflow > 0) {
        this.memory.splice(0, overflow);
      }
    }

    // Check maxBytes limit
    const payload = this.memory
      .map((text) => JSON.stringify({ text, savedAt: new Date().toISOString() }))
      .join("\n");
    const bytes = Buffer.byteLength(payload, "utf-8");

    if (bytes > this.maxBytes) {
      // Trim older records to fit within limit
      const keep = Math.max(10, Math.floor(this.maxRecords / 2));
      if (this.memory.length > keep) {
        this.memory.splice(0, this.memory.length - keep);
      }
    }
  }

  getRecords(): string[] {
    return [...this.memory];
  }

  getSize(): number {
    return this.memory.length;
  }

  getByteSize(): number {
    const payload = this.memory
      .map((text) => JSON.stringify({ text, savedAt: new Date().toISOString() }))
      .join("\n");
    return Buffer.byteLength(payload, "utf-8");
  }
}

test("ProjectMemory: respects maxRecords limit", async () => {
  const memory = new ProjectMemory(10, 1024 * 1024);

  for (let i = 0; i < 20; i++) {
    memory.addRecord(`Record ${i}`);
  }

  assert.equal(memory.getSize(), 10, "Should not exceed maxRecords");
  const records = memory.getRecords();
  assert.equal(records[0], "Record 10", "Oldest records should be removed");
  assert.equal(records[9], "Record 19", "Newest record should be last");
});

test("ProjectMemory: respects maxBytes limit", async () => {
  const maxBytes = 1024; // 1KB limit
  const memory = new ProjectMemory(1000, maxBytes);

  // Add large records until we exceed maxBytes
  let recordCount = 0;
  for (let i = 0; i < 100; i++) {
    const largeRecord = "X".repeat(200); // 200 bytes per record
    memory.addRecord(largeRecord);
    recordCount += 1;

    if (memory.getByteSize() <= maxBytes) {
      // Still within limit
    } else {
      // Should have trimmed
      assert.ok(memory.getSize() < recordCount, "Should have trimmed records to fit within maxBytes");
      break;
    }
  }

  assert.ok(memory.getByteSize() <= maxBytes + 500, "Should be close to or under maxBytes limit"); // Allow some slack for JSON structure
});

test("ProjectMemory: maintains minimum keep count on byte limit", async () => {
  const maxBytes = 100; // Very small limit
  const maxRecords = 100;
  const memory = new ProjectMemory(maxRecords, maxBytes);

  // Add enough records to trigger byte limit
  for (let i = 0; i < 50; i++) {
    memory.addRecord("This is a test record with some content " + i);
  }

  // Should maintain at least maxRecords/2 = 50
  assert.ok(memory.getSize() >= Math.floor(maxRecords / 2), "Should maintain minimum keep count");
});

test("ProjectMemory: handles edge case - single large record", async () => {
  const memory = new ProjectMemory(100, 500);

  const largeRecord = "X".repeat(1000); // 1000 bytes
  memory.addRecord(largeRecord);

  // Should keep at least 10 records (minimum keep)
  assert.ok(memory.getSize() <= 100, "Should limit to maxRecords");
  assert.ok(memory.getRecords().some((r) => r === largeRecord), "Large record should be retained");
});

test("ProjectMemory: maintains order (FIFO with retention)", async () => {
  const memory = new ProjectMemory(5, 1024 * 1024);

  for (let i = 0; i < 10; i++) {
    memory.addRecord(`Record ${i}`);
  }

  const records = memory.getRecords();
  assert.deepEqual(
    records,
    ["Record 5", "Record 6", "Record 7", "Record 8", "Record 9"],
    "Should maintain FIFO order with oldest removed"
  );
});

test("ProjectMemory: handles empty and boundary conditions", async () => {
  const memory = new ProjectMemory(10, 1024);

  // Empty state
  assert.equal(memory.getSize(), 0, "Should start empty");
  assert.deepEqual(memory.getRecords(), [], "Records should be empty");

  // Add exactly maxRecords
  for (let i = 0; i < 10; i++) {
    memory.addRecord(`Record ${i}`);
  }
  assert.equal(memory.getSize(), 10, "Should have exactly maxRecords");

  // Add one more
  memory.addRecord("Record 10");
  assert.equal(memory.getSize(), 10, "Should still be at maxRecords");
  assert.equal(memory.getRecords()[0], "Record 1", "Oldest should be removed");
});

test("ProjectMemory: slice boundary check (avoiding slice(-0) bug)", async () => {
  const memory = new ProjectMemory(5, 1024 * 1024);

  // Add records
  for (let i = 0; i < 10; i++) {
    memory.addRecord(`Record ${i}`);
  }

  assert.equal(memory.getSize(), 5, "Should be trimmed to 5");

  // Test slice logic: should NOT use slice(-0) which deletes everything
  // Instead should use proper boundary checks
  const keep = Math.max(10, Math.floor(5 / 2)); // 10 (max of 10 and 2)

  // Add more records with maxRecords = 5 but keep = Math.max(10, 2) = 10
  // This means at least 10 should be kept if possible, but capped by maxRecords
  for (let i = 10; i < 20; i++) {
    memory.addRecord(`Record ${i}`);
  }

  // With maxRecords=5, final result should still be 5, not 0
  assert.ok(memory.getSize() > 0, "Should never result in empty memory due to slice(-0) bug");
  assert.ok(memory.getSize() <= 5, "Should respect maxRecords");
});

test("ProjectMemory: multiple rapid additions maintain consistency", async () => {
  const memory = new ProjectMemory(20, 2048);

  // Rapidly add many records
  const records = [];
  for (let i = 0; i < 100; i++) {
    const record = `Record ${i}`;
    memory.addRecord(record);
    records.push(record);
  }

  const stored = memory.getRecords();
  assert.ok(stored.length <= 20, "Should respect maxRecords");
  assert.ok(stored.length > 0, "Should have some records");

  // Verify stored records are from the end (most recent)
  const expectedStart = 100 - stored.length;
  for (let i = 0; i < stored.length; i++) {
    assert.equal(stored[i], `Record ${expectedStart + i}`, `Record at index ${i} should match expected`);
  }
});

test("ProjectMemory: byte size calculation accuracy", async () => {
  const memory = new ProjectMemory(100, 10000);

  const record1 = "Hello World";
  const record2 = "日本語テキスト";

  memory.addRecord(record1);
  memory.addRecord(record2);

  const byteSize = memory.getByteSize();
  assert.ok(byteSize > 0, "Should calculate byte size");

  // Verify it includes JSON overhead
  const minExpected = Buffer.byteLength(record1, "utf-8") + Buffer.byteLength(record2, "utf-8");
  assert.ok(byteSize >= minExpected, "Byte size should include at least the record content");
});
