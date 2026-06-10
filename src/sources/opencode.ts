import Database from "better-sqlite3";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { MessageTuple } from "../types/artifact.js";
import {
  createEmptyParsedSession,
  type LocalSessionSource,
  type ParseSessionOptions,
  type ParsedSession,
  type SessionCandidate,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

interface OpencodeSessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
  time_archived: number | null;
  metadata: string | null;
  worktree: string;
  workspace_branch: string | null;
}

interface OpencodeMessageRow {
  message_id: string;
  message_time_created: number;
  message_data: string;
  part_id: string | null;
  part_time_created: number | null;
  part_data: string | null;
}

interface OpencodeContextRow {
  baseline: string;
  snapshot: string;
}

interface GroupedMessage {
  id: string;
  timeCreated: number;
  messageData: JsonRecord | null;
  parts: Array<{
    id: string;
    timeCreated: number;
    data: JsonRecord | null;
  }>;
}

export const opencodeSource: LocalSessionSource = {
  id: "opencode",

  getDefaultRoot(): string {
    const xdgDataHome = process.env.XDG_DATA_HOME;
    if (xdgDataHome) {
      return join(xdgDataHome, "opencode");
    }
    return join(homedir(), ".local", "share", "opencode");
  },

  isAvailable(root: string): boolean {
    return existsSync(getDbPath(root));
  },

  getEarliestSessionDate(root: string): number {
    const dbPath = getDbPath(root);
    if (!existsSync(dbPath)) {
      throw new Error(`Opencode database not found: ${dbPath}`);
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare("SELECT MIN(time_created) AS earliest FROM session WHERE time_archived IS NULL")
        .get() as { earliest: number | null };

      if (row.earliest === null) {
        throw new Error(`No sessions found in Opencode database: ${dbPath}`);
      }

      return row.earliest;
    } finally {
      db?.close();
    }
  },

  listSessions(root: string): SessionCandidate[] {
    const dbPath = getDbPath(root);
    if (!existsSync(dbPath)) {
      throw new Error(`Opencode database not found: ${dbPath}`);
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      const rows = db.prepare(`
        SELECT
          s.id,
          s.title,
          s.directory,
          s.time_created,
          s.time_updated,
          s.time_archived,
          s.metadata,
          p.worktree,
          (
            SELECT w.branch
            FROM workspace w
            WHERE w.project_id = s.project_id
              AND w.branch IS NOT NULL
              AND w.branch != ''
            ORDER BY w.time_used DESC
            LIMIT 1
          ) AS workspace_branch
        FROM session s
        JOIN project p ON p.id = s.project_id
        WHERE s.time_archived IS NULL
      `).all() as OpencodeSessionRow[];

      return rows.map((row) => toCandidate(dbPath, row));
    } finally {
      db?.close();
    }
  },

  async parseSession(session: SessionCandidate, options: ParseSessionOptions = {}): Promise<ParsedSession> {
    const parsed = createEmptyParsedSession(session);
    const dbPath = session.source_file;

    if (!existsSync(dbPath)) {
      options.onWarning?.({
        source: "opencode",
        type: "missing_file",
        filePath: dbPath,
        threadId: session.thread_id,
        detail: "Opencode database does not exist",
      });
      return parsed;
    }

    let db: Database.Database | null = null;
    try {
      db = new Database(dbPath, { readonly: true });
      parsed.context = readCompactedContext(db, session.thread_id, dbPath, options);

      const rows = db.prepare(`
        SELECT
          m.id AS message_id,
          m.time_created AS message_time_created,
          m.data AS message_data,
          p.id AS part_id,
          p.time_created AS part_time_created,
          p.data AS part_data
        FROM message m
        LEFT JOIN part p ON p.message_id = m.id
        WHERE m.session_id = ?
        ORDER BY m.time_created ASC, p.time_created ASC, p.id ASC
      `).all(session.thread_id) as OpencodeMessageRow[];

      for (const message of groupMessageRows(rows, dbPath, session.thread_id, options)) {
        const role = getString(message.messageData?.role);
        const createdAt = toFiniteNumber(asRecord(message.messageData?.time)?.created) ?? message.timeCreated;
        const visibleText = message.parts
          .map((part) => extractVisibleText(part.data))
          .filter((value): value is string => Boolean(value));

        if (role === "user") {
          if (visibleText.length > 0) {
            parsed.messages.push(["u", visibleText.join("\n")]);
            parsed.user_activity_timestamps.push(createdAt);
          }
          continue;
        }

        if (role === "assistant" && visibleText.length > 0) {
          parsed.messages.push(["a", visibleText.join("\n")]);
        }
      }

      return parsed;
    } catch (error) {
      options.onWarning?.({
        source: "opencode",
        type: "read_error",
        filePath: dbPath,
        threadId: session.thread_id,
        detail: getErrorMessage(error),
      });
      return parsed;
    } finally {
      db?.close();
    }
  },
};

