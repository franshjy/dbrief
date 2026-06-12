import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, extname, join } from "path";
import {
  createEmptyParsedSession,
  type LocalSessionSource,
  type ParseSessionOptions,
  type ParsedSession,
  type SessionCandidate,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

interface ClaudeSessionMetadata {
  threadId: string;
  cwd: string | null;
  branch: string | null;
  createdAt: number;
  updatedAt: number;
  title: string | null;
}

export const claudeSource: LocalSessionSource = {
  id: "claude",

  getDefaultRoot(): string {
    return join(homedir(), ".claude");
  },

  isAvailable(root: string): boolean {
    return existsSync(getProjectsDir(root));
  },

  getEarliestSessionDate(root: string): number {
    const sessions = this.listSessions(root);
    if (sessions.length === 0) {
      throw new Error(`No Claude sessions found under: ${getProjectsDir(root)}`);
    }
    return Math.min(...sessions.map((session) => session.created_at_ms));
  },

  listSessions(root: string): SessionCandidate[] {
    const projectsDir = getProjectsDir(root);
    if (!existsSync(projectsDir)) {
      throw new Error(`Claude projects directory not found: ${projectsDir}`);
    }

    return listClaudeSessionFiles(projectsDir).map((filePath) => {
      const stat = statSync(filePath);
      const metadata = readClaudeSessionMetadata(filePath);

      return {
        thread_id: metadata.threadId,
        source: "claude",
        source_file: filePath,
        cwd: metadata.cwd,
        project_root: metadata.cwd,
        title: metadata.title ?? metadata.threadId,
        branch: metadata.branch,
        created_at_ms: metadata.createdAt || stat.birthtimeMs || stat.mtimeMs,
        updated_at_ms: metadata.updatedAt || stat.mtimeMs || metadata.createdAt,
        archived: false,
      };
    });
  },

  async parseSession(session: SessionCandidate, options: ParseSessionOptions = {}): Promise<ParsedSession> {
    const parsed = createEmptyParsedSession(session);
    const filePath = session.source_file;

    if (!existsSync(filePath)) {
      options.onWarning?.({
        source: "claude",
        type: "missing_file",
        filePath,
        threadId: session.thread_id,
        detail: "Claude session file does not exist",
      });
      return parsed;
    }

    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split(/\r?\n/);

      for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        if (!rawLine.trim()) continue;

        let record: JsonRecord | null = null;
        try {
          record = asRecord(JSON.parse(rawLine));
        } catch {
          options.onWarning?.({
            source: "claude",
            type: "invalid_jsonl",
            filePath,
            threadId: session.thread_id,
            detail: "Invalid JSONL line",
            line: index + 1,
          });
          continue;
        }

        if (!record) {
          options.onWarning?.({
            source: "claude",
            type: "invalid_record",
            filePath,
            threadId: session.thread_id,
            detail: `Line ${index + 1} is not a JSON object`,
            line: index + 1,
          });
          continue;
        }

        hydrateSessionMetadata(parsed, record);

        const role = getString(asRecord(record.message)?.role);
        if (role === "user") {
          const userText = extractClaudeUserText(record);
          if (userText) {
            parsed.messages.push(["u", userText]);
            const timestamp = parseIsoTimestamp(getString(record.timestamp));
            if (timestamp !== null) {
              parsed.user_activity_timestamps.push(timestamp);
            }
            if (!parsed.title) {
              parsed.title = userText;
            }
          }
          continue;
        }

        if (role === "assistant") {
          const assistantText = extractClaudeAssistantText(record);
          if (assistantText) {
            parsed.messages.push(["a", assistantText]);
          }
          continue;
        }

        if (getString(record.type) === "summary") {
          const summaryText = extractClaudeSummaryText(record);
          if (summaryText) {
            parsed.context.push(["a", summaryText]);
          }
        }
      }

      return parsed;
    } catch (error) {
      options.onWarning?.({
        source: "claude",
        type: "read_error",
        filePath,
        threadId: session.thread_id,
        detail: getErrorMessage(error),
      });
      return parsed;
    }
  },
};

function getProjectsDir(root: string): string {
  return join(root, "projects");
}

