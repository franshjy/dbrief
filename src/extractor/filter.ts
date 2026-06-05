import type { ParsedSession, ThreadMetadata } from "./parser.js";

export interface DayBoundaries {
  start: Date;
  end: Date;
}

export function getDayBoundaries(date: string, timezone: string): DayBoundaries {
  const dateStr = resolveDateStr(date);

  const start = localToUTC(`${dateStr}T00:00:00`, timezone);
  const end = localToUTC(`${dateStr}T23:59:59.999`, timezone);

  return { start, end };
}

function resolveDateStr(date: string): string {
  return parseDate(date);
}

function localToUTC(localStr: string, timezone: string): Date {
  const naive = new Date(localStr + "Z");
  const ms = naive.getMilliseconds();

  const naiveNoMs = new Date(naive.getTime() - ms);

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const tzParts = formatter.formatToParts(naiveNoMs);
  const get = (type: string) => tzParts.find((p) => p.type === type)!.value;

  let hour = parseInt(get("hour"), 10);
  if (hour === 24) hour = 0;

  const tzAsUTC = new Date(
    Date.UTC(
      parseInt(get("year"), 10),
      parseInt(get("month"), 10) - 1,
      parseInt(get("day"), 10),
      hour,
      parseInt(get("minute"), 10),
      parseInt(get("second"), 10)
    )
  );

  const offsetMs = tzAsUTC.getTime() - naiveNoMs.getTime();
  return new Date(naiveNoMs.getTime() - offsetMs + ms);
}

export function filterSessionsByActivity(
  sessions: ParsedSession[],
  threadMetadata: Map<string, ThreadMetadata>,
  start: Date,
  end: Date
): ParsedSession[] {
  return sessions.filter((s) => {
    if (!threadMetadata.has(s.thread_id)) return false;
    return s.user_activity_timestamps.some((timestamp) => {
      return timestamp >= start.getTime() && timestamp <= end.getTime();
    });
  });
}

export function parseDate(dateStr: string): string {
  if (dateStr === "today" || dateStr === "yesterday") {
    const d = new Date();
    if (dateStr === "yesterday") {
      d.setDate(d.getDate() - 1);
    }
    return formatDate(d);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    if (!isValidIsoCalendarDate(dateStr)) {
      throw new Error(
        `Invalid date value: "${dateStr}". Use a real calendar date in YYYY-MM-DD format.`
      );
    }
    return dateStr;
  }

  throw new Error(
    `Invalid date format: "${dateStr}". Use "today", "yesterday", or "YYYY-MM-DD".`
  );
}

export function getDateRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const current = new Date(fromDate + "T00:00:00");
  const end = new Date(toDate + "T00:00:00");

  while (current <= end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

export function timestampToDate(ms: number, timezone: string): string {
  const d = new Date(ms);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidIsoCalendarDate(dateStr: string): boolean {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);

  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day;
}
