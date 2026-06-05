import { join } from "path";
import { homedir } from "os";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import {
  readThreadMetadata,
  parseSessionFile,
  getEarliestSessionDate,
} from "../extractor/parser.js";
import {
  getDayBoundaries,
  filterSessionsByActivity,
  parseDate,
  getDateRange,
  timestampToDate,
} from "../extractor/filter.js";
import { groupSessionsByProject, buildProjectStructure } from "../extractor/grouper.js";
import { getSystemTimezone } from "../utils/timezone.js";
import type { DailyArtifact } from "../types/artifact.js";
import type { ParsedSession, SessionParseWarning, ThreadMetadata } from "../extractor/parser.js";

interface ExtractOptions {
  date?: string;
  from?: string;
  to?: string;
  out?: string;
  codexDir: string;
}

export async function extractCommand(options: ExtractOptions): Promise<void> {
  try {
    const timezone = getSystemTimezone();
    const codexDir = options.codexDir.replace(/^~/, homedir());
    const dbPath = join(codexDir, "state_5.sqlite");

    const isRangeMode = options.from !== undefined || options.to !== undefined;

    if (isRangeMode) {
      await extractRange(options, timezone, dbPath);
    } else {
      const dateStr = parseDate(options.date ?? "today");
      const boundaries = getDayBoundaries(dateStr, timezone);
      const threads = readThreadMetadata(dbPath);

      console.log(`Extracting activity for ${dateStr} (${timezone})`);
      console.log(`Day boundaries: ${boundaries.start.toISOString()} - ${boundaries.end.toISOString()}`);
      console.log(`Reading from: ${dbPath}`);
      console.log(`Found ${threads.length} active threads`);

      await extractDay(dateStr, timezone, threads, boundaries, options.out);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Extraction failed: ${message}`);
  }
}

async function extractRange(
  options: ExtractOptions,
  timezone: string,
  dbPath: string
): Promise<void> {
  let fromDate: string;
  let toDate: string;

  if (options.from) {
    fromDate = parseDate(options.from);
  } else {
    const earliestMs = getEarliestSessionDate(dbPath);
    fromDate = timestampToDate(earliestMs, timezone);
  }

  if (options.to) {
    toDate = parseDate(options.to);
  } else {
    toDate = parseDate("today");
  }

  if (fromDate > toDate) {
    throw new Error(`Invalid date range: --from ${fromDate} is after --to ${toDate}.`);
  }

  const dates = getDateRange(fromDate, toDate);
  const outDir = options.out;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
  }

  console.log(`Extracting ${dates.length} days: ${fromDate} to ${toDate}`);
  console.log(`Output: ${outDir ?? "current directory"}\n`);

  const threads = readThreadMetadata(dbPath);
  const rangeStart = getDayBoundaries(fromDate, timezone).start;
  const rangeEnd = getDayBoundaries(toDate, timezone).end;
  const candidateThreads = filterThreadsByActivity(threads, rangeStart, rangeEnd);
  const { sessions, warnings } = await parseThreads(candidateThreads);
  const threadMetadataMap = new Map(candidateThreads.map((t) => [t.id, t]));
  printWarnings(`${fromDate}..${toDate}`, warnings);

  for (const dateStr of dates) {
    const boundaries = getDayBoundaries(dateStr, timezone);
    const outPath = outDir
      ? join(outDir, getDefaultArtifactFilename(dateStr))
      : getDefaultArtifactPath(dateStr);
    await extractDay(
      dateStr,
      timezone,
      candidateThreads,
      boundaries,
      outPath,
      sessions,
      warnings,
      threadMetadataMap
    );
  }

  console.log(`\nDone. Extracted ${dates.length} day${dates.length === 1 ? "" : "s"} to ${outDir ?? "current directory"}`);
}

async function extractDay(
  dateStr: string,
  timezone: string,
  threads: ThreadMetadata[],
  boundaries: { start: Date; end: Date },
  outPathOverride?: string,
  parsedSessions?: ParsedSession[],
  sharedWarnings?: SessionParseWarning[],
  existingThreadMetadataMap?: Map<string, ThreadMetadata>
): Promise<void> {
  const threadMetadataMap = existingThreadMetadataMap ?? new Map(threads.map((t) => [t.id, t]));
  const warnings = sharedWarnings ?? [];
  const sessions = parsedSessions ?? (await parseThreads(threads, warnings)).sessions;

  if (!parsedSessions) {
    printWarnings(dateStr, warnings);
  }

  const activeSessions = filterSessionsByActivity(
    sessions,
    threadMetadataMap,
    boundaries.start,
    boundaries.end
  );

  if (activeSessions.length === 0) {
    console.log(`  ${dateStr}: no activity (${threads.length} threads scanned)`);
    return;
  }

  const grouped = groupSessionsByProject(activeSessions, threadMetadataMap);
  const projects = buildProjectStructure(grouped);

  const artifact: DailyArtifact = {
    date: dateStr,
    timezone,
    projects,
  };

  const outPath = outPathOverride ?? getDefaultArtifactPath(dateStr);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact), "utf-8");

  const totalMessages = projects.reduce(
    (sum, p) => sum + p.threads.reduce((tSum, t) => tSum + t.messages.length, 0),
    0
  );
  const totalContext = projects.reduce(
    (sum, p) => sum + p.threads.reduce((tSum, t) => tSum + t.context.length, 0),
    0
  );
  const hybridCount = projects.reduce(
    (sum, p) => sum + p.threads.filter((t) => t.context.length > 0).length,
    0
  );

  const threadCount = projects.reduce((sum, p) => sum + p.threads.length, 0);
  const parts = [`${threadCount} threads`];
  if (hybridCount > 0) parts.push(`${hybridCount} hybrid`);
  parts.push(`${totalMessages} messages`);
  if (totalContext > 0) parts.push(`${totalContext} context`);

  console.log(`  ${dateStr}: ${parts.join(", ")}`);
}

async function parseThreads(
  threads: ThreadMetadata[],
  warningStore: SessionParseWarning[] = []
): Promise<{ sessions: ParsedSession[]; warnings: SessionParseWarning[] }> {
  const sessions: ParsedSession[] = [];

  for (const thread of threads) {
    const session = await parseSessionFile(thread.rollout_path, thread.id, {
      onWarning: (warning) => warningStore.push(warning),
    });
    sessions.push(session);
  }

  return { sessions, warnings: warningStore };
}

function filterThreadsByActivity(
  threads: ThreadMetadata[],
  start: Date,
  end: Date
): ThreadMetadata[] {
  return threads.filter((thread) => {
    return thread.created_at_ms <= end.getTime() &&
      thread.updated_at_ms >= start.getTime();
  });
}

function printWarnings(dateStr: string, warnings: SessionParseWarning[]): void {
  if (warnings.length === 0) return;

  console.warn(`  ${dateStr}: ${warnings.length} session warning${warnings.length === 1 ? "" : "s"}`);
  for (const warning of warnings.slice(0, 5)) {
    console.warn(`    - ${formatWarning(warning)}`);
  }
  if (warnings.length > 5) {
    console.warn(`    - ... ${warnings.length - 5} more`);
  }
}

function getDefaultArtifactFilename(dateStr: string): string {
  return `dbrief_${dateStr}.json`;
}

function getDefaultArtifactPath(dateStr: string): string {
  return `./${getDefaultArtifactFilename(dateStr)}`;
}

function formatWarning(warning: SessionParseWarning): string {
  switch (warning.type) {
    case "missing_file":
      return `missing session file for thread ${warning.threadId}: ${warning.filePath}`;
    case "invalid_jsonl":
      return `invalid JSONL at line ${warning.line ?? "?"} in ${warning.filePath}`;
    case "read_error":
      return `${warning.detail} (${warning.filePath})`;
    default:
      return warning.detail;
  }
}
