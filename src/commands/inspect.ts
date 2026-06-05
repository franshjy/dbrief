import { readFileSync, existsSync } from "fs";
import type { DailyArtifact } from "../types/artifact.js";

interface InspectOptions {
  input: string;
  format?: string;
}

export function inspectCommand(options: InspectOptions): void {
  if (!existsSync(options.input)) {
    console.error(`File not found: ${options.input}`);
    process.exit(1);
  }

  const raw = readFileSync(options.input, "utf-8");
  let artifact: DailyArtifact;

  try {
    artifact = JSON.parse(raw) as DailyArtifact;
  } catch {
    console.error(`Invalid JSON in: ${options.input}`);
    process.exit(1);
  }

  if (!isDailyArtifact(artifact)) {
    console.error("Invalid artifact schema.");
    process.exit(1);
  }

  if (options.format === "summary") {
    printSummary(artifact);
  } else {
    console.log(JSON.stringify(artifact, null, 2));
  }
}

function printSummary(artifact: DailyArtifact): void {
  console.log(`Daily Artifact: ${sanitizeForTerminal(artifact.date)}`);
  console.log(`Timezone: ${sanitizeForTerminal(artifact.timezone)}`);
  console.log(`Projects: ${artifact.projects.length}`);
  console.log();

  for (const project of artifact.projects) {
    const messageCount = project.threads.reduce((s, t) => s + t.messages.length, 0);
    const contextCount = project.threads.reduce((s, t) => s + t.context.length, 0);
    const hybridCount = project.threads.filter((t) => t.context.length > 0).length;
    console.log(`  ${sanitizeForTerminal(project.project_key)}`);
    console.log(`    threads: ${project.threads.length}${hybridCount > 0 ? ` (${hybridCount} hybrid)` : ""}`);
    console.log(`    messages: ${messageCount}`);
    if (contextCount > 0) {
      console.log(`    context: ${contextCount}`);
    }
    console.log();
  }

  const totalMessages = artifact.projects.reduce(
    (s, p) => s + p.threads.reduce((tS, t) => tS + t.messages.length, 0),
    0
  );
  const totalContext = artifact.projects.reduce(
    (s, p) => s + p.threads.reduce((tS, t) => tS + t.context.length, 0),
    0
  );
  const totalThreads = artifact.projects.reduce((s, p) => s + p.threads.length, 0);

  const parts = [`${totalThreads} threads`, `${totalMessages} messages`];
  if (totalContext > 0) parts.push(`${totalContext} context`);
  console.log(`Totals: ${parts.join(", ")}`);
}

function isDailyArtifact(value: unknown): value is DailyArtifact {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.date !== "string" || typeof value.timezone !== "string") {
    return false;
  }

  if (!Array.isArray(value.projects)) {
    return false;
  }

  return value.projects.every(isProject);
}

function isProject(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.project_key === "string" &&
    Array.isArray(value.threads) &&
    value.threads.every(isThread);
}

function isThread(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.title === "string" &&
    (typeof value.branch === "string" || value.branch === null) &&
    isMessageTupleArray(value.context) &&
    isMessageTupleArray(value.messages);
}

function isMessageTupleArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => {
    return Array.isArray(item) &&
      item.length === 2 &&
      (item[0] === "u" || item[0] === "a") &&
      typeof item[1] === "string";
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeForTerminal(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}
