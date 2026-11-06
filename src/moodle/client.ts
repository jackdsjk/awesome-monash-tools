import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import { AmtError, sessionRejected } from "../core/errors.js";
import { request } from "../core/http.js";
import { compact, decodeEntities } from "../core/text.js";

const COURSES_METHOD = "core_course_get_enrolled_courses_by_timeline_classification";
const TIMELINE_METHOD = "core_calendar_get_action_events_by_timesort";
const ASSESSMENT_MODULES = new Set(["assign", "choice", "lesson", "quiz", "workshop"]);

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface MoodleCourse {
  id: number;
  shortname: string;
  fullname: string;
}

export interface MoodleDeadline {
  id: number;
  title: string;
  courseId: number;
  course: string;
  module: string;
  dueAt: string;
  url: string;
  submitted: boolean | null;
}

export interface MoodleSectionItem {
  module: string;
  title: string;
  url: string;
  text: string;
  campus: "malaysia" | "australia" | "indonesia" | "shared";
  images: string[];
}

export interface MoodleSection {
  number: number;
  title: string;
  items: MoodleSectionItem[];
}

export interface MoodleCourseContent {
  courseId: number;
  course: string;
  sections: MoodleSection[];
}

export interface MoodleClientOptions {
  baseUrl: string;
  cookie: string;
  fetcher?: typeof fetch;
}

interface MoodleEvent {
  id?: number;
  name?: string;
  modname?: string;
  modulename?: string;
  purpose?: string;
  activityname?: string;
  timesort?: number;
  timestart?: number;
  url?: string;
  course?: { id?: number; shortname?: string; fullname?: string };
  action?: { name?: string; url?: string };
}

export class MoodleClient {
  private readonly baseUrl: string;
  private readonly cookie: string;
  private readonly fetcher: typeof fetch;
  private sesskey: string | null = null;

