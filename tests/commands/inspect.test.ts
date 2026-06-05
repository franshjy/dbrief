import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { inspectCommand } from "../../src/commands/inspect";

describe("inspect command", () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of cleanupDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed artifacts in summary mode", () => {
    const testDir = mkdtempSync(join(tmpdir(), "codex-trails-inspect-invalid-"));
    cleanupDirs.push(testDir);

    const inputPath = join(testDir, "artifact.json");
    writeFileSync(inputPath, JSON.stringify({ date: "2026-06-04", timezone: "UTC", projects: {} }), "utf-8");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: string | number | null) => {
        throw new Error(`process.exit:${code ?? ""}`);
      }) as typeof process.exit);

    expect(() => inspectCommand({ input: inputPath, format: "summary" })).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith("Invalid artifact schema.");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("sanitizes control characters in summary output", () => {
    const testDir = mkdtempSync(join(tmpdir(), "codex-trails-inspect-sanitize-"));
    cleanupDirs.push(testDir);

    const inputPath = join(testDir, "artifact.json");
    writeFileSync(
      inputPath,
      JSON.stringify({
        date: "2026-06-04\u001b[2J",
        timezone: "UTC\u0007",
        projects: [
          {
            project_key: "demo\u001b]0;spoof\u0007",
            threads: [
              {
                title: "Thread",
                branch: null,
                context: [],
                messages: [["u", "hello"]],
              },
            ],
          },
        ],
      }),
      "utf-8"
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    inspectCommand({ input: inputPath, format: "summary" });

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("\\u001b");
    expect(output).toContain("\\u0007");
    expect(output).not.toContain("\u001b");
  });
});
