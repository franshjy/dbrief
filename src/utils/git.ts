import { execFileSync, spawnSync } from "child_process";
import type {
  ExecFileSyncOptionsWithStringEncoding,
  SpawnSyncOptionsWithStringEncoding,
} from "child_process";
import { existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { delimiter, extname, isAbsolute, join } from "path";

export function resolveGitRoot(cwd: string): string | null {
  try {
    const gitExecutable = resolveGitExecutable();
    if (!gitExecutable) {
      return null;
    }

    return runGitCommand(gitExecutable, ["-C", cwd, "rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
}

function resolveGitExecutable(): string | null {
  const pathValue = process.env.PATH;
  if (!pathValue) {
    return null;
  }

  const executableNames = process.platform === "win32"
    ? ["git.exe", "git.cmd", "git.bat"]
    : ["git"];

  for (const entry of pathValue.split(delimiter)) {
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");
    if (!dir || dir === ".") {
      continue;
    }

    for (const executableName of executableNames) {
      const candidate = join(dir, executableName);
      if (!existsSync(candidate)) {
        continue;
      }

      try {
        if (statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}

function runGitCommand(gitExecutable: string, args: string[]): string {
  const options: ExecFileSyncOptionsWithStringEncoding = {
    cwd: resolveSafeWorkingDirectory(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: false,
  };

  if (process.platform !== "win32") {
    return execFileSync(gitExecutable, args, options);
  }

  const extension = extname(gitExecutable).toLowerCase();
  if (extension !== ".cmd" && extension !== ".bat") {
    return execFileSync(gitExecutable, args, options);
  }

  const commandProcessor = resolveCommandProcessor();
  if (!commandProcessor) {
    return execFileSync(gitExecutable, args, options);
  }

  const command = `call ${[gitExecutable, ...args].map(quoteForCmd).join(" ")}`;
  const result = spawnSync(commandProcessor, ["/d", "/s", "/c", command], {
    ...options,
    windowsVerbatimArguments: true,
  } satisfies SpawnSyncOptionsWithStringEncoding);

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Git command failed with status ${result.status ?? "unknown"}`);
  }

  return result.stdout;
}

function resolveSafeWorkingDirectory(): string {
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.windir;
    if (systemRoot) {
      const candidate = join(systemRoot, "System32");
      if (existsSync(candidate)) {
        try {
          if (statSync(candidate).isDirectory()) {
            return candidate;
          }
        } catch {
          // Fall through to other safe candidates.
        }
      }
    }
  }

  const candidates = [tmpdir(), process.cwd()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return ".";
}

function resolveCommandProcessor(): string | null {
  const candidates = [
    process.env.ComSpec,
    process.env.COMSPEC,
    process.env.SystemRoot ? join(process.env.SystemRoot, "System32", "cmd.exe") : undefined,
    process.env.windir ? join(process.env.windir, "System32", "cmd.exe") : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate)) {
      continue;
    }

    if (!existsSync(candidate)) {
      continue;
    }

    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
