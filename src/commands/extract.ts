import { join } from "path";
import { homedir } from "os";
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
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
import {
  implementedSources,
  isKnownSourceId,
} from "../sources/index.js";
import type {
  LocalSessionSource,
  ParsedSession,
  SessionCandidate,
  SessionParseWarning,
  SessionSourceId,
} from "../sources/types.js";

interface ExtractOptions {
  date?: string;
  from?: string;
  to?: string;
  out?: string;
  source?: string[];
  codexDir?: string;
  opencodeDir?: string;
  claudeDir?: string;
}

interface EnabledSource {
  source: LocalSessionSource;
  root: string;
}

interface ParsedSourceSessions {
  sessions: ParsedSession[];
  warnings: SessionParseWarning[];
  candidates: SessionCandidate[];
}

export async function extractCommand(options: ExtractOptions): Promise<void> {
  try {
    const timezone = getSystemTimezone();
    const enabledSources = resolveEnabledSources(options);
    const isRangeMode = options.from !== undefined || options.to !== undefined;

    if (isRangeMode) {
      await extractRange(options, timezone, enabledSources);
    } else {
      const dateStr = parseDate(options.date ?? "today");
      const boundaries = getDayBoundaries(dateStr, timezone);
      const candidates = listCandidateSessions(enabledSources);

      console.log(`Extracting activity for ${dateStr} (${timezone})`);
      console.log(`Day boundaries: ${boundaries.start.toISOString()} - ${boundaries.end.toISOString()}`);
      console.log(`Sources: ${enabledSources.map((entry) => `${entry.source.id}=${entry.root}`).join(", ")}`);
      console.log(`Found ${candidates.length} candidate threads`);

      await extractDay(dateStr, timezone, candidates, boundaries, options.out, enabledSources);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Extraction failed: ${message}`);
  }
}

async function extractRange(
  options: ExtractOptions,
  timezone: string,
  enabledSources: EnabledSource[]
): Promise<void> {
  let fromDate: string;
  let toDate: string;

  if (options.from) {
    fromDate = parseDate(options.from);
  } else {
    const earliestMs = getEarliestSessionDate(enabledSources);
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
  console.log(`Sources: ${enabledSources.map((entry) => `${entry.source.id}=${entry.root}`).join(", ")}`);
  console.log(`Output: ${outDir ?? "current directory"}\n`);

  const rangeStart = getDayBoundaries(fromDate, timezone).start;
  const rangeEnd = getDayBoundaries(toDate, timezone).end;
  const candidates = listCandidateSessions(enabledSources, rangeStart, rangeEnd);
  const parsed = await parseSessions(enabledSources, candidates);
  printWarnings(`${fromDate}..${toDate}`, parsed.warnings);

  for (const dateStr of dates) {
    const boundaries = getDayBoundaries(dateStr, timezone);
    const outPath = outDir
      ? join(outDir, getDefaultArtifactFilename(dateStr))
      : getDefaultArtifactPath(dateStr);

    await extractDay(
      dateStr,
      timezone,
      parsed.candidates,
      boundaries,
      outPath,
      enabledSources,
      parsed
    );
  }

  console.log(`\nDone. Extracted ${dates.length} day${dates.length === 1 ? "" : "s"} to ${outDir ?? "current directory"}`);
}

async function extractDay(
  dateStr: string,
  timezone: string,
  candidates: SessionCandidate[],
  boundaries: { start: Date; end: Date },
  outPathOverride: string | undefined,
  enabledSources: EnabledSource[],
  parsedSourceSessions?: ParsedSourceSessions
): Promise<void> {
  const parsed = parsedSourceSessions ?? await parseSessions(enabledSources, candidates);

  if (!parsedSourceSessions) {
    printWarnings(dateStr, parsed.warnings);
  }

  const activeSessions = filterSessionsByActivity(parsed.sessions, boundaries.start, boundaries.end);

  if (activeSessions.length === 0) {
    console.log(`  ${dateStr}: no activity (${candidates.length} threads scanned)`);
    return;
  }

  const grouped = groupSessionsByProject(activeSessions);
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
    (sum, project) => sum + project.threads.reduce((threadSum, thread) => threadSum + thread.messages.length, 0),
    0
  );
  const totalContext = projects.reduce(
    (sum, project) => sum + project.threads.reduce((threadSum, thread) => threadSum + thread.context.length, 0),
    0
  );
  const hybridCount = projects.reduce(
    (sum, project) => sum + project.threads.filter((thread) => thread.context.length > 0).length,
    0
  );

  const threadCount = projects.reduce((sum, project) => sum + project.threads.length, 0);
  const parts = [`${threadCount} threads`];
  if (hybridCount > 0) parts.push(`${hybridCount} hybrid`);
  parts.push(`${totalMessages} messages`);
  if (totalContext > 0) parts.push(`${totalContext} context`);

  console.log(`  ${dateStr}: ${parts.join(", ")}`);
}

async function parseSessions(
  enabledSources: EnabledSource[],
  candidates: SessionCandidate[]
): Promise<ParsedSourceSessions> {
  const sessions: ParsedSession[] = [];
  const warnings: SessionParseWarning[] = [];
  const sourceMap = new Map<"codex" | "opencode", LocalSessionSource>(
    enabledSources.map((entry) => [entry.source.id, entry.source])
  );

  for (const candidate of candidates) {
    const source = candidate.source === "claude" ? undefined : sourceMap.get(candidate.source);
    if (!source) continue;
    sessions.push(await source.parseSession(candidate, {
      onWarning: (warning) => warnings.push(warning),
    }));
  }

  return {
    sessions,
    warnings,
    candidates,
  };
}

function listCandidateSessions(
  enabledSources: EnabledSource[],
  start?: Date,
  end?: Date
): SessionCandidate[] {
  return enabledSources
    .flatMap(({ source, root }) => source.listSessions(root))
    .filter((session) => {
      if (!start || !end) {
        return !session.archived;
      }
      return session.created_at_ms <= end.getTime() &&
        session.updated_at_ms >= start.getTime() &&
        !session.archived;
    })
    .sort((left, right) => {
      if (left.created_at_ms !== right.created_at_ms) {
        return left.created_at_ms - right.created_at_ms;
      }
      if (left.source !== right.source) {
        return left.source.localeCompare(right.source);
      }
      return left.thread_id.localeCompare(right.thread_id);
    });
}

function getEarliestSessionDate(enabledSources: EnabledSource[]): number {
  const timestamps = enabledSources.map(({ source, root }) => source.getEarliestSessionDate(root));
  if (timestamps.length === 0) {
    throw new Error("No enabled sources available to determine the earliest session date.");
  }
  return Math.min(...timestamps);
}

function resolveEnabledSources(options: ExtractOptions): EnabledSource[] {
  const explicitSources = normalizeSourceSelection(options.source);

  if (explicitSources.length > 0) {
    return explicitSources.map((sourceId) => {
      if (sourceId === "claude") {
        throw new Error("Claude source is not implemented yet.");
      }
      const source = implementedSources[sourceId];
      return {
        source,
        root: getSourceRoot(sourceId, options),
      };
    });
  }

  const discovered = Object.values(implementedSources)
    .map((source) => ({ source, root: getSourceRoot(source.id, options) }))
    .filter(({ source, root }) => {
      return hasExplicitRoot(source.id, options) || source.isAvailable(root);
    });

  if (discovered.length === 0) {
    throw new Error(
      "No supported session sources found. Checked " +
      Object.values(implementedSources)
        .map((source) => `${source.id} at ${getSourceRoot(source.id, options)}`)
        .join(", ")
    );
  }

  return discovered;
}

function normalizeSourceSelection(values: string[] | undefined): SessionSourceId[] {
  if (!values || values.length === 0) return [];

  const result: SessionSourceId[] = [];
  for (const rawValue of values) {
    for (const item of rawValue.split(",")) {
      const trimmed = item.trim().toLowerCase();
      if (!trimmed) continue;
      if (!isKnownSourceId(trimmed)) {
        throw new Error(`Unknown source: ${trimmed}. Use codex, opencode, or claude.`);
      }
      if (!result.includes(trimmed)) {
        result.push(trimmed);
      }
    }
  }
  return result;
}

function getSourceRoot(sourceId: SessionSourceId, options: ExtractOptions): string {
  switch (sourceId) {
    case "codex":
      return expandHome(options.codexDir ?? implementedSources.codex.getDefaultRoot());
    case "opencode":
      return expandHome(options.opencodeDir ?? implementedSources.opencode.getDefaultRoot());
    case "claude":
      return expandHome(options.claudeDir ?? join(homedir(), ".claude"));
  }
}

function hasExplicitRoot(sourceId: SessionSourceId, options: ExtractOptions): boolean {
  switch (sourceId) {
    case "codex":
      return options.codexDir !== undefined;
    case "opencode":
      return options.opencodeDir !== undefined;
    case "claude":
      return options.claudeDir !== undefined;
  }
}

function expandHome(value: string): string {
  return value.replace(/^~/, homedir());
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
      return `[${warning.source}] missing session file for thread ${warning.threadId}: ${warning.filePath}`;
    case "invalid_jsonl":
      return `[${warning.source}] invalid JSONL at line ${warning.line ?? "?"} in ${warning.filePath}`;
    case "invalid_record":
      return `[${warning.source}] invalid record in ${warning.filePath}: ${warning.detail}`;
    case "read_error":
      return `[${warning.source}] ${warning.detail} (${warning.filePath})`;
    default:
      return warning.detail;
  }
}