function getDbPath(root: string): string {
  return join(root, "opencode.db");
}

function toCandidate(dbPath: string, row: OpencodeSessionRow): SessionCandidate {
  const metadata = parseJsonRecord(row.metadata);
  const projectRoot = normalizeProjectRoot(row.worktree, row.directory);

  return {
    thread_id: row.id,
    source: "opencode",
    source_file: dbPath,
    cwd: row.directory || null,
    project_root: projectRoot,
    title: row.title || row.id,
    branch: row.workspace_branch ??
      getString(metadata?.branch) ??
      getString(metadata?.gitBranch) ??
      null,
    created_at_ms: row.time_created,
    updated_at_ms: row.time_updated,
    archived: row.time_archived !== null,
  };
}

function normalizeProjectRoot(worktree: string, directory: string): string | null {
  if (worktree && worktree !== "/") {
    return worktree;
  }
  return directory || null;
}

function readCompactedContext(
  db: Database.Database,
  sessionId: string,
  dbPath: string,
  options: ParseSessionOptions
): MessageTuple[] {
  const row = db.prepare(`
    SELECT baseline, snapshot
    FROM session_context_epoch
    WHERE session_id = ?
  `).get(sessionId) as OpencodeContextRow | undefined;

  if (!row) {
    return [];
  }

  const tuples: MessageTuple[] = [];
  for (const field of [row.baseline, row.snapshot]) {
    const parsed = parseJsonRecord(field);
    if (!parsed) continue;
    tuples.push(...extractContextMessages(parsed));
  }

  if (tuples.length === 0 && (row.baseline.trim() || row.snapshot.trim())) {
    options.onWarning?.({
      source: "opencode",
      type: "invalid_record",
      filePath: dbPath,
      threadId: sessionId,
      detail: "Session compaction exists but no recoverable summary text was found",
    });
  }

  return dedupeContextMessages(tuples);
}

function groupMessageRows(
  rows: OpencodeMessageRow[],
  dbPath: string,
  threadId: string,
  options: ParseSessionOptions
): GroupedMessage[] {
  const grouped = new Map<string, GroupedMessage>();

  for (const row of rows) {
    const messageData = parseJsonRecord(row.message_data);
    if (row.message_data && !messageData) {
      options.onWarning?.({
        source: "opencode",
        type: "invalid_record",
        filePath: dbPath,
        threadId,
        detail: `Invalid message JSON for ${row.message_id}`,
      });
    }

    let message = grouped.get(row.message_id);
    if (!message) {
      message = {
        id: row.message_id,
        timeCreated: row.message_time_created,
        messageData,
        parts: [],
      };
      grouped.set(row.message_id, message);
    }

    if (!row.part_id || row.part_time_created === null || row.part_data === null) {
      continue;
    }

    const partData = parseJsonRecord(row.part_data);
    if (!partData) {
      options.onWarning?.({
        source: "opencode",
        type: "invalid_record",
        filePath: dbPath,
        threadId,
        detail: `Invalid part JSON for ${row.part_id}`,
      });
      continue;
    }

    message.parts.push({
      id: row.part_id,
      timeCreated: row.part_time_created,
      data: partData,
    });
  }

  return Array.from(grouped.values());
}

function extractVisibleText(part: JsonRecord | null): string | null {
  if (!part) return null;
  if (getString(part.type) !== "text") return null;
  if (part.synthetic === true) return null;

  const text = getString(part.text);
  if (!text || !text.trim()) return null;
  return text.trim();
}

function extractContextMessages(value: unknown): MessageTuple[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractContextMessages(entry));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const role = normalizeRole(getString(record.role));
  const directText = getString(record.text) ?? getString(record.content);
  if (role && directText && directText.trim()) {
    return [[role, directText.trim()]];
  }

  const nestedContent = record.content;
  if (role && Array.isArray(nestedContent)) {
    const joined = nestedContent
      .map((entry) => asRecord(entry))
      .map((entry) => getString(entry?.text))
      .filter((entry): entry is string => Boolean(entry && entry.trim()))
      .map((entry) => entry.trim())
      .join("\n");

    if (joined) {
      return [[role, joined]];
    }
  }

  return [];
}

function dedupeContextMessages(messages: MessageTuple[]): MessageTuple[] {
  const result: MessageTuple[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    const key = `${message[0]}:${message[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(message);
  }

  return result;
}

function normalizeRole(role: string | null): "u" | "a" | null {
  if (role === "user") return "u";
  if (role === "assistant") return "a";
  return null;
}

function parseJsonRecord(value: string | null): JsonRecord | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? value as JsonRecord : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
