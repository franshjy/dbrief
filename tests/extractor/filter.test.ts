import { describe, it, expect } from "vitest";
import {
  getDayBoundaries,
  filterSessionsByActivity,
  parseDate,
  getDateRange,
  timestampToDate,
} from "../../src/extractor/filter";
import type { ParsedSession } from "../../src/sources/types";

describe("getDayBoundaries", () => {
  it("returns start and end dates for a given day", () => {
    const { start, end } = getDayBoundaries("2026-06-02", "UTC");

    expect(start.toISOString()).toContain("2026-06-02");
    expect(end.toISOString()).toContain("2026-06-02");
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("handles timezone offsets", () => {
    const utcBoundaries = getDayBoundaries("2026-06-02", "UTC");
    const bangkokBoundaries = getDayBoundaries("2026-06-02", "Asia/Bangkok");

    expect(utcBoundaries.start.getTime()).not.toBe(
      bangkokBoundaries.start.getTime()
    );
  });
});

describe("filterSessionsByActivity", () => {
  const sessions: ParsedSession[] = [
    {
      thread_id: "s1",
      source: "codex",
      source_file: "s1.jsonl",
      cwd: "/test",
      project_root: null,
      title: "Thread 1",
      branch: null,
      created_at_ms: new Date("2026-06-02T09:00:00.000Z").getTime(),
      updated_at_ms: new Date("2026-06-02T10:00:00.000Z").getTime(),
      archived: false,
      timezone: "UTC",
      context: [],
      messages: [["u", "hello"]],
      user_activity_timestamps: [new Date("2026-06-02T09:30:00.000Z").getTime()],
    },
    {
      thread_id: "s2",
      source: "codex",
      source_file: "s2.jsonl",
      cwd: "/test",
      project_root: null,
      title: "Thread 2",
      branch: null,
      created_at_ms: new Date("2026-06-05T09:00:00.000Z").getTime(),
      updated_at_ms: new Date("2026-06-05T10:00:00.000Z").getTime(),
      archived: false,
      timezone: "UTC",
      context: [],
      messages: [["u", "different day"]],
      user_activity_timestamps: [new Date("2026-06-05T09:30:00.000Z").getTime()],
    },
    {
      thread_id: "s3",
      source: "codex",
      source_file: "s3.jsonl",
      cwd: "/test",
      project_root: null,
      title: "Thread 3",
      branch: null,
      created_at_ms: new Date("2026-06-01T09:00:00.000Z").getTime(),
      updated_at_ms: new Date("2026-06-05T10:00:00.000Z").getTime(),
      archived: false,
      timezone: "UTC",
      context: [],
      messages: [["u", "resumed today"]],
      user_activity_timestamps: [new Date("2026-06-02T12:30:00.000Z").getTime()],
    },
  ];

  it("returns sessions whose user activity timestamps fall in the date range", () => {
    const start = new Date("2026-06-02T00:00:00.000Z");
    const end = new Date("2026-06-02T23:59:59.999Z");
    const filtered = filterSessionsByActivity(sessions, start, end);

    expect(filtered.map((s) => s.thread_id)).toEqual(["s1", "s3"]);
  });
});

describe("parseDate", () => {
  it("accepts YYYY-MM-DD format", () => {
    expect(parseDate("2026-06-02")).toBe("2026-06-02");
  });

  it("resolves today", () => {
    const result = parseDate("today");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("resolves yesterday", () => {
    const result = parseDate("yesterday");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("throws on invalid format", () => {
    expect(() => parseDate("not-a-date")).toThrow("Invalid date format");
  });

  it("throws on impossible calendar dates", () => {
    expect(() => parseDate("2026-02-31")).toThrow("Invalid date value");
  });
});

describe("getDateRange", () => {
  it("generates array of dates between two dates", () => {
    const dates = getDateRange("2026-05-01", "2026-05-03");
    expect(dates).toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
  });

  it("returns single date when from equals to", () => {
    const dates = getDateRange("2026-05-15", "2026-05-15");
    expect(dates).toEqual(["2026-05-15"]);
  });

  it("returns empty array when from is after to", () => {
    const dates = getDateRange("2026-05-15", "2026-05-01");
    expect(dates).toEqual([]);
  });
});

describe("timestampToDate", () => {
  it("converts ms timestamp to date string in UTC", () => {
    const d = new Date("2025-05-01T00:00:00Z");
    const date = timestampToDate(d.getTime(), "UTC");
    expect(date).toBe("2025-05-01");
  });
});
