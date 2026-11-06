import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deleteCredential, readCredential, writeCredential } from "./credentials.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "amt-credentials-"));
  process.env.AMT_CONFIG_DIR = dir;
});

afterEach(async () => {
  delete process.env.AMT_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("credential store", () => {
  it("round-trips one source without touching the others", async () => {
    await writeCredential("ed", { token: "abc", region: "au" });
    await writeCredential("moodle", { cookie: "MoodleSession=1" });

    expect(await readCredential<{ token: string }>("ed")).toEqual({ token: "abc", region: "au" });
    expect(await readCredential<{ cookie: string }>("moodle")).toEqual({ cookie: "MoodleSession=1" });
    expect(await readCredential("gmail")).toBeNull();
  });

  it("deletes a single source", async () => {
    await writeCredential("ed", { token: "abc" });
    await deleteCredential("ed");
    expect(await readCredential("ed")).toBeNull();
  });

  it("writes the file with owner-only permissions", async () => {
    await writeCredential("ed", { token: "abc" });
    if (process.platform === "win32") return;
    const mode = (await stat(join(dir, "credentials.json"))).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("treats a corrupt file as empty instead of crashing", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(dir, "credentials.json"), "{not json", { mode: 0o600 });
    expect(await readCredential("ed")).toBeNull();
    await writeCredential("gmail", { access_token: "x" });
    expect(await readCredential<{ access_token: string }>("gmail")).toEqual({ access_token: "x" });
  });
});
