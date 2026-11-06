import { describe, expect, it, vi } from "vitest";
import { EdClient } from "./client.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeFetch(routes: Array<[string, () => Response]>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [needle, make] of routes) {
      if (url.includes(needle)) return make();
    }
    return json({ error: "unexpected route" }, 404);
  });
}

const identity = {
  user: { id: 1, name: "Ada Lovelace", email: "ada@student.monash.edu" },
  courses: [
    { course: { id: 10, name: "Algorithms and Data Structures", code: "FIT1045", status: "active" } },
    { course: { id: 11, name: "Discrete Mathematics", code: "FIT1058", status: "archived" } },
  ],
};

describe("EdClient", () => {
  it("maps courses and the current user", async () => {
    const client = new EdClient({ token: "t", fetcher: fakeFetch([["/user", () => json(identity)]]) });
    await expect(client.whoami()).resolves.toEqual({
      id: 1,
      name: "Ada Lovelace",
      email: "ada@student.monash.edu",
      courses: [
        expect.objectContaining({ id: 10, code: "FIT1045" }),
        expect.objectContaining({ id: 11, code: "FIT1058" }),
      ],
    });
  });

  it("resolves a course by code or numeric id", async () => {
    const client = new EdClient({ token: "t", fetcher: fakeFetch([["/user", () => json(identity)]]) });
    await expect(client.resolveCourse("fit1045")).resolves.toMatchObject({ id: 10 });
    await expect(client.resolveCourse("10")).resolves.toMatchObject({ code: "FIT1045" });
    await expect(client.resolveCourse("nope")).rejects.toThrow(/No Ed course matches/);
  });

  it("summarises threads with author names and site URLs", async () => {
    const fetcher = fakeFetch([
      ["/user", () => json(identity)],
      [
        "/courses/10/threads",
        () =>
          json({
            threads: [
              {
                id: 5,
                number: 7,
                title: "Week 1 question",
                document: "<p>How does <b>merge sort</b> work?</p>",
                created_at: "2026-02-01T09:00:00Z",
                user_id: 2,
                is_answered: true,
                reply_count: 3,
              },
            ],
            users: [
              { id: 1, name: "Ada Lovelace", course_role: "staff" },
              { id: 2, name: "Bob Student", course_role: "student" },
            ],
          }),
      ],
    ]);

    const threads = await new EdClient({ token: "t", region: "au", fetcher }).listThreads(10, { limit: 10 });
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: 5,
      number: 7,
      courseId: 10,
      courseCode: "FIT1045",
      authorName: "Bob Student",
      authorRole: "student",
      isAnswered: true,
      replyCount: 3,
      url: "https://edstem.org/au/courses/10/discussion/7",
    });
    expect(threads[0].excerpt).toContain("merge sort");
  });

  it("flattens nested replies in thread detail", async () => {
    const fetcher = fakeFetch([
      ["/user", () => json(identity)],
      [
        "/threads/5",
        () =>
          json({
            thread: {
              id: 5,
              number: 7,
              course_id: 10,
              title: "Week 1 question",
              document: "<p>Question body</p>",
              created_at: "2026-02-01T09:00:00Z",
              user_id: 2,
              answers: [
                {
                  id: 9,
                  user_id: 1,
                  document: "<p>Top answer</p>",
                  created_at: "2026-02-01T10:00:00Z",
                  comments: [{ id: 10, user_id: 2, document: "<p>Follow-up</p>", created_at: "2026-02-01T11:00:00Z" }],
                },
              ],
              comments: [],
            },
            users: [
              { id: 1, name: "Ada Lovelace", course_role: "staff" },
              { id: 2, name: "Bob Student", course_role: "student" },
            ],
          }),
      ],
    ]);

    const thread = await new EdClient({ token: "t", fetcher }).getThread(5);
    expect(thread.text).toBe("Question body");
    expect(thread.replies.map((reply) => [reply.text, reply.depth, reply.authorRole])).toEqual([
      ["Top answer", 0, "staff"],
      ["Follow-up", 1, "student"],
    ]);
  });

  it("turns a rejected token into an actionable error", async () => {
    const client = new EdClient({ token: "bad", fetcher: fakeFetch([["/user", () => json({ error: "unauthorized" }, 401)]]) });
    await expect(client.listCourses()).rejects.toMatchObject({
      status: 401,
      hint: expect.stringContaining("login ed"),
    });
  });
});
