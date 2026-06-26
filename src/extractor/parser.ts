import Database from "better-sqlite3";
import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";
import type { MessageTuple } from "../types/artifact.js";
import {
  createEmptyParsedSession,
  type ParseSessionOptions,
  type ParsedSession,
  type SessionCandidate,
} from "../sources/types.js";

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

export type { ParsedSession, SessionParseWarning, ParseSessionOptions } from "../sources/types.js";

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
  thread: string | SessionCandidate,
  options: ParseSessionOptions = {}
): Promise<ParsedSession> {
  const candidate = typeof thread === "string"
    ? {
      thread_id: thread,
      source: "codex" as const,
      source_file: filePath,
      cwd: null,
      project_root: null,
      title: null,
      branch: null,
      created_at_ms: 0,
      updated_at_ms: 0,
      archived: false,
    }
    : thread;
  const session = createEmptyParsedSession({
    ...candidate,
    source_file: filePath,
  });

  if (!existsSync(filePath)) {
    options.onWarning?.({
      source: session.source,
      type: "missing_file",
      filePath,
      threadId: session.thread_id,
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
          source: session.source,
          type: "invalid_jsonl",
          filePath,
          threadId: session.thread_id,
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
        session.message_timestamps = [];
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
            session.message_timestamps?.push(timestampMs);
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
              session.message_timestamps?.push(Date.parse(raw.timestamp));
            }
          }
        }
      }
    }
  } catch (error) {
    options.onWarning?.({
      source: session.source,
      type: "read_error",
      filePath,
      threadId: session.thread_id,
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

    if (role === "user") {
      const text = extractHistoryText(content, "input_text");
      if (text) {
        messages.push(["u", text]);
      }
    } else if (role === "assistant") {
      const text = extractHistoryText(content, "output_text");
      if (text) {
        messages.push(["a", text]);
      }
    }
  }

  return messages;
}

function extractHistoryText(content: unknown, textType: "input_text" | "output_text"): string | null {
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const textParts = (content as Array<{ type?: string; text?: string }>)
    .filter((entry) => entry.type === textType && typeof entry.text === "string" && entry.text.trim())
    .map((entry) => entry.text!.trim())
    .join("\n");

  return textParts || null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
