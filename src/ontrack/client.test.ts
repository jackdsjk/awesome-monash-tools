import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnTrackClient } from "./client.js";

const API = "https://ontrack.infotech.monash.edu/api";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(routes: Array<[string, () => Response]>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [needle, make] of routes) if (url.includes(needle)) return make();
    return json({ error: "unexpected" }, 404);
  });
}

const minted = {
  auth_token: "tok-1",
  auth_token_expiry: new Date(Date.now() + 5 * 60_000).toISOString(),
  user: { id: 7, username: "student1", first_name: "Ada", last_name: "Lovelace", email: "ada@student.monash.edu" },
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "amt-ontrack-"));
  process.env.AMT_CONFIG_DIR = dir;
});

afterEach(async () => {
  delete process.env.AMT_CONFIG_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("OnTrackClient", () => {
  it("mints an access token from the refresh cookie and lists projects", async () => {
    const fetcher = fakeFetch([
      ["/auth/access-token", () => json(minted)],
      [
        "/projects",
        () =>
          json([
            { id: 42, unit: { id: 2, code: "FIT1045", name: "Algorithms" } },
            { id: 43 },
          ]),
      ],
    ]);

    const client = new OnTrackClient({ baseUrl: API, username: "student1", refreshToken: "r1" }, fetcher);
    const projects = await client.listProjects();

    expect(projects).toEqual([{ id: 42, unitId: 2, unitCode: "FIT1045", unitName: "Algorithms" }]);
    const call = (fetcher.mock.calls[1] ?? []) as unknown as [string, RequestInit];
    expect(new Headers(call[1]?.headers).get("Auth-Token")).toBe("tok-1");
    expect(new Headers(call[1]?.headers).get("Username")).toBe("student1");
  });

  it("joins tasks with their unit task definitions", async () => {
    const fetcher = fakeFetch([
      ["/auth/access-token", () => json(minted)],
      [
        "/projects/42",
        () =>
          json({
            unit_id: 2,
            tasks: [{ id: 100, task_definition_id: 5, status: "ready_for_feedback", due_date: "2026-03-01T00:00:00Z", times_assessed: 1 }],
          }),
      ],
      [
        "/units/2",
        () =>
          json({
            task_definitions: [{ id: 5, abbreviation: "P1", name: "Portfolio 1", description: "Build a thing", weighting: 20 }],
          }),
      ],
    ]);

    const tasks = await new OnTrackClient({ baseUrl: API, username: "student1", refreshToken: "r1" }, fetcher).listTasks(42);
    expect(tasks[0]).toMatchObject({
      id: 100,
      taskDefinitionId: 5,
      abbreviation: "P1",
      name: "Portfolio 1",
      status: "ready_for_feedback",
      dueDate: "2026-03-01",
      weighting: 20,
    });
  });

  it("maps tutor comments", async () => {
    const fetcher = fakeFetch([
      ["/auth/access-token", () => json(minted)],
      [
        "/projects/42/task_def_id/5/comments",
        () => json([{ id: 1, type: "comment", comment: "Good work", created_at: "2026-03-02T00:00:00Z", author: { id: 3, first_name: "Tutor", last_name: "One" } }]),
      ],
    ]);

    const comments = await new OnTrackClient({ baseUrl: API, username: "student1", refreshToken: "r1" }, fetcher).listComments(42, 5);
    expect(comments).toEqual([
      { id: "1", type: "comment", comment: "Good work", createdAt: "2026-03-02T00:00:00Z", authorId: 3, authorName: "Tutor One" },
    ]);
  });

  it("saves a downloaded artifact under the config directory", async () => {
    const fetcher = fakeFetch([
      ["/auth/access-token", () => json(minted)],
      [
        "/projects/42/task_def_id/5/task_pdf",
        () => new Response(Buffer.from("%PDF-1.4"), { status: 200, headers: { "content-type": "application/pdf" } }),
      ],
    ]);

    const client = new OnTrackClient({ baseUrl: API, username: "student1", refreshToken: "r1" }, fetcher);
    const saved = await client.downloadToFile("/projects/42/task_def_id/5/task_pdf", "task.pdf");
    expect(saved.bytes).toBe(8);
    expect(await readFile(saved.path, "utf8")).toBe("%PDF-1.4");
  });

  it("rejects an expired refresh cookie with a login hint", async () => {
    const fetcher = fakeFetch([["/auth/access-token", () => json({ error: "expired" }, 419)]]);
    const client = new OnTrackClient({ baseUrl: API, username: "student1", refreshToken: "stale" }, fetcher);
    await expect(client.listProjects()).rejects.toMatchObject({ hint: expect.stringContaining("login ontrack") });
  });
});
