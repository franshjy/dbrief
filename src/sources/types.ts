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
  message_timestamps?: number[];
  message_ids?: string[];
  user_activity_timestamps: number[];
  compactions?: Array<{
    summary_message_id: string;
    summary_time: number;
    summary_text: string | null;
    tail_start_message_id: string | null;
  }>;
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
  id: SessionSourceId;
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
    message_timestamps: [],
    message_ids: [],
    user_activity_timestamps: [],
    compactions: [],
  };
}
