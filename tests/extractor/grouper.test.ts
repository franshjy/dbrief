import { describe, it, expect, vi, afterEach } from "vitest";
import {
  groupSessionsByProject,
  buildProjectStructure,
} from "../../src/extractor/grouper";
import type { ParsedSession, ThreadMetadata } from "../../src/extractor/parser";
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
        source_file: "s1.jsonl",
        cwd: "/project-a",
        timezone: "UTC",
        context: [],
        messages: [["u", "hello"]],
        user_activity_timestamps: [],
      },
      {
        thread_id: "s2",
        source_file: "s2.jsonl",
        cwd: "/project-a",
        timezone: "UTC",
        context: [],
        messages: [["u", "again"]],
        user_activity_timestamps: [],
      },
      {
        thread_id: "s3",
        source_file: "s3.jsonl",
        cwd: "/project-b",
        timezone: "UTC",
        context: [],
        messages: [["u", "other project"]],
        user_activity_timestamps: [],
      },
    ];

    const threadMetadata = new Map<string, ThreadMetadata>([
      ["s1", { id: "s1", rollout_path: "s1.jsonl", cwd: "/project-a", title: "Thread 1", first_user_message: "hello", created_at_ms: 0, updated_at_ms: 0, git_branch: null, git_sha: null, git_origin_url: null, source: "cli", model: null, archived: 0 }],
      ["s2", { id: "s2", rollout_path: "s2.jsonl", cwd: "/project-a", title: "Thread 2", first_user_message: "again", created_at_ms: 0, updated_at_ms: 0, git_branch: null, git_sha: null, git_origin_url: null, source: "cli", model: null, archived: 0 }],
      ["s3", { id: "s3", rollout_path: "s3.jsonl", cwd: "/project-b", title: "Thread 3", first_user_message: "other project", created_at_ms: 0, updated_at_ms: 0, git_branch: null, git_sha: null, git_origin_url: null, source: "cli", model: null, archived: 0 }],
    ]);

    const grouped = groupSessionsByProject(sessions, threadMetadata);
    const keys = Object.keys(grouped);

    expect(keys.length).toBeGreaterThanOrEqual(2);
  });

  it("handles sessions with null cwd", () => {
    const sessions: ParsedSession[] = [
      {
        thread_id: "s1",
        source_file: "s1.jsonl",
        cwd: null,
        timezone: null,
        context: [],
        messages: [],
        user_activity_timestamps: [],
      },
    ];

    const threadMetadata = new Map<string, ThreadMetadata>([
      ["s1", { id: "s1", rollout_path: "s1.jsonl", cwd: "", title: "Thread 1", first_user_message: "", created_at_ms: 0, updated_at_ms: 0, git_branch: null, git_sha: null, git_origin_url: null, source: "cli", model: null, archived: 0 }],
    ]);

    const grouped = groupSessionsByProject(sessions, threadMetadata);
    expect(grouped["unknown"]).toBeDefined();
  });

  it("memoizes git root resolution for repeated cwd values", () => {
    const resolveSpy = vi
      .spyOn(gitUtils, "resolveGitRoot")
      .mockImplementation((cwd) => cwd);

    const sessions: ParsedSession[] = [
      {
        thread_id: "s1",
        source_file: "s1.jsonl",
        cwd: "/project-a",
        timezone: "UTC",
        context: [],
        messages: [["u", "hello"]],
        user_activity_timestamps: [],
      },
      {
        thread_id: "s2",
        source_file: "s2.jsonl",
        cwd: "/project-a",
        timezone: "UTC",
        context: [],
        messages: [["u", "again"]],
        user_activity_timestamps: [],
      },
    ];

    const threadMetadata = new Map<string, ThreadMetadata>([
      ["s1", { id: "s1", rollout_path: "s1.jsonl", cwd: "/project-a", title: "Thread 1", first_user_message: "hello", created_at_ms: 0, updated_at_ms: 0, git_branch: null, git_sha: null, git_origin_url: null, source: "cli", model: null, archived: 0 }],
      ["s2", { id: "s2", rollout_path: "s2.jsonl", cwd: "/project-a", title: "Thread 2", first_user_message: "again", created_at_ms: 0, updated_at_ms: 0, git_branch: null, git_sha: null, git_origin_url: null, source: "cli", model: null, archived: 0 }],
    ]);

    const grouped = groupSessionsByProject(sessions, threadMetadata);

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
            session: {
              thread_id: "s1",
              source_file: "s1.jsonl",
              cwd: "/test/project",
              timezone: "UTC",
              context: [["u", "old context"] as MessageTuple],
              messages: [
                ["u", "hello"] as MessageTuple,
                ["a", "hi there"] as MessageTuple,
              ],
              user_activity_timestamps: [],
            },
            metadata: {
              id: "s1",
              rollout_path: "s1.jsonl",
              cwd: "/test/project",
              title: "My Thread",
              first_user_message: "hello",
              created_at_ms: 0,
              updated_at_ms: 0,
              git_branch: "feature-x",
              git_sha: null,
              git_origin_url: null,
              source: "cli",
              model: null,
              archived: 0,
            },
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
