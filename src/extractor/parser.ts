import Database from "better-sqlite3";
import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";
import type { MessageTuple } from "../types/artifact.js";

export interface ThreadMetadata {
  id: string;
  rollout_path: string;
  cwd: string;
  title: string;
  first_user_message: string;
  created_at_ms: number;
  updated_at_ms: number;
  git_branch: string | null;
  git_sha: string | null;
  git_origin_url: string | null;
  source: string;
  model: string | null;
  archived: number;
}

export interface RawJsonlLine {
  timestamp: string;
  type: string;
  payload?: Record<string, unknown>;
}

export interface ParsedSession {
  thread_id: string;
  source_file: string;
  cwd: string | null;
  timezone: string | null;
  context: MessageTuple[];
  messages: MessageTuple[];
  user_activity_timestamps: number[];
}

export interface SessionParseWarning {
  type: "missing_file" | "invalid_jsonl" | "read_error";
  filePath: string;
  threadId: string;
  detail: string;
  line?: number;
}

interface ParseSessionOptions {
  onWarning?: (warning: SessionParseWarning) => void;
}

export function getEarliestSessionDate(dbPath: string): number {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare(`SELECT MIN(created_at_ms) as earliest FROM threads WHERE archived = 0`)
      .get() as { earliest: number | null };
    if (row.earliest === null) {
      throw new Error("No threads found in database");
    }
    return row.earliest;
  } catch (error) {
    throw new Error(`Failed to read earliest session date from ${dbPath}: ${getErrorMessage(error)}`);
  } finally {
    db?.close();
  }
}

export function readThreadMetadata(dbPath: string): ThreadMetadata[] {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const rows = db
      .prepare(
        `SELECT id, rollout_path, cwd, title, first_user_message,
                created_at_ms, updated_at_ms, git_branch, git_sha,
                git_origin_url, source, model, archived
         FROM threads
         WHERE archived = 0`
      )
      .all() as ThreadMetadata[];
    return rows;
  } catch (error) {
    throw new Error(`Failed to read thread metadata from ${dbPath}: ${getErrorMessage(error)}`);
  } finally {
    db?.close();
  }
}

export async function parseSessionFile(
  filePath: string,
  threadId: string,
  options: ParseSessionOptions = {}
): Promise<ParsedSession> {
  const session: ParsedSession = {
    thread_id: threadId,
    source_file: filePath,
    cwd: null,
    timezone: null,
    context: [],
    messages: [],
    user_activity_timestamps: [],
  };

  if (!existsSync(filePath)) {
    options.onWarning?.({
      type: "missing_file",
      filePath,
      threadId,
      detail: "Session file does not exist",
    });
    return session;
  }

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  try {
    let lineNumber = 0;

    for await (const line of rl) {
      lineNumber += 1;
      if (!line.trim()) continue;

      let raw: RawJsonlLine;
      try {
        raw = JSON.parse(line);
      } catch {
        options.onWarning?.({
          type: "invalid_jsonl",
          filePath,
          threadId,
          line: lineNumber,
          detail: "Skipped invalid JSONL line",
        });
        continue;
      }

      if (raw.type === "turn_context" && raw.payload) {
        session.cwd = (raw.payload.cwd as string) ?? session.cwd;
        session.timezone = (raw.payload.timezone as string) ?? session.timezone;
      }

      if (raw.type === "compacted" && raw.payload) {
        const replacementHistory = raw.payload.replacement_history as
          | Array<Record<string, unknown>>
          | undefined;
        if (replacementHistory && replacementHistory.length > 0) {
          session.context = extractMessagesFromHistory(replacementHistory);
        }
        session.messages = [];
        continue;
      }

      if (raw.type === "event_msg" && raw.payload) {
        const eventType = raw.payload.type as string;

        if (eventType === "user_message") {
          const content = (raw.payload.message as string) ?? "";
          const timestampMs = Date.parse(raw.timestamp);
          if (!Number.isNaN(timestampMs)) {
            session.user_activity_timestamps.push(timestampMs);
          }
          if (content) {
            session.messages.push(["u", content]);
          }
        }
      }

      if (raw.type === "response_item" && raw.payload) {
        const payloadType = raw.payload.type as string;

        if (payloadType === "message" && raw.payload.role === "assistant") {
          const content = raw.payload.content as Array<{ type: string; text?: string }>;
          if (Array.isArray(content)) {
            const textParts = content
              .filter((c) => c.type === "output_text" && c.text)
              .map((c) => c.text!)
              .join("\n");
            if (textParts) {
              session.messages.push(["a", textParts]);
            }
          }
        }
      }
    }
  } catch (error) {
    options.onWarning?.({
      type: "read_error",
      filePath,
      threadId,
      detail: `Failed to read session file: ${getErrorMessage(error)}`,
    });
  } finally {
    rl.close();
  }

  return session;
}

function extractMessagesFromHistory(
  items: Array<Record<string, unknown>>
): MessageTuple[] {
  const messages: MessageTuple[] = [];

  for (const item of items) {
    const role = item.role as string;
    const content = item.content;

    if (role === "user" && typeof content === "string" && content.trim()) {
      messages.push(["u", content.trim()]);
    } else if (role === "assistant") {
      if (typeof content === "string" && content.trim()) {
        messages.push(["a", content.trim()]);
      } else if (Array.isArray(content)) {
        const textParts = (content as Array<{ type: string; text?: string }>)
          .filter((c) => c.type === "output_text" && c.text)
          .map((c) => c.text!)
          .join("\n");
        if (textParts.trim()) {
          messages.push(["a", textParts.trim()]);
        }
      }
    }
  }

  return messages;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
