import { parse } from "node-html-parser";
import { AmtError, sessionRejected } from "../core/errors.js";
import { compact, excerpt, htmlToText } from "../core/text.js";

export type EdRegion = "au" | "us" | "eu";

const REGIONS: readonly EdRegion[] = ["au", "us", "eu"];

export function isEdRegion(value: unknown): value is EdRegion {
  return typeof value === "string" && (REGIONS as readonly string[]).includes(value);
}

export type EdRole = "staff" | "student" | "unknown";

export interface EdCourse {
  id: number;
  code: string;
  name: string;
  status: string;
  role: string;
}

export interface EdThreadSummary {
  id: number;
  number: number;
  courseId: number;
  courseCode: string;
  title: string;
  excerpt: string;
  authorName: string;
  authorRole: EdRole;
  createdAt: string;
  replyCount: number;
  viewCount: number;
  isAnswered: boolean;
  isPinned: boolean;
  url: string;
}

export interface EdReply {
  id: number;
  authorName: string;
  authorRole: EdRole;
  text: string;
  createdAt: string;
  depth: number;
  endorsed: boolean;
}

export interface EdThreadDetail {
  id: number;
  number: number;
  courseId: number;
  courseCode: string;
  title: string;
  authorName: string;
  authorRole: EdRole;
  text: string;
  createdAt: string;
  isAnswered: boolean;
  replies: EdReply[];
  url: string;
}

export interface EdLesson {
  id: number;
  title: string;
  slideCount: number;
  url: string;
}

export interface EdMaterialFile {
  name: string;
  url: string;
  kind: "slides" | "pdf" | "file";
}

export interface EdSlide {
  id: number;
  title: string;
  type: "video" | "text" | "slides" | "quiz" | "file";
  url: string;
  text: string;
  markdown: string;
  videoUrls: string[];
  files: EdMaterialFile[];
}

export interface EdLessonDetail {
  id: number;
  courseId: number;
  title: string;
  slides: EdSlide[];
}

export interface EdClientOptions {
  token: string;
  region?: EdRegion;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

interface EdUser {
  id?: number;
  name?: string;
  email?: string;
  role?: string;
  course_role?: string;
}

interface EdThreadRecord {
  id?: number;
  course_id?: number;
  number?: number;
  title?: string;
  document?: string;
  content?: string;
  created_at?: string;
  user_id?: number;
  user?: EdUser;
  is_answered?: boolean;
  is_pinned?: boolean;
  reply_count?: number;
  view_count?: number;
}

interface EdCommentRecord {
  id?: number;
  user_id?: number;
  document?: string;
  content?: string;
  created_at?: string;
  is_endorsed?: boolean;
  comments?: EdCommentRecord[];
}

interface EdIdentity {
  user?: EdUser;
  courses?: Array<{ course?: { id?: number; name?: string; code?: string; status?: string }; role?: { role?: string } }>;
}

interface EdThreadList {
  threads?: EdThreadRecord[];
  users?: EdUser[];
}

interface EdThreadDetailResponse {
  thread?: EdThreadRecord & { answers?: EdCommentRecord[]; comments?: EdCommentRecord[] };
  users?: EdUser[];
}

export class EdClient {
  private readonly baseUrl: string;
  private readonly region: EdRegion;
  private readonly token: string;
  private readonly fetcher: typeof fetch;
  private readonly users = new Map<number, EdUser>();

