import {
  existsSync,
  mkdirSync,
  copyFileSync,
  lstatSync,
  renameSync,
  rmSync,
  unlinkSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { checkbox } from "@inquirer/prompts";

export type InstallAgent = "codex" | "opencode" | "claude";

export interface InstallOptions {
  agent?: string;
  all?: boolean;
}

const skillName = "dbrief-note";
const allAgents: InstallAgent[] = ["codex", "opencode", "claude"];
const installTargets: Record<InstallAgent, { label: string; configDir: string; hint: string }> = {
  codex: {
    label: "Codex",
    configDir: ".codex",
    hint: "$dbrief-note",
  },
  opencode: {
    label: "Opencode",
    configDir: ".opencode",
    hint: "Load the dbrief-note skill with Opencode's skill tool",
  },
  claude: {
    label: "Claude Code",
    configDir: ".claude",
    hint: "Ask Claude Code to use the dbrief-note skill",
  },
};

function findSkillSource(): string {
  const distDir = (() => {
    try {
      return dirname(fileURLToPath(import.meta.url));
    } catch {
      return dirname(process.argv[1]);
    }
  })();

  const candidates = [
    join(distDir, "..", "skills", skillName, "SKILL.md"),
    join(distDir, "..", "..", "skills", skillName, "SKILL.md"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    "Could not find dbrief-note skill.\n" +
      "Is the package installed correctly?"
  );
}

export async function installCommand(options: InstallOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const skillSource = findSkillSource();
  const agents = await resolveInstallAgents(options);

  for (const agent of agents) {
    installSkillForAgent(cwd, skillSource, agent);
  }

  console.log(`\nUsage:`);
  console.log(`  dbrief extract`);
  for (const agent of agents) {
    console.log(`  ${installTargets[agent].hint}`);
  }
  console.log(`  or invoke the skill in any of your coding agents`);
}

async function resolveInstallAgents(options: InstallOptions): Promise<InstallAgent[]> {
  if (options.all) {
    return allAgents;
  }

  if (options.agent) {
    return parseInstallAgents(options.agent);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    const selected = await checkbox<InstallAgent>({
      message: "Install dbrief-note skill to:",
      choices: allAgents.map((agent) => ({
        name: `${installTargets[agent].label} (${installTargets[agent].configDir}/skills/${skillName}/SKILL.md)`,
        value: agent,
        checked: agent === "codex",
      })),
      required: true,
      shortcuts: {
        all: null,
        invert: null,
      },
      theme: {
        icon: {
          checked: "[x]",
          unchecked: "[ ]",
          cursor: ">",
        },
        style: {
          keysHelpTip: () => "Space to select, Enter to confirm",
        },
      },
    });
    return selected;
  }

  return ["codex"];
}

function parseInstallAgents(value: string): InstallAgent[] {
  const agents = value
    .split(",")
    .map((part) => normalizeInstallAgent(part))
    .filter((agent, index, parsed) => parsed.indexOf(agent) === index);

  if (agents.length === 0) {
    throw new Error("No coding agents selected. Expected codex, opencode, or claude.");
  }

  return agents;
}

function normalizeInstallAgent(value: string): InstallAgent {
  const normalized = value.trim().toLowerCase();

  if (normalized === "claudecode" || normalized === "claude-code") {
    return "claude";
  }

  if (normalized === "codex" || normalized === "opencode" || normalized === "claude") {
    return normalized;
  }

  throw new Error(`Unknown coding agent: ${value}. Expected codex, opencode, or claude.`);
}

function installSkillForAgent(cwd: string, skillSource: string, agent: InstallAgent): void {
  const target = installTargets[agent];
  const agentDir = join(cwd, target.configDir);
  const skillsDir = join(agentDir, "skills");
  const targetDir = join(skillsDir, skillName);
  const targetFile = join(targetDir, "SKILL.md");
  const installDirs = [agentDir, skillsDir, targetDir];

  ensureSafeInstallDirectories(installDirs);
  mkdirSync(targetDir, { recursive: true });
  ensureSafeInstallDirectories(installDirs);
  const tempFile = join(
    targetDir,
    `.SKILL.md.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  try {
    copyFileSync(skillSource, tempFile);
    ensureSafeInstallDestination(targetFile);

    if (existsSync(targetFile)) {
      unlinkSync(targetFile);
    }

    renameSync(tempFile, targetFile);
  } catch (error) {
    rmSync(tempFile, { force: true });
    throw error;
  }

  console.log(`Installed dbrief-note skill for ${target.label} to ${targetFile}`);
}

function ensureSafeInstallDirectories(dirs: string[]): void {
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      continue;
    }

    const stats = lstatSync(dir);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to use symbolic link in install path: ${dir}`);
    }

    if (!stats.isDirectory()) {
      throw new Error(`Refusing to use non-directory install path: ${dir}`);
    }
  }
}

function ensureSafeInstallDestination(targetFile: string): void {
  if (!existsSync(targetFile)) {
    return;
  }

  const stats = lstatSync(targetFile);
  if (!stats.isFile()) {
    throw new Error(`Refusing to overwrite non-regular file: ${targetFile}`);
  }

  if (stats.isSymbolicLink()) {
    throw new Error(`Refusing to overwrite symbolic link: ${targetFile}`);
  }

  if (stats.nlink > 1) {
    throw new Error(`Refusing to overwrite hard-linked file: ${targetFile}`);
  }
}
