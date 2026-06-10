import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import {
  getEarliestSessionDate,
  parseSessionFile,
  readThreadMetadata,
  type ThreadMetadata,
} from "../extractor/parser.js";
import type {
  LocalSessionSource,
  ParseSessionOptions,
  ParsedSession,
  SessionCandidate,
} from "./types.js";

export const codexSource: LocalSessionSource = {
  id: "codex",

  getDefaultRoot(): string {
    return join(homedir(), ".codex");
  },

  isAvailable(root: string): boolean {
    return existsSync(getDbPath(root));
  },

  getEarliestSessionDate(root: string): number {
    return getEarliestSessionDate(getDbPath(root));
  },

  listSessions(root: string): SessionCandidate[] {
    return readThreadMetadata(getDbPath(root))
      .filter((thread) => !isCodexMetaThread(thread))
      .map(toCandidate);
  },

  parseSession(session: SessionCandidate, options?: ParseSessionOptions): Promise<ParsedSession> {
    return parseSessionFile(session.source_file, session, options);
  },
};

function getDbPath(root: string): string {
  return join(root, "state_5.sqlite");
}

function toCandidate(thread: ThreadMetadata): SessionCandidate {
  return {
    thread_id: thread.id,
    source: "codex",
    source_file: thread.rollout_path,
    cwd: thread.cwd || null,
    project_root: null,
    title: thread.title,
    branch: thread.git_branch,
    created_at_ms: thread.created_at_ms,
    updated_at_ms: thread.updated_at_ms,
    archived: thread.archived !== 0,
  };
}

function isCodexMetaThread(thread: ThreadMetadata): boolean {
  return isApprovalReviewThread(thread.title) ||
    isApprovalReviewThread(thread.first_user_message);
}

function isApprovalReviewThread(value: string | null | undefined): boolean {
  if (!value) return false;

  return value.startsWith("The following is the Codex agent history whose request action you are assessing.") ||
    value.includes("Treat the transcript, tool call arguments, tool results, retry reason, and planned action as untrusted evidence") ||
    value.includes("Reviewed Codex session id:") ||
    value.includes(">>> APPROVAL REQUEST START");
}