  constructor(options: EdClientOptions) {
    this.token = options.token.replace(/^Bearer\s+/i, "").trim();
    this.region = options.region ?? "au";
    this.baseUrl = (options.baseUrl ?? "https://edstem.org/api/").replace(/\/*$/, "/");
    this.fetcher = options.fetcher ?? fetch;
  }

  get siteUrl(): string {
    return `https://edstem.org/${this.region}`;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.fetcher(url, {
      headers: { accept: "application/json", authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      throw new AmtError(`Could not reach Ed (${baseHost(this.baseUrl)}).`, {
        detail: error instanceof Error ? error.message : String(error),
        hint: "Check your network, then retry. Ed is usually reachable from anywhere.",
      });
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const message = jsonMessage(body) ?? body.slice(0, 400);
      if (response.status === 401 || response.status === 403 || (response.status === 400 && /token/i.test(body))) {
        throw sessionRejected("ed", response.status, message || "The Ed API token was rejected.");
      }
      throw new AmtError(`Ed returned HTTP ${response.status}.`, {
        status: response.status,
        detail: message || undefined,
      });
    }
    return (await response.json()) as T;
  }

  private remember(users?: EdUser[]) {
    for (const user of users ?? []) {
      if (typeof user.id === "number") this.users.set(user.id, user);
    }
  }

  private userOf(id?: number): EdUser | null {
    if (typeof id !== "number") return null;
    return this.users.get(id) ?? null;
  }

  private roleOf(user: EdUser | null | undefined): EdRole {
    const role = `${user?.course_role ?? ""} ${user?.role ?? ""}`.toLowerCase();
    if (/staff|admin|tutor|teacher|instructor|lecturer/.test(role)) return "staff";
    if (/student|learner/.test(role)) return "student";
    return "unknown";
  }

  async whoami(): Promise<{ id: number; name: string; email: string; courses: EdCourse[] }> {
    const identity = await this.get<EdIdentity>("user");
    return {
      id: Number(identity.user?.id ?? 0),
      name: identity.user?.name ?? "",
      email: identity.user?.email ?? "",
      courses: mapCourses(identity),
    };
  }

  async listCourses(): Promise<EdCourse[]> {
    return mapCourses(await this.get<EdIdentity>("user"));
  }

  /** Accepts a numeric id, a course code like `FIT1045`, or a name fragment. */
  async resolveCourse(value: string | number): Promise<EdCourse> {
    const courses = await this.listCourses();
    if (typeof value === "number") {
      const found = courses.find((course) => course.id === value);
      if (found) return found;
      throw new AmtError(`No Ed course with id ${value}.`, { hint: "Call ed_list_courses to see the available ids." });
    }

    const needle = value.trim().toLowerCase();
    if (/^\d+$/.test(needle)) {
      const byId = courses.find((course) => course.id === Number(needle));
      if (byId) return byId;
    }
    const exact = courses.filter(
      (course) => course.code.toLowerCase() === needle || course.name.toLowerCase() === needle,
    );
    if (exact.length === 1) return exact[0];

    const partial = courses.filter(
      (course) => course.code.toLowerCase().includes(needle) || course.name.toLowerCase().includes(needle),
    );
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      throw new AmtError(`"${value}" matches ${partial.length} Ed courses.`, {
        detail: partial.map((course) => `${course.code} (id ${course.id})`).join(", "),
        hint: "Pass the numeric courseId from ed_list_courses instead.",
      });
    }
    throw new AmtError(`No Ed course matches "${value}".`, { hint: "Call ed_list_courses to see the available courses." });
  }

  async listThreads(
    courseId: number,
    options: { limit?: number; offset?: number; sort?: "new" | "top" | "unanswered" } = {},
  ): Promise<EdThreadSummary[]> {
    const course = await this.courseCode(courseId);
    const data = await this.get<EdThreadList>(`courses/${courseId}/threads`, {
      limit: String(Math.min(Math.max(options.limit ?? 30, 1), 100)),
      offset: String(Math.max(options.offset ?? 0, 0)),
      sort: options.sort ?? "new",
    });
    this.remember(data.users);
    return (data.threads ?? []).map((thread) => this.summarize(thread, courseId, course));
  }

  private async courseCode(courseId: number): Promise<string> {
    try {
      const courses = await this.listCourses();
      return courses.find((course) => course.id === courseId)?.code ?? `course ${courseId}`;
    } catch {
      return `course ${courseId}`;
    }
  }

  async searchThreads(
    query: string,
    options: { courseId?: number; limit?: number } = {},
  ): Promise<EdThreadSummary[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    const courses = options.courseId
      ? [await this.resolveCourse(options.courseId)]
      : (await this.listCourses()).filter((course) => course.status !== "archived");
    const perCourse = options.courseId ? Math.max(options.limit ?? 30, 10) : 30;

    const groups = await Promise.all(
      courses.map(async (course) => {
        const threads = await this.listThreads(course.id, { limit: perCourse }).catch(() => []);
        return threads.filter((thread) =>
          `${thread.title} ${thread.excerpt}`.toLowerCase().includes(needle),
        );
      }),
    );

    return groups.flat().slice(0, Math.max(options.limit ?? 30, 1));
  }

  async getThread(threadId: number): Promise<EdThreadDetail> {
    const data = await this.get<EdThreadDetailResponse>(`threads/${threadId}`);
    this.remember(data.users);
    const thread = data.thread;
    if (!thread) throw new AmtError(`Ed thread ${threadId} was not found.`);

    const author = this.userOf(thread.user_id) ?? thread.user ?? null;
    const courseId = Number(thread.course_id ?? 0);
    const courseCode = courseId ? await this.courseCode(courseId) : "";
    const replies: EdReply[] = [];

    const add = (comment: EdCommentRecord, depth: number) => {
      const body = comment.document ?? comment.content ?? "";
      const text = body.includes("<") ? htmlToText(body) : compact(body);
      if (text) {
        const user = this.userOf(comment.user_id);
        replies.push({
          id: Number(comment.id ?? 0),
          authorName: user?.name ?? (Number(comment.user_id) === 0 ? "Anonymous" : "Unknown"),
          authorRole: this.roleOf(user),
          text,
          createdAt: comment.created_at ?? "",
          depth,
          endorsed: Boolean(comment.is_endorsed),
        });
      }
      for (const nested of comment.comments ?? []) add(nested, depth + 1);
    };

    for (const answer of thread.answers ?? []) add(answer, 0);
    for (const comment of thread.comments ?? []) add(comment, 0);

    return {
      id: Number(thread.id ?? threadId),
      number: Number(thread.number ?? 0),
      courseId,
      courseCode,
      title: thread.title ?? "",
      authorName: author?.name ?? (thread.user_id ? "Unknown" : "Anonymous"),
      authorRole: thread.user_id ? this.roleOf(author) : "student",
      text: thread.document ? htmlToText(thread.document) : thread.content ? htmlToText(thread.content) : "",
      createdAt: thread.created_at ?? "",
      isAnswered: Boolean(thread.is_answered),
      replies,
      url: this.threadUrl(courseId, Number(thread.number ?? thread.id ?? threadId)),
    };
  }

  async listLessons(courseId: number): Promise<EdLesson[]> {
    const data = await this.get<{ lessons?: Array<{ id?: number; title?: string; slide_count?: number }> }>(
      `courses/${courseId}/lessons`,
    );
    return (data.lessons ?? [])
      .filter((lesson): lesson is { id: number; title?: string; slide_count?: number } => Number.isFinite(Number(lesson.id)))
      .map((lesson) => ({
        id: Number(lesson.id),
        title: lesson.title ?? `Lesson ${lesson.id}`,
        slideCount: Number(lesson.slide_count ?? 0),
        url: `${this.siteUrl}/courses/${courseId}/lessons/${lesson.id}`,
      }));
  }

  async getLesson(lessonId: number): Promise<EdLessonDetail> {
    const data = await this.get<{
      lesson?: {
        id?: number;
        course_id?: number;
        title?: string;
        slides?: Array<{ id?: number; title?: string; type?: string; content?: string; document?: string }>;
      };
    }>(`lessons/${lessonId}`);
    const lesson = data.lesson;
    if (!lesson?.id) throw new AmtError(`Ed lesson ${lessonId} was not found.`);

    const courseId = Number(lesson.course_id ?? 0);
    const slides = (lesson.slides ?? [])
      .filter((slide): slide is { id: number; title?: string; type?: string; content?: string; document?: string } =>
        Number.isFinite(Number(slide.id)),
      )
      .map((slide) => this.mapSlide(slide, Number(lesson.id), courseId));

    return { id: Number(lesson.id), courseId, title: lesson.title ?? `Lesson ${lesson.id}`, slides };
  }

  private mapSlide(
    slide: { id: number; title?: string; type?: string; content?: string; document?: string },
    lessonId: number,
    courseId: number,
  ): EdSlide {
    const raw = slide.content ?? slide.document ?? "";
    const root = raw.includes("<") ? parse(raw) : null;

    const videoUrls = root
      ? [...root.querySelectorAll("video")]
          .map((node) => node.getAttribute("src") ?? "")
          .filter(Boolean)
      : [];

    const files: EdMaterialFile[] = root
      ? [...root.querySelectorAll("file")]
          .map((node) => {
            const url = node.getAttribute("url") ?? "";
            const name = node.getAttribute("filename") ?? url.split("/").pop() ?? "file";
            const kind: EdMaterialFile["kind"] = /\.pptx?$/i.test(name)
              ? "slides"
              : /\.pdf$/i.test(name)
                ? "pdf"
                : "file";
            return { name, url, kind };
          })
          .filter((file) => Boolean(file.url))
      : [];

    const paragraphs = root
      ? root
          .querySelectorAll("paragraph")
          .map((node) => compact(node.text))
          .filter(Boolean)
      : [];

    const text = (paragraphs.length > 0 ? paragraphs.join("\n\n") : compact(root ? root.text : raw)).trim();

    const type: EdSlide["type"] =
      videoUrls.length > 0
        ? "video"
        : files.some((file) => file.kind === "slides")
          ? "slides"
          : files.length > 0
            ? "file"
            : slide.type === "quiz" || !text
              ? "quiz"
              : "text";

    const fileLines = files.map((file) => `- [${file.name}](${file.url})`).join("\n");
    const markdown = `# ${slide.title ?? "Ed material"}\n\n${text}${fileLines ? `\n\n## Files\n${fileLines}` : ""}`.trim();

    return {
      id: Number(slide.id),
      title: slide.title ?? `Slide ${slide.id}`,
      type,
      url: `${this.siteUrl}/courses/${courseId}/lessons/${lessonId}/slides/${slide.id}`,
      text,
      markdown,
      videoUrls,
      files,
    };
  }

  private summarize(thread: EdThreadRecord, courseId: number, courseCode: string): EdThreadSummary {
    const id = Number(thread.id ?? 0);
    const number = Number(thread.number ?? id);
    const body = thread.document ?? thread.content ?? "";
    const author = this.userOf(thread.user_id) ?? thread.user ?? null;
    return {
      id,
      number,
      courseId,
      courseCode,
      title: thread.title ?? "",
      excerpt: excerpt(body.includes("<") ? htmlToText(body) : body, 240),
      authorName: author?.name ?? (thread.user_id ? "Unknown" : "Anonymous"),
      authorRole: thread.user_id ? this.roleOf(author) : "student",
      createdAt: thread.created_at ?? "",
      replyCount: Number(thread.reply_count ?? 0),
      viewCount: Number(thread.view_count ?? 0),
      isAnswered: Boolean(thread.is_answered),
      isPinned: Boolean(thread.is_pinned),
      url: this.threadUrl(courseId, number),
    };
  }

  private threadUrl(courseId: number, number: number): string {
    return `${this.siteUrl}/courses/${courseId}/discussion/${number}`;
  }
}

function mapCourses(identity: EdIdentity): EdCourse[] {
  return (identity.courses ?? [])
    .map((entry) => entry.course)
    .filter((course): course is { id: number; name?: string; code?: string; status?: string } => Boolean(course?.id))
    .map((course) => ({
      id: Number(course.id),
      code: course.code ?? course.name ?? String(course.id),
      name: course.name ?? course.code ?? String(course.id),
      status: course.status ?? "active",
      role: "",
    }));
}

function jsonMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: string };
    return typeof parsed.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}

function baseHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Server-side fetch of an Ed-hosted file (used by ed_download_file). */
export async function downloadEdFile(url: string, fetcher: typeof fetch = fetch): Promise<{ body: Buffer; contentType: string; name: string }> {
  const target = new URL(url);
  const allowed = target.protocol === "https:" && (target.hostname === "edusercontent.com" || target.hostname.endsWith(".edusercontent.com"));
  if (!allowed) {
    throw new AmtError("Only files hosted on edusercontent.com can be downloaded.", { hint: "Pass a file URL returned by ed_get_lesson." });
  }
  const response = await fetcher(target, { headers: { accept: "*/*" }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new AmtError(`Ed file download returned HTTP ${response.status}.`);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "application/octet-stream",
    name: decodeURIComponent(target.pathname.split("/").pop() ?? "file"),
  };
}
