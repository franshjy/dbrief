import type { Project, Thread } from "../types/artifact.js";
import type { ParsedSession } from "../sources/types.js";
import { resolveGitRoot } from "../utils/git.js";

export interface GroupedSessions {
  [projectKey: string]: {
    sessions: ParsedSession[];
  };
}

export function groupSessionsByProject(sessions: ParsedSession[]): GroupedSessions {
  const grouped: GroupedSessions = {};
  const gitRootCache = new Map<string, string | null>();

  for (const session of sessions) {
    const cwd = session.cwd ?? "unknown";
    let projectKey = session.project_root ?? null;

    if (!projectKey) {
      let gitRoot = gitRootCache.get(cwd);
      if (gitRoot === undefined) {
        gitRoot = resolveGitRoot(cwd);
        gitRootCache.set(cwd, gitRoot);
      }
      projectKey = gitRoot ?? cwd;
    }

    if (!grouped[projectKey]) {
      grouped[projectKey] = {
        sessions: [],
      };
    }

    grouped[projectKey].sessions.push(session);
  }

  return grouped;
}

export function buildProjectStructure(grouped: GroupedSessions): Project[] {
  return Object.entries(grouped).map(([projectKey, data]) => {
    const threads: Thread[] = data.sessions.map((session) => ({
      title: session.title ?? session.thread_id,
      branch: session.branch ?? null,
      context: session.context,
      messages: session.messages,
    }));

    return {
      project_key: projectKey,
      threads,
    };
  });
}