function listClaudeSessionFiles(projectsDir: string): string[] {
  const result: string[] = [];

  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectDir = join(projectsDir, entry.name);

    for (const child of readdirSync(projectDir, { withFileTypes: true })) {
      if (!child.isFile()) continue;
      if (extname(child.name) !== ".jsonl") continue;
      result.push(join(projectDir, child.name));
    }
  }

  return result;
}

function readClaudeSessionMetadata(filePath: string): ClaudeSessionMetadata {
  const fallbackThreadId = basename(filePath, ".jsonl");
  const stat = statSync(filePath);
  const metadata: ClaudeSessionMetadata = {
    threadId: fallbackThreadId,
    cwd: null,
    branch: null,
    createdAt: Math.trunc(stat.birthtimeMs || stat.mtimeMs),
    updatedAt: Math.trunc(stat.mtimeMs || stat.birthtimeMs),
    title: null,
  };

  try {
    const content = readFileSync(filePath, "utf-8");
    for (const rawLine of content.split(/\r?\n/)) {
      if (!rawLine.trim()) continue;
      const record = parseJsonRecord(rawLine);
      if (!record) continue;

      hydrateSessionMetadata(metadata, record);

      const role = getString(asRecord(record.message)?.role);
      if (role === "user") {
        const title = extractClaudeUserText(record);
        if (title && !metadata.title) {
          metadata.title = title;
        }
      }
    }
  } catch {
    return metadata;
  }

  return metadata;
}

function hydrateSessionMetadata(
  target: Pick<ParsedSession, "cwd" | "project_root" | "branch" | "title"> & { thread_id?: string } | ClaudeSessionMetadata,
  record: JsonRecord
): void {
  const cwd = getString(record.cwd);
  if (cwd) {
    target.cwd = cwd;
    if ("project_root" in target) {
      target.project_root = cwd;
    }
  }

  const branch = getString(record.gitBranch);
  if (branch) {
    target.branch = branch;
  }

  const sessionId = getString(record.sessionId);
  if (sessionId) {
    if ("thread_id" in target && !target.thread_id) {
      target.thread_id = sessionId;
    }
    if ("threadId" in target) {
      target.threadId = sessionId;
    }
  }

  const timestamp = parseIsoTimestamp(getString(record.timestamp));
  if (timestamp !== null && "createdAt" in target) {
    target.createdAt = Math.min(target.createdAt, timestamp);
    target.updatedAt = Math.max(target.updatedAt, timestamp);
  }
}

function extractClaudeUserText(record: JsonRecord): string | null {
  if (record.isMeta === true) return null;

  const message = asRecord(record.message);
  const text = extractMessageText(message?.content, "user");
  if (!text) return null;
  if (isOperationalClaudeText(text)) return null;
  return text;
}

function extractClaudeAssistantText(record: JsonRecord): string | null {
  const message = asRecord(record.message);
  return extractMessageText(message?.content, "assistant");
}

function extractClaudeSummaryText(record: JsonRecord): string | null {
  const direct = getString(record.summary) ?? getString(record.text) ?? getString(record.content);
  if (direct && direct.trim()) {
    return direct.trim();
  }

  return extractMessageText(record.content, "assistant");
}

function extractMessageText(content: unknown, role: "user" | "assistant"): string | null {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed ? trimmed : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const texts = content
    .map((entry) => asRecord(entry))
    .flatMap((entry) => extractContentEntryText(entry, role))
    .filter((text) => text.trim().length > 0);

  if (texts.length === 0) {
    return null;
  }

  return texts.join("\n");
}

function extractContentEntryText(entry: JsonRecord | null, role: "user" | "assistant"): string[] {
  if (!entry) return [];

  const type = getString(entry.type);
  if (type === "text") {
    const text = getString(entry.text);
    return text && text.trim() ? [text.trim()] : [];
  }

  if (role === "assistant" && type === "thinking") {
    return [];
  }

  return [];
}

function isOperationalClaudeText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("<local-command-caveat>") ||
    trimmed.startsWith("<command-name>") ||
    trimmed.startsWith("<local-command-stdout>") ||
    trimmed.startsWith("<local-command-stderr>");
}

function parseJsonRecord(value: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseIsoTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null ? value as JsonRecord : null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
