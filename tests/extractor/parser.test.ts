import { describe, it, expect } from "vitest";
import { join } from "path";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { parseSessionFile } from "../../src/extractor/parser";

const fixturePath = join(import.meta.dirname, "..", "fixtures", "sample-session.jsonl");
const compactedFixture = join(import.meta.dirname, "..", "fixtures", "compacted-session.jsonl");

describe("parseSessionFile", () => {
  it("parses messages from a JSONL session file", async () => {
    const session = await parseSessionFile(fixturePath, "test-thread-1");

    expect(session.thread_id).toBe("test-thread-1");
    expect(session.cwd).toBe("/test/project");
    expect(session.timezone).toBe("Asia/Bangkok");
    expect(session.messages.length).toBeGreaterThan(0);
    expect(session.context).toEqual([]);
    expect(session.user_activity_timestamps).toHaveLength(3);
  });

  it("extracts user messages as tuples", async () => {
    const session = await parseSessionFile(fixturePath, "test-thread-1");
    const userMessages = session.messages.filter((m) => m[0] === "u");

    expect(userMessages.length).toBe(3);
    expect(userMessages[0][1]).toBe("Hello, help me with this task");
  });

  it("extracts user message timestamps", async () => {
    const session = await parseSessionFile(fixturePath, "test-thread-1");

    expect(session.user_activity_timestamps).toEqual([
      Date.parse("2026-06-02T05:00:02.000Z"),
      Date.parse("2026-06-02T05:01:00.000Z"),
      Date.parse("2026-06-02T23:00:00.000Z"),
    ]);
  });

  it("extracts assistant responses as tuples", async () => {
    const session = await parseSessionFile(fixturePath, "test-thread-1");
    const assistantMsgs = session.messages.filter((m) => m[0] === "a");

    expect(assistantMsgs.length).toBe(2);
    expect(assistantMsgs[0][1]).toContain("Sure, I can help");
  });

  it("returns empty session for non-existent file", async () => {
    const session = await parseSessionFile("/nonexistent/path.jsonl", "missing");

    expect(session.thread_id).toBe("missing");
    expect(session.messages).toEqual([]);
    expect(session.context).toEqual([]);
    expect(session.user_activity_timestamps).toEqual([]);
  });

  it("reports a warning for non-existent files", async () => {
    const warnings: Array<{ type: string; detail: string }> = [];

    await parseSessionFile("/nonexistent/path.jsonl", "missing", {
      onWarning: (warning) => warnings.push({ type: warning.type, detail: warning.detail }),
    });

    expect(warnings).toEqual([
      { type: "missing_file", detail: "Session file does not exist" },
    ]);
  });

  it("reports invalid JSONL lines and continues parsing valid messages", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "codex-trails-parser-"));
    const filePath = join(testDir, "invalid.jsonl");
    writeFileSync(
      filePath,
      [
        "{\"timestamp\":\"2026-06-02T05:00:01.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"/test/project\",\"timezone\":\"UTC\"}}",
        "not-json",
        "{\"timestamp\":\"2026-06-02T05:00:02.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello\"}}",
      ].join("\n"),
      "utf-8"
    );

    const warnings: Array<{ type: string; line?: number }> = [];

    try {
      const session = await parseSessionFile(filePath, "bad-jsonl", {
        onWarning: (warning) => warnings.push({ type: warning.type, line: warning.line }),
      });

      expect(session.messages).toEqual([["u", "hello"]]);
      expect(session.user_activity_timestamps).toEqual([
        Date.parse("2026-06-02T05:00:02.000Z"),
      ]);
      expect(warnings).toEqual([{ type: "invalid_jsonl", line: 2 }]);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("extracts replacement_history as context on compacted sessions", async () => {
    const session = await parseSessionFile(compactedFixture, "compacted-thread");

    expect(session.context.length).toBe(3);
    expect(session.context[0][0]).toBe("u");
    expect(session.context[0][1]).toBe("Earlier context from before compaction");
    expect(session.context[1][0]).toBe("a");
    expect(session.context[1][1]).toBe("Earlier assistant reply from history");
  });

  it("only keeps post-compaction messages in messages array", async () => {
    const session = await parseSessionFile(compactedFixture, "compacted-thread");

    expect(session.messages.length).toBe(2);
    expect(session.messages[0]).toEqual(["u", "Post-compaction user message"]);
    expect(session.messages[1]).toEqual(["a", "Post-compaction assistant response"]);
    expect(session.user_activity_timestamps).toEqual([
      Date.parse("2026-06-01T10:00:02.000Z"),
      Date.parse("2026-06-01T12:00:01.000Z"),
    ]);
  });

  it("extracts compacted replacement_history entries when content is stored as typed arrays", async () => {
    const testDir = mkdtempSync(join(tmpdir(), "codex-trails-compacted-arrays-"));
    const filePath = join(testDir, "compacted-arrays.jsonl");

    writeFileSync(
      filePath,
      [
        "{\"timestamp\":\"2026-06-01T10:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"/test/project\",\"timezone\":\"UTC\"}}",
        "{\"timestamp\":\"2026-06-01T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"before compact\"}}",
        "{\"timestamp\":\"2026-06-01T10:00:02.000Z\",\"type\":\"compacted\",\"payload\":{\"message\":\"\",\"replacement_history\":[{\"type\":\"message\",\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"User message preserved in compacted history\"}]},{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Assistant message preserved in compacted history\"}]},{\"type\":\"compaction\",\"encrypted_content\":\"opaque\"}]}}",
        "{\"timestamp\":\"2026-06-01T10:00:03.000Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"after compact\"}]}}",
      ].join("\n"),
      "utf-8"
    );

    try {
      const session = await parseSessionFile(filePath, "compacted-arrays");

      expect(session.context).toEqual([
        ["u", "User message preserved in compacted history"],
        ["a", "Assistant message preserved in compacted history"],
      ]);
      expect(session.messages).toEqual([["a", "after compact"]]);
      expect(session.user_activity_timestamps).toEqual([
        Date.parse("2026-06-01T10:00:01.000Z"),
      ]);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
