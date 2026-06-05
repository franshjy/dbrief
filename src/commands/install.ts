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

function findSkillSource(): string {
  const distDir = (() => {
    try {
      return dirname(fileURLToPath(import.meta.url));
    } catch {
      return dirname(process.argv[1]);
    }
  })();

  const candidates = [
    join(distDir, "..", "skills", "dbrief-note", "SKILL.md"),
    join(distDir, "..", "..", "skills", "dbrief-note", "SKILL.md"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    "Could not find dbrief-note skill.\n" +
      "Is the package installed correctly?"
  );
}

export function installCommand(): void {
  const cwd = process.cwd();
  const skillSource = findSkillSource();

  const targetDir = join(cwd, ".codex", "skills", "dbrief-note");
  const targetFile = join(targetDir, "SKILL.md");

  mkdirSync(targetDir, { recursive: true });
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

  console.log(`Installed dbrief-note skill to ${targetFile}`);
  console.log(`\nUsage:`);
  console.log(`  dbrief extract`);
  console.log(`  $dbrief_note`);
  console.log(`  or invoke the skill in any of your coding agents`);
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
