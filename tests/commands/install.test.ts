import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync, mkdtempSync, linkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const cliBin = join(process.cwd(), "dist", "index.js");

describe("install command", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "codex-trails-install-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("copies the dbrief-note skill to .codex/skills/dbrief-note/SKILL.md", () => {
    execSync(`node "${cliBin}" install`, { cwd: testDir });

    const targetFile = join(
      testDir,
      ".codex",
      "skills",
      "dbrief-note",
      "SKILL.md"
    );
    expect(existsSync(targetFile)).toBe(true);

    const content = readFileSync(targetFile, "utf-8");
    expect(content).toContain("dbrief-note");
    expect(content).toContain("# Daily Note Generator");
    expect(content).toContain("Run `dbrief extract`");
    expect(content).toContain("## Summary");
    expect(content).toContain("## Projects");
    expect(content).toContain("## Other");
  });

  it("overwrites existing skill file without error", () => {
    execSync(`node "${cliBin}" install`, { cwd: testDir });
    execSync(`node "${cliBin}" install`, { cwd: testDir });

    const targetFile = join(
      testDir,
      ".codex",
      "skills",
      "dbrief-note",
      "SKILL.md"
    );
    expect(existsSync(targetFile)).toBe(true);
  });

  it("refuses to overwrite a hard-linked target file", () => {
    const targetDir = join(testDir, ".codex", "skills", "dbrief-note");
    const targetFile = join(targetDir, "SKILL.md");
    const linkedSource = join(testDir, "linked-source.md");

    writeFileSync(linkedSource, "linked", "utf-8");
    execSync(`node "${cliBin}" install`, { cwd: testDir });
    rmSync(targetFile, { force: true });
    linkSync(linkedSource, targetFile);

    expect(() => execSync(`node "${cliBin}" install`, { cwd: testDir })).toThrow();
    expect(readFileSync(linkedSource, "utf-8")).toBe("linked");
  });
});
