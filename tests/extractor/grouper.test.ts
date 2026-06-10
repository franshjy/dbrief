import { describe, it, expect, vi, afterEach } from "vitest";
import {
  groupSessionsByProject,
  buildProjectStructure,
} from "../../src/extractor/grouper";
import type { ParsedSession } from "../../src/sources/types";
import type { MessageTuple } from "../../src/types/artifact";
import * as gitUtils from "../../src/utils/git";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("groupSessionsByProject", () => {
  it("groups sessions by cwd", () => {
    const sessions: ParsedSession[] = [
      {
        thread_id: "s1",
        source: "codex",
        source_file: "s1.jsonl",
        cwd: "/project-a",
        project_root: null,
        title: "Thread 1",
        branch: null,
        created_at_ms: 0,
        updated_at_ms: 0,
        archived: false,
        timezone: "UTC",
        context: [],
        messages: [["u", "hello"]],
        user_activity_timestamps: [],
      },
      {
        thread_id: "s2",
        source: "codex",
        source_file: "s2.jsonl",
        cwd: "/project-a",
        project_root: null,
        title: "Thread 2",
        branch: null,
        created_at_ms: 0,
        updated_at_ms: 0,
        archived: false,
        timezone: "UTC",
        context: [],
        messages: [["u", "again"]],
        user_activity_timestamps: [],
      },
      {
        thread_id: "s3",
        source: "codex",
        source_file: "s3.jsonl",
        cwd: "/project-b",
        project_root: null,
        title: "Thread 3",
        branch: null,
        created_at_ms: 0,
        updated_at_ms: 0,
        archived: false,
        timezone: "UTC",
        context: [],
        messages: [["u", "other project"]],
        user_activity_timestamps: [],
      },
    ];
    const grouped = groupSessionsByProject(sessions);
    const keys = Object.keys(grouped);

    expect(keys.length).toBeGreaterThanOrEqual(2);
  });

  it("handles sessions with null cwd", () => {
    const sessions: ParsedSession[] = [
      {
        thread_id: "s1",
        source: "codex",
        source_file: "s1.jsonl",
        cwd: null,
        project_root: null,
        title: "Thread 1",
        branch: null,
        created_at_ms: 0,
        updated_at_ms: 0,
        archived: false,
        timezone: null,
        context: [],
        messages: [],
        user_activity_timestamps: [],
      },
    ];
    const grouped = groupSessionsByProject(sessions);
    expect(grouped["unknown"]).toBeDefined();
  });

  it("memoizes git root resolution for repeated cwd values", () => {
    const resolveSpy = vi
      .spyOn(gitUtils, "resolveGitRoot")
      .mockImplementation((cwd) => cwd);

    const sessions: ParsedSession[] = [
      {
        thread_id: "s1",
        source: "codex",
        source_file: "s1.jsonl",
        cwd: "/project-a",
        project_root: null,
        title: "Thread 1",
        branch: null,
        created_at_ms: 0,
        updated_at_ms: 0,
        archived: false,
        timezone: "UTC",
        context: [],
        messages: [["u", "hello"]],
        user_activity_timestamps: [],
      },
      {
        thread_id: "s2",
        source: "codex",
        source_file: "s2.jsonl",
        cwd: "/project-a",
        project_root: null,
        title: "Thread 2",
        branch: null,
        created_at_ms: 0,
        updated_at_ms: 0,
        archived: false,
        timezone: "UTC",
        context: [],
        messages: [["u", "again"]],
        user_activity_timestamps: [],
      },
    ];
    const grouped = groupSessionsByProject(sessions);

    expect(grouped["/project-a"]).toBeDefined();
    expect(resolveSpy).toHaveBeenCalledTimes(1);
  });
});

describe("buildProjectStructure", () => {
  it("builds project array with threads, context, and messages", () => {
    const grouped = {
      "/test/project": {
        sessions: [
          {
            thread_id: "s1",
            source: "codex",
            source_file: "s1.jsonl",
            cwd: "/test/project",
            project_root: "/test/project",
            title: "My Thread",
            branch: "feature-x",
            created_at_ms: 0,
            updated_at_ms: 0,
            archived: false,
            timezone: "UTC",
            context: [["u", "old context"] as MessageTuple],
            messages: [
              ["u", "hello"] as MessageTuple,
              ["a", "hi there"] as MessageTuple,
            ],
            user_activity_timestamps: [],
          },
        ],
      },
    };

    const projects = buildProjectStructure(grouped);

    expect(projects.length).toBe(1);
    expect(projects[0].project_key).toBe("/test/project");
    expect(projects[0].threads.length).toBe(1);
    expect(projects[0].threads[0].title).toBe("My Thread");
    expect(projects[0].threads[0].branch).toBe("feature-x");
    expect(projects[0].threads[0].context.length).toBe(1);
    expect(projects[0].threads[0].messages.length).toBe(2);
  });
});