  constructor(options: MoodleClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.cookie = options.cookie;
    this.fetcher = options.fetcher ?? fetch;
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      cookie: this.cookie,
      "user-agent": BROWSER_UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...extra,
    };
  }

  /**
   * Follows redirects and rejects anything that lands off-site or on a login
   * page, so an SSO bounce can never be mistaken for a valid session.
   */
  async probeSession(): Promise<{ ok: boolean; status: number; url: string }> {
    const response = await this.fetcher(`${this.baseUrl}/my/`, {
      headers: this.headers(),
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const url = response.url ?? "";
    const offSite = url !== "" && !url.startsWith(this.baseUrl);
    const loginPage = /\/login\//.test(url) || /okta\.com|microsoftonline\.com|idp/i.test(url);
    return { ok: response.ok && !offSite && !loginPage, status: response.status, url };
  }

  async requireSession(): Promise<void> {
    const probe = await this.probeSession().catch(() => ({ ok: false, status: 0, url: "" }));
    if (probe.ok) return;
    if (probe.status === 401 || probe.status === 403) throw sessionRejected("moodle", probe.status);
    throw new AmtError("Moodle did not accept the saved session.", {
      hint: "Run `npx awesome-monash-tools login moodle` and complete the Monash SSO login.",
      status: probe.status || undefined,
    });
  }

  private async getSesskey(): Promise<string> {
    if (this.sesskey) return this.sesskey;
    const response = await request(`${this.baseUrl}/my/`, { headers: this.headers(), redirect: "manual" }, this.fetcher);
    if (!response.ok) {
      throw sessionRejected("moodle", response.status, "The Moodle dashboard did not load.");
    }
    const html = await response.text();
    const match = /"sesskey"\s*:\s*"([^"]+)"/.exec(html) ?? /name=["']sesskey["'][^>]*value=["']([^"']+)["']/i.exec(html);
    if (!match?.[1]) throw new AmtError("Moodle dashboard did not contain a sesskey.", { hint: "Log in again from a browser to refresh the session." });
    this.sesskey = match[1];
    return this.sesskey;
  }

  private async ajax<T>(calls: Array<{ methodname: string; args: Record<string, unknown> }>): Promise<T[]> {
    const sesskey = await this.getSesskey();
    const url = new URL("/lib/ajax/service.php", this.baseUrl);
    url.searchParams.set("sesskey", sesskey);
    url.searchParams.set("info", calls.map((call) => call.methodname).join(","));

    const response = await request(url, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json" }),
      body: JSON.stringify(calls.map((call, index) => ({ index, ...call }))),
      timeoutMs: 25_000,
    }, this.fetcher);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw sessionRejected("moodle", response.status);
      throw new AmtError(`Moodle AJAX returned HTTP ${response.status}.`);
    }

    const envelope = (await response.json()) as Array<{ error?: boolean; data?: T; exception?: { message?: string } }>;
    if (!Array.isArray(envelope)) throw new AmtError("Moodle AJAX returned an invalid response.");
    const failed = envelope.find((entry) => entry.error);
    if (failed) {
      throw new AmtError(failed.exception?.message ?? "Moodle rejected the request.", {
        hint: "This Monash site may have the web service disabled.",
      });
    }
    return envelope.map((entry) => entry.data as T);
  }

  async listCourses(): Promise<MoodleCourse[]> {
    const [data] = await this.ajax<{ courses?: Array<Record<string, unknown>> }>([
      {
        methodname: COURSES_METHOD,
        args: { classification: "all", limit: 100, offset: 0, sort: "fullname" },
      },
    ]);
    return (data?.courses ?? []).map((course) => ({
      id: Number(course.id),
      shortname: String(course.shortname ?? ""),
      fullname: String(course.fullname ?? ""),
    }));
  }

  async deadlines(options: { days?: number; fromDaysAgo?: number; checkSubmitted?: boolean } = {}): Promise<MoodleDeadline[]> {
    const now = Math.floor(Date.now() / 1000);
    const from = now - Math.max(options.fromDaysAgo ?? 0, 0) * 86_400;
    const [data] = await this.ajax<{ events?: MoodleEvent[] }>([
      {
        methodname: TIMELINE_METHOD,
        args: {
          limitnum: 100,
          timesortfrom: from,
          timesortto: now + Math.max(options.days ?? 30, 1) * 86_400,
          aftereventid: 0,
          limittononsuspendedevents: true,
        },
      },
    ]);

    const deadlines = (data?.events ?? [])
      .filter((event) => event.purpose === "assessment" || ASSESSMENT_MODULES.has(event.modulename ?? event.modname ?? ""))
      .map((event) => mapAssessment(event))
      .filter((item): item is MoodleDeadline => item !== null);

    if (options.checkSubmitted) {
      await Promise.all(
        deadlines.map(async (item) => {
          item.submitted = await this.submissionStatus(item.url).then(
            (status) => status === "submitted" || status === "graded",
            () => null,
          );
        }),
      );
    }

    return deadlines.sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  }

  async submissionStatus(url: string): Promise<"submitted" | "graded" | "none" | "unknown"> {
    if (!url.startsWith(this.baseUrl)) {
      throw new AmtError("Refusing to check a URL outside this Moodle site.", { hint: "Pass the url returned by moodle_deadlines." });
    }
    const response = await request(url, { headers: this.headers(), redirect: "follow", timeoutMs: 15_000 }, this.fetcher).catch(() => null);
    if (!response?.ok) return "unknown";
    const root = parse(await response.text());
    // Moodle renders the table as <tr><th>Submission status</th><td>…</td></tr>;
    // the label is a th, so the value is every remaining cell in that row.
    const value = root
      .querySelectorAll("tr")
      .map((row) => row.querySelectorAll("th, td"))
      .filter((cells) => cells.length > 1 && compact(cells[0].text).toLowerCase() === "submission status")
      .map((cells) => cells.slice(1).map((cell) => cell.text).join(" "))
      .join(" ");
    const normalized = compact(value).toLowerCase();
    if (!normalized) return "unknown";
    if (/no submissions?/.test(normalized) || /nothing submitted/.test(normalized)) return "none";
    if (/graded/.test(normalized)) return "graded";
    if (/submitted/.test(normalized)) return "submitted";
    return "none";
  }

  /** Scrape one course page section by section. Moodle lazy-loads sections, so each one is fetched. */
  async courseContent(courseId: number, options: { section?: number } = {}): Promise<MoodleCourseContent> {
    const coursePage = await this.html(`/course/view.php?id=${courseId}`);
    const courseName = compact(coursePage.querySelector("h1")?.text ?? "") || `Course ${courseId}`;
    const sections = this.sectionLinks(coursePage.toString(), courseId).filter(
      ([number]) => options.section === undefined || number === options.section,
    );

    const rows: MoodleSection[] = [];
    for (const [number, title] of sections) {
      const page = await this.html(`/course/view.php?id=${courseId}&section=${number}`);
      rows.push({ number, title, items: this.sectionItems(page, courseId, number) });
    }
    return { courseId, course: courseName, sections: rows };
  }

  private async html(path: string) {
    const response = await request(`${this.baseUrl}${path}`, { headers: this.headers(), redirect: "follow" }, this.fetcher);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw sessionRejected("moodle", response.status);
      throw new AmtError(`Moodle page returned HTTP ${response.status}.`);
    }
    return parse(await response.text());
  }

  private sectionLinks(html: string, courseId: number): Array<[number, string]> {
    const root = parse(html);
    const sections = new Map<number, string>();
    for (const anchor of root.querySelectorAll("a[href*='course/view.php']")) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      const url = new URL(href, this.baseUrl);
      if (url.searchParams.get("id") !== String(courseId)) continue;
      const section = Number(url.searchParams.get("section"));
      const title = decodeEntities(compact(anchor.getAttribute("title") ?? anchor.text));
      if (Number.isFinite(section) && title && !sections.has(section)) sections.set(section, title);
    }
    return [...sections.entries()].sort(([a], [b]) => a - b);
  }

  private sectionItems(root: ReturnType<typeof parse>, courseId: number, sectionNumber: number): MoodleSectionItem[] {
    const items: MoodleSectionItem[] = [];
    const seen = new Set<string>();

    const push = (item: MoodleSectionItem) => {
      const key = `${item.module}:${item.url}:${item.title}`;
      if (seen.has(key) || !item.title) return;
      seen.add(key);
      items.push(item);
    };

    for (const activity of root.querySelectorAll("li.activity")) {
      const module = /modtype_(\w+)/.exec(activity.getAttribute("class") ?? "")?.[1] ?? "";
      if (!module || module === "cms") continue;

      const link = activity.querySelector("a[href*='/mod/']") ?? activity.querySelector("a[href]");
      const rawTitle = compact(link?.text ?? activity.querySelector(".activityname")?.text ?? activity.text);
      if (!rawTitle) continue;

      const cleanText = compact(activity.text).replace(/^Select activity\s+/i, "");
      const title =
        module === "label"
          ? cleanText.slice(0, 100)
          : rawTitle.replace(/\s+(File|URL|Folder|Page|External tool|Assignment|Quiz|Forum|Label|Book)$/i, "").trim();
      const href = link?.getAttribute("href");
      const url = href
        ? new URL(href, this.baseUrl).toString()
        : `${this.baseUrl}/course/view.php?id=${courseId}&section=${sectionNumber}`;
      const text = module === "label" ? cleanText.slice(0, 2_000) : "";
      const images =
        module === "label"
          ? [...activity.querySelectorAll("img")]
              .map((image) => image.getAttribute("src"))
              .filter((src): src is string => typeof src === "string" && src.includes("pluginfile.php"))
              .map((src) => new URL(src, this.baseUrl).toString())
              .filter((src, index, all) => all.indexOf(src) === index)
          : [];

      push({
        module,
        title: title || rawTitle,
        url,
        text,
        campus: detectCampus(`${title} ${text}`),
        images,
      });

      if (module !== "label") continue;
      for (const nested of activity.querySelectorAll("a[href]")) {
        const nestedHref = nested.getAttribute("href");
        if (!nestedHref || !/\/mod\/(resource|folder|url)\//.test(nestedHref)) continue;
        const nestedTitle = compact(nested.text);
        if (!nestedTitle) continue;
        push({
          module: /\/mod\/(resource|folder|url)\//.exec(nestedHref)?.[1] ?? "resource",
          title: nestedTitle,
          url: new URL(nestedHref, this.baseUrl).toString(),
          text: "",
          campus: detectCampus(`${nestedTitle} ${nested.text}`),
          images: [],
        });
      }
    }

    return items;
  }
}

function mapAssessment(event: MoodleEvent): MoodleDeadline | null {
  const id = Number(event.id);
  const due = Number(event.timesort || event.timestart);
  if (!id || !due) return null;
  return {
    id,
    title: event.name ?? event.activityname ?? `Assessment ${id}`,
    courseId: Number(event.course?.id ?? 0),
    course: event.course?.shortname ?? event.course?.fullname ?? "",
    module: event.modulename ?? event.modname ?? "assessment",
    dueAt: new Date(due * 1_000).toISOString(),
    url: event.url ?? event.action?.url ?? "",
    submitted: null,
  };
}

function detectCampus(value: string): MoodleSectionItem["campus"] {
  if (/\[?Malaysia Campus|\bMUM\b|\bMalaysia\b/i.test(value)) return "malaysia";
  if (/\bIndonesia\b|\bID\b/.test(value)) return "indonesia";
  if (/\bClayton\b|\bAustralia\b|Caulfield|Peninsula/i.test(value)) return "australia";
  return "shared";
}

export function courseHash(...parts: string[]): string {
  return createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 12);
}
