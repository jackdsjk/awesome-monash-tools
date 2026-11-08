import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { courseCode, matchesSession, normalizeSession, sessionLabel } from "./client.js";
import { loadAttendanceClient } from "./tools.js";

describe("attendance label parsing", () => {
  it("extracts a unit code from a portal row", () => {
    expect(courseCode("FIT1045 S2 2026 - Workshop 3")).toBe("FIT1045");
    expect(courseCode("workshop 3")).toBeNull();
  });

  it("normalises session labels", () => {
    expect(sessionLabel("Workshop 03 at 10:00 AM")).toBe("Workshop 3");
    expect(sessionLabel("tutorial 12")).toBe("Tutorial 12");
    expect(sessionLabel("Laboratory 4")).toBe("Lab 4");
    expect(sessionLabel("no session here")).toBeNull();
  });

  it("matches a row only when both unit and session agree", () => {
    expect(matchesSession("FIT1045 Workshop 03", "fit1045", "workshop 3")).toBe(true);
    expect(matchesSession("FIT1045 Workshop 3", "FIT1045", "Tutorial 3")).toBe(false);
    expect(matchesSession("FIT1058 Workshop 3", "FIT1045", "Workshop 3")).toBe(false);
    expect(matchesSession("FIT1045 Workshop 3", "FIT1045", "Workshop 4")).toBe(false);
  });

  it("treats zero-padded and unpadded numbers as the same session", () => {
    expect(normalizeSession("Workshop 03")).toBe(normalizeSession("workshop 3"));
    expect(normalizeSession("Lab 09")).toBe(normalizeSession("laboratory 9"));
  });
});

describe("attendance client loading", () => {
  it("asks the user to log in when no attendance cookies are saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amt-attendance-"));
    process.env.AMT_CONFIG_DIR = dir;
    try {
      await expect(loadAttendanceClient()).rejects.toMatchObject({
        hint: expect.stringContaining("login attendance"),
      });
    } finally {
      delete process.env.AMT_CONFIG_DIR;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
