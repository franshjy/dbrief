import type { MessageTuple } from "../types/artifact.js";

export type SessionSourceId = "codex" | "opencode" | "claude";

export interface SessionCandidate {
  thread_id: string;
  source: SessionSourceId;
  source_file: string;
  cwd: string | null;
  project_root: string | null;
  title: string | null;
  branch: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  archived: boolean;
}

export interface ParsedSession extends SessionCandidate {
  timezone: string | null;
  context: MessageTuple[];
  messages: MessageTuple[];
  user_activity_timestamps: number[];
}

export interface SessionParseWarning {
  source: SessionSourceId;
  type: "missing_file" | "invalid_jsonl" | "invalid_record" | "read_error";
  filePath: string;
  threadId: string;
  detail: string;
  line?: number;
}

export interface ParseSessionOptions {
  onWarning?: (warning: SessionParseWarning) => void;
}

export interface LocalSessionSource {
  id: Exclude<SessionSourceId, "claude">;
  getDefaultRoot(): string;
  isAvailable(root: string): boolean;
  getEarliestSessionDate(root: string): number;
  listSessions(root: string): SessionCandidate[];
  parseSession(session: SessionCandidate, options?: ParseSessionOptions): Promise<ParsedSession>;
}

export function createEmptyParsedSession(candidate: SessionCandidate): ParsedSession {
  return {
    ...candidate,
    timezone: null,
    context: [],
    messages: [],
    user_activity_timestamps: [],
  };
}
