import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../src/utils/timezone", () => ({
  getSystemTimezone: () => "UTC",
}));

import { extractCommand } from "../../src/commands/extract";
import * as parserModule from "../../src/extractor/parser";

describe("extract command", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws a helpful error when the Codex database is missing", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-missing-db-"));
    cleanupDirs.push(codexDir);

    await expect(
      extractCommand({ date: "2026-06-02", codexDir })
    ).rejects.toThrow(`Extraction failed: Database not found: ${join(codexDir, "state_5.sqlite")}`);
  });

  it("throws on an inverted date range", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-range-"));
    cleanupDirs.push(codexDir);
    createThreadsDb(join(codexDir, "state_5.sqlite"));

    await expect(
      extractCommand({
        from: "2026-06-03",
        to: "2026-06-02",
        codexDir,
      })
    ).rejects.toThrow("Extraction failed: Invalid date range: --from 2026-06-03 is after --to 2026-06-02.");
  });

  it("logs parser warnings and still writes an artifact for valid session data", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-extract-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const outPath = join(codexDir, "daily.json");
    const dbPath = join(codexDir, "state_5.sqlite");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T10:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "not-json",
        "{\"timestamp\":\"2026-06-02T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello\"}}",
        "{\"timestamp\":\"2026-06-02T10:00:02.000Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"done\"}]}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "hello",
        created_at_ms: Date.parse("2026-06-02T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-02T10:05:00.000Z"),
      },
    ]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await extractCommand({
      date: "2026-06-02",
      out: outPath,
      codexDir,
    });

    expect(existsSync(outPath)).toBe(true);
    const artifact = JSON.parse(readFileSync(outPath, "utf-8")) as {
      date: string;
      projects: Array<{ threads: Array<{ messages: Array<[string, string]> }> }>;
    };

    expect(artifact.date).toBe("2026-06-02");
    expect(artifact.projects).toHaveLength(1);
    expect(artifact.projects[0].threads[0].messages).toEqual([
      ["u", "hello"],
      ["a", "done"],
    ]);
    expect(warnSpy.mock.calls.flat().join(" ")).toContain("invalid JSONL");
  });

  it("logs a clearer no-activity message and does not write an artifact", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-no-activity-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const outPath = join(codexDir, "daily.json");
    const dbPath = join(codexDir, "state_5.sqlite");

    writeFileSync(
      sessionPath,
      "{\"timestamp\":\"2026-06-01T10:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}\n",
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "hello",
        created_at_ms: Date.parse("2026-06-01T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-01T10:05:00.000Z"),
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await extractCommand({
      date: "2026-06-02",
      out: outPath,
      codexDir,
    });

    expect(existsSync(outPath)).toBe(false);
    expect(logSpy.mock.calls.flat().join(" ")).toContain("no activity (1 threads scanned)");
  });

  it("parses each session file once across range extraction", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-range-cache-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const dbPath = join(codexDir, "state_5.sqlite");
    const outDir = join(codexDir, "out");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T10:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "{\"timestamp\":\"2026-06-02T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello\"}}",
        "{\"timestamp\":\"2026-06-03T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello again\"}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "hello",
        created_at_ms: Date.parse("2026-06-02T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-03T10:00:00.000Z"),
      },
    ]);

    const parseSpy = vi.spyOn(parserModule, "parseSessionFile");
    vi.spyOn(console, "log").mockImplementation(() => {});

    await extractCommand({
      from: "2026-06-02",
      to: "2026-06-03",
      out: outDir,
      codexDir,
    });

    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("includes threads whose lifetime overlaps the requested range", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-range-overlap-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const dbPath = join(codexDir, "state_5.sqlite");
    const outDir = join(codexDir, "out");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T12:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "{\"timestamp\":\"2026-06-02T12:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"work inside range\"}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "old",
        created_at_ms: Date.parse("2026-06-01T08:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-05T08:00:00.000Z"),
      },
    ]);

    vi.spyOn(console, "log").mockImplementation(() => {});

    await extractCommand({
      from: "2026-06-02",
      to: "2026-06-02",
      out: outDir,
      codexDir,
    });

    expect(existsSync(join(outDir, "dbrief_2026-06-02.json"))).toBe(true);
  });

  it("writes the default single-day artifact as dbrief_YYYY-MM-DD.json in the current directory", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-default-single-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const dbPath = join(codexDir, "state_5.sqlite");
    const outputPath = join(process.cwd(), "dbrief_2026-06-02.json");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T10:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "{\"timestamp\":\"2026-06-02T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello\"}}",
        "{\"timestamp\":\"2026-06-03T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello again\"}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "hello",
        created_at_ms: Date.parse("2026-06-02T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-02T10:05:00.000Z"),
      },
    ]);

    vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await extractCommand({
        date: "2026-06-02",
        codexDir,
      });

      expect(existsSync(outputPath)).toBe(true);
    } finally {
      rmSync(outputPath, { force: true });
    }
  });

  it("writes default range artifacts in the current directory with dbrief_YYYY-MM-DD.json names", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-default-range-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const dbPath = join(codexDir, "state_5.sqlite");
    const firstOutput = join(process.cwd(), "dbrief_2026-06-02.json");
    const secondOutput = join(process.cwd(), "dbrief_2026-06-03.json");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T10:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "{\"timestamp\":\"2026-06-02T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello\"}}",
        "{\"timestamp\":\"2026-06-03T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello again\"}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "hello",
        created_at_ms: Date.parse("2026-06-02T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-03T10:00:00.000Z"),
      },
    ]);

    vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await extractCommand({
        from: "2026-06-02",
        to: "2026-06-03",
        codexDir,
      });

      expect(existsSync(firstOutput)).toBe(true);
      expect(existsSync(secondOutput)).toBe(true);
    } finally {
      rmSync(firstOutput, { force: true });
      rmSync(secondOutput, { force: true });
    }
  });

  it("includes resumed threads based on user activity timestamps rather than thread metadata", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-resumed-thread-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const outPath = join(codexDir, "dbrief_2026-06-02.json");
    const dbPath = join(codexDir, "state_5.sqlite");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T12:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "{\"timestamp\":\"2026-06-02T12:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"resume this thread\"}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "old",
        created_at_ms: Date.parse("2026-06-01T08:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-05T08:00:00.000Z"),
      },
    ]);

    vi.spyOn(console, "log").mockImplementation(() => {});

    await extractCommand({
      date: "2026-06-02",
      out: outPath,
      codexDir,
    });

    expect(existsSync(outPath)).toBe(true);
  });

  it("attributes cross-midnight work to the day of the user message", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-cross-midnight-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const firstOutPath = join(codexDir, "dbrief_2026-06-02.json");
    const secondOutPath = join(codexDir, "dbrief_2026-06-03.json");
    const dbPath = join(codexDir, "state_5.sqlite");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T23:59:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "{\"timestamp\":\"2026-06-02T23:59:30.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"do this before midnight\"}}",
        "{\"timestamp\":\"2026-06-03T00:01:00.000Z\",\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"done after midnight\"}]}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "do this before midnight",
        created_at_ms: Date.parse("2026-06-02T23:59:00.000Z"),
        updated_at_ms: Date.parse("2026-06-03T00:01:00.000Z"),
      },
    ]);

    vi.spyOn(console, "log").mockImplementation(() => {});

    await extractCommand({
      date: "2026-06-02",
      out: firstOutPath,
      codexDir,
    });
    await extractCommand({
      date: "2026-06-03",
      out: secondOutPath,
      codexDir,
    });

    expect(existsSync(firstOutPath)).toBe(true);
    expect(existsSync(secondOutPath)).toBe(false);
  });

  it("surfaces parse warnings during range extraction", async () => {
    const codexDir = mkdtempSync(join(tmpdir(), "codex-trails-range-warnings-"));
    cleanupDirs.push(codexDir);

    const projectDir = join(codexDir, "project");
    const sessionPath = join(codexDir, "session.jsonl");
    const outDir = join(codexDir, "out");
    const dbPath = join(codexDir, "state_5.sqlite");

    writeFileSync(
      sessionPath,
      [
        "{\"timestamp\":\"2026-06-02T10:00:00.000Z\",\"type\":\"turn_context\",\"payload\":{\"cwd\":\"" + escapeWindowsPath(projectDir) + "\",\"timezone\":\"UTC\"}}",
        "not-json",
        "{\"timestamp\":\"2026-06-02T10:00:01.000Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"user_message\",\"message\":\"hello\"}}",
      ].join("\n"),
      "utf-8"
    );

    createThreadsDb(dbPath, [
      {
        id: "thread-1",
        rollout_path: sessionPath,
        cwd: projectDir,
        title: "Thread 1",
        first_user_message: "hello",
        created_at_ms: Date.parse("2026-06-02T10:00:00.000Z"),
        updated_at_ms: Date.parse("2026-06-02T10:05:00.000Z"),
      },
    ]);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    await extractCommand({
      from: "2026-06-02",
      to: "2026-06-02",
      out: outDir,
      codexDir,
    });

    expect(warnSpy.mock.calls.flat().join(" ")).toContain("invalid JSONL");
  });
});

interface ThreadSeed {
  id: string;
  rollout_path: string;
  cwd: string;
  title: string;
  first_user_message: string;
  created_at_ms: number;
  updated_at_ms: number;
}

function createThreadsDb(dbPath: string, rows: ThreadSeed[] = []): void {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        rollout_path TEXT NOT NULL,
        cwd TEXT NOT NULL,
        title TEXT NOT NULL,
        first_user_message TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        git_branch TEXT,
        git_sha TEXT,
        git_origin_url TEXT,
        source TEXT NOT NULL,
        model TEXT,
        archived INTEGER NOT NULL
      )
    `);

    const insert = db.prepare(`
      INSERT INTO threads (
        id, rollout_path, cwd, title, first_user_message,
        created_at_ms, updated_at_ms, git_branch, git_sha,
        git_origin_url, source, model, archived
      ) VALUES (
        @id, @rollout_path, @cwd, @title, @first_user_message,
        @created_at_ms, @updated_at_ms, NULL, NULL,
        NULL, 'cli', NULL, 0
      )
    `);

    for (const row of rows) {
      insert.run(row);
    }
  } finally {
    db.close();
  }
}

function escapeWindowsPath(filePath: string): string {
  return filePath.replace(/\\/g, "\\\\");
}
