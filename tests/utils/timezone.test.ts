import { describe, it, expect } from "vitest";
import { getSystemTimezone } from "../../src/utils/timezone";

describe("getSystemTimezone", () => {
  it("returns a valid timezone string", () => {
    const tz = getSystemTimezone();
    expect(tz).toBeDefined();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });

  it("returns a timezone containing a slash (e.g. Region/City)", () => {
    const tz = getSystemTimezone();
    expect(tz).toMatch(/\w+\/\w+/);
  });
});
