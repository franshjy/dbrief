import type { Project, Thread } from "../types/artifact.js";
import type { ParsedSession, ThreadMetadata } from "./parser.js";
import { resolveGitRoot } from "../utils/git.js";

export interface GroupedSessions {
  [projectKey: string]: {
    sessions: Array<{ session: ParsedSession; metadata: ThreadMetadata | null }>;
  };
}

export function groupSessionsByProject(
  sessions: ParsedSession[],
  threadMetadata: Map<string, ThreadMetadata>
): GroupedSessions {
  const grouped: GroupedSessions = {};
  const gitRootCache = new Map<string, string | null>();

  for (const session of sessions) {
    const cwd = session.cwd ?? "unknown";
    let gitRoot = gitRootCache.get(cwd);
    if (gitRoot === undefined) {
      gitRoot = resolveGitRoot(cwd);
      gitRootCache.set(cwd, gitRoot);
    }
    const projectKey = gitRoot ?? cwd;
    const metadata = threadMetadata.get(session.thread_id) ?? null;

    if (!grouped[projectKey]) {
      grouped[projectKey] = {
        sessions: [],
      };
    }

    grouped[projectKey].sessions.push({ session, metadata });
  }

  return grouped;
}

export function buildProjectStructure(grouped: GroupedSessions): Project[] {
  return Object.entries(grouped).map(([projectKey, data]) => {
    const threads: Thread[] = data.sessions.map(({ session, metadata }) => ({
      title: metadata?.title ?? session.thread_id,
      branch: metadata?.git_branch ?? null,
      context: session.context,
      messages: session.messages,
    }));

    return {
      project_key: projectKey,
      threads,
    };
  });
}
