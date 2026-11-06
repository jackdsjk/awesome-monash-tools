import { describe, expect, it, vi } from "vitest";
import { MoodleClient } from "./client.js";

const BASE = "https://learning.monash.edu";
const DASHBOARD = `<html><script>M.cfg = {"sesskey":"abc123"};</script><body>Dashboard</body></html>`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

const events = {
  events: [
    {
      id: 2,
      name: "Quiz 2",
      modulename: "quiz",
      timesort: 1_767_398_400,
      course: { id: 10, shortname: "FIT1045" },
      url: `${BASE}/mod/quiz/view.php?id=2`,
      purpose: "assessment",
    },
    {
      id: 1,
      name: "Assignment 1",
      modulename: "assign",
      timesort: 1_767_312_000,
      course: { id: 10, shortname: "FIT1045" },
      url: `${BASE}/mod/assign/view.php?id=1`,
      purpose: "assessment",
    },
    { id: 9, name: "Not an assessment", modulename: "forum", timesort: 1_767_398_400, course: {} },
  ],
};

function fakeFetch(handlers: { dashboard?: () => Response; post?: (body: unknown) => Response; page?: (url: string) => Response }) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/my/")) return handlers.dashboard?.() ?? html(DASHBOARD);
    if (url.includes("/lib/ajax/service.php")) {
      const body = init?.body ? JSON.parse(String(init.body)) : [];
      return handlers.post?.(body) ?? json([{ error: false, data: {} }]);
    }
    if (handlers.page) return handlers.page(url);
    return html("<html></html>");
  });
}

describe("MoodleClient", () => {
  it("lists courses from the AJAX endpoint", async () => {
    const fetcher = fakeFetch({
      post: () => json([{ error: false, data: { courses: [{ id: 10, shortname: "FIT1045", fullname: "Algorithms" }] } }]),
    });
    const courses = await new MoodleClient({ baseUrl: BASE, cookie: "MoodleSession=1", fetcher }).listCourses();
    expect(courses).toEqual([{ id: 10, shortname: "FIT1045", fullname: "Algorithms" }]);
  });

  it("maps and sorts assessment deadlines", async () => {
    const fetcher = fakeFetch({
      post: (body) => {
        const calls = body as Array<{ methodname: string }>;
        expect(calls[0].methodname).toBe("core_calendar_get_action_events_by_timesort");
        return json([{ error: false, data: events }]);
      },
    });

    const deadlines = await new MoodleClient({ baseUrl: BASE, cookie: "MoodleSession=1", fetcher }).deadlines({ days: 30 });
    expect(deadlines.map((deadline) => deadline.title)).toEqual(["Assignment 1", "Quiz 2"]);
    expect(deadlines[0]).toMatchObject({ id: 1, courseId: 10, course: "FIT1045", module: "assign", submitted: null });
    expect(deadlines[0].dueAt).toBe(new Date(1_767_312_000_000).toISOString());
  });

  it("reads the submission status table", async () => {
    const fetcher = fakeFetch({
      page: () =>
        html(
          `<table><tr><th>Submission status</th><td>Submitted for grading</td></tr></table>`,
        ),
    });
    const status = await new MoodleClient({ baseUrl: BASE, cookie: "MoodleSession=1", fetcher }).submissionStatus(
      `${BASE}/mod/assign/view.php?id=1`,
    );
    expect(status).toBe("submitted");
  });

  it("refuses to fetch a URL outside the Moodle origin", async () => {
    const client = new MoodleClient({ baseUrl: BASE, cookie: "MoodleSession=1", fetcher: fakeFetch({}) });
    await expect(client.submissionStatus("https://evil.example/steal")).rejects.toThrow(/outside this Moodle site/);
  });

  it("scrapes section activities from a course page", async () => {
    const coursePage = `
      <html><body>
        <h1>FIT1045</h1>
        <a href="/course/view.php?id=10&amp;section=0" title="Week 1">Week 1</a>
        <a href="/course/view.php?id=10&amp;section=1" title="Week 2">Week 2</a>
      </body></html>`;
    const sectionOne = `
      <html><body>
        <li class="activity resource modtype_resource">
          <a href="/mod/resource/view.php?id=5">Lecture 1 File</a>
        </li>
        <li class="activity label modtype_label">
          <span>Read this first</span>
          <a href="/mod/resource/view.php?id=6">Reading</a>
        </li>
      </body></html>`;
    const fetcher = fakeFetch({
      page: (url) => {
        if (url.includes("section=1")) return html("<html><body></body></html>");
        if (url.includes("section=0")) return html(sectionOne);
        return html(coursePage);
      },
    });

    const content = await new MoodleClient({ baseUrl: BASE, cookie: "MoodleSession=1", fetcher }).courseContent(10);
    expect(content.course).toBe("FIT1045");
    expect(content.sections.map((section) => section.number)).toEqual([0, 1]);
    const titles = content.sections[0].items.map((item) => item.title);
    expect(titles).toContain("Lecture 1");
    expect(titles).toContain("Reading");
    expect(content.sections[0].items[0].url).toBe(`${BASE}/mod/resource/view.php?id=5`);
  });

  it("reports a rejected session when the dashboard does not load", async () => {
    const fetcher = fakeFetch({ dashboard: () => html("Login required", 403) });
    const client = new MoodleClient({ baseUrl: BASE, cookie: "MoodleSession=stale", fetcher });
    await expect(client.requireSession()).rejects.toMatchObject({
      status: 403,
      hint: expect.stringContaining("login moodle"),
    });
  });
});
