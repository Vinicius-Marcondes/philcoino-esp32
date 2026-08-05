import { describe, expect, test } from "bun:test";

const source = await Bun.file(
  new URL("../src/history/shot-history-repository.native.ts", import.meta.url),
).text();

describe("native shot history repository trace storage", () => {
  test("atomically migrates weighted rows into generalized extraction tables", () => {
    expect(source).toContain("INSERT OR IGNORE INTO extraction_history");
    expect(source).toContain("INSERT OR IGNORE INTO extraction_traces");
    expect(source).toContain("INSERT OR IGNORE INTO extraction_trace_samples");
    expect(source).toContain("database.withTransactionAsync(async () =>");
  });

  test("does not automatically prune retained extraction history", () => {
    expect(source).not.toContain("recorded_at_ms < ?");
    expect(source).not.toContain("RETENTION_MS");
  });

  test("reads trace samples scoped to the stored boot", () => {
    expect(source).toContain(
      "WHERE device_id = ? AND extraction_id = ? AND boot_id = ?",
    );
    expect(source).toContain("const bootId = String(metadata.boot_id);");
    expect(source).not.toContain(
      `WHERE device_id = ? AND extraction_id = ?
       ORDER BY sequence`,
    );
  });

  test("deletes superseded samples when committing a page", () => {
    expect(source).toContain("DELETE FROM weighted_shot_trace_samples");
    expect(source).toContain("AND (boot_id != ? OR sequence > ?)");
    expect(source).toContain(
      "const retainedSequence = trace.samples.at(-1)?.sequence ?? 0;",
    );
  });

  test("purges samples orphaned by an earlier boot when opening the database", () => {
    expect(source).toContain(
      "WHERE (device_id, extraction_id, boot_id) NOT IN (",
    );
    expect(source).toContain(
      "SELECT device_id, extraction_id, boot_id FROM weighted_shot_traces",
    );
  });

  test("counts history trace samples for the stored boot only", () => {
    expect(source).toContain("AND s.boot_id = h.boot_id");
    expect(source).toContain("AND t.boot_id = h.boot_id");
  });
});
