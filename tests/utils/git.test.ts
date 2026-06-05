import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGitRoot } from "../../src/utils/git";
import { tmpdir } from "os";
import { join } from "path";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";

const cleanupDirs: string[] = [];
const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalComSpec = process.env.ComSpec;
const originalSystemRoot = process.env.SystemRoot;
const originalWindir = process.env.windir;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process, "platform", { value: originalPlatform });
  restoreEnv("PATH", originalPath);
  restoreEnv("ComSpec", originalComSpec);
  restoreEnv("SystemRoot", originalSystemRoot);
  restoreEnv("windir", originalWindir);

  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveGitRoot", () => {
  it("returns the git root for a valid git repository", () => {
    const root = resolveGitRoot(process.cwd());
    expect(root).toBeDefined();
    expect(typeof root).toBe("string");
    expect(root!.length).toBeGreaterThan(0);
  });

  it("returns null for a non-git directory", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "no-git-"));
    cleanupDirs.push(tempDir);
    const root = resolveGitRoot(tempDir);
    expect(root).toBeNull();
  });

  it("supports a git.bat wrapper that forwards to an absolute real git path", () => {
    const harness = createWindowsGitHarness();
    const root = resolveGitRoot(harness.repoDir);

    expect(root).toBe(harness.expectedRoot);
    expect(readFileSync(harness.cwdLogPath, "utf-8").trim().toLowerCase()).toBe(
      harness.safeCwd.toLowerCase()
    );
  });

  it("does not execute cwd-local git.cmd when using a git.bat wrapper", () => {
    const harness = createWindowsGitHarness();
    writeFileSync(
      join(harness.repoDir, "git.cmd"),
      "@echo off\r\necho hijacked-git-root\r\n",
      "utf-8"
    );

    const root = resolveGitRoot(harness.repoDir);

    expect(root).toBe(harness.expectedRoot);
    expect(readFileSync(harness.cwdLogPath, "utf-8").trim().toLowerCase()).toBe(
      harness.safeCwd.toLowerCase()
    );
  });
});

function createWindowsGitHarness(): {
  repoDir: string;
  expectedRoot: string;
  cwdLogPath: string;
  safeCwd: string;
} {
  const testDir = mkdtempSync(join(tmpdir(), "git-wrapper-test-"));
  cleanupDirs.push(testDir);

  const fakeBinDir = join(testDir, "bin");
  const fakeGitBat = join(fakeBinDir, "git.bat");
  const fakeRealGitBat = join(testDir, "real-git.bat");
  const repoDir = join(testDir, "repo");
  const cwdLogPath = join(testDir, "cwd.log");
  const expectedRoot = join(testDir, "expected-root");
  const realSystemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\WINDOWS";
  const realSystem32 = join(realSystemRoot, "System32");
  const realCmdExe = process.env.ComSpec ?? join(realSystem32, "cmd.exe");

  mkdirSync(fakeBinDir, { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(expectedRoot, { recursive: true });

  writeFileSync(
    fakeGitBat,
    [
      "@echo off",
      'set "REAL_GIT=' + escapeBatchPath(fakeRealGitBat) + '"',
      '"%REAL_GIT%" %*',
      "",
    ].join("\r\n"),
    "utf-8"
  );

  writeFileSync(
    fakeRealGitBat,
    [
      "@echo off",
      `echo %CD%>${escapeBatchPath(cwdLogPath)}`,
      'if "%~1"=="-C" if "%~3"=="rev-parse" if "%~4"=="--show-toplevel" (',
      `  echo ${escapeBatchPath(expectedRoot)}`,
      "  exit /b 0",
      ")",
      "exit /b 1",
      "",
    ].join("\r\n"),
    "utf-8"
  );

  if (!existsSync(realCmdExe)) {
    throw new Error(`cmd.exe not found at ${realCmdExe}`);
  }

  Object.defineProperty(process, "platform", { value: "win32" });
  process.env.PATH = fakeBinDir;
  process.env.ComSpec = realCmdExe;
  process.env.SystemRoot = realSystemRoot;
  process.env.windir = realSystemRoot;

  return {
    repoDir,
    expectedRoot,
    cwdLogPath,
    safeCwd: realSystem32,
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function escapeBatchPath(value: string): string {
  return value.replace(/\//g, "\\");
}
