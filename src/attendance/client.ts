import { chromium, type Browser, type Page } from "playwright-core";
import { AmtError, sessionRejected } from "../core/errors.js";

/** Monash Malaysia attendance portal. Override with `ATTENDANCE_BASE_URL` if your campus differs. */
export const DEFAULT_ATTENDANCE_BASE_URL = "https://attendance.monash.edu.my";

export interface AttendanceCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export interface AttendanceCredentials {
  baseUrl: string;
  cookies: AttendanceCookie[];
}

export interface AttendanceSession {
  course: string;
  session: string;
  days: string[];
}

export type CheckinStatus = "filled" | "submitted" | "inactive" | "not_found";

export interface CheckinResult {
  status: CheckinStatus;
  course: string;
  session: string;
  message: string;
  entryUrl?: string;
  pageText?: string;
}

const SESSION_WORDS =
  "workshop|tutorial|applied|pass|lab|laboratory|studio|seminar|lecture|practical";

/** `FIT1045 S2 2026` → `FIT1045`; returns null when the text has no unit code. */
export function courseCode(value: string): string | null {
  const match = new RegExp(`\\b([A-Z]{2,5}\\d{3,4})\\b`, "i").exec(value);
  return match ? match[1].toUpperCase() : null;
}

/** `Workshop 03` → `Workshop 3`; returns null when the text names no session. */
export function sessionLabel(value: string): string | null {
  const match = new RegExp(`\\b(${SESSION_WORDS})\\s*0?(\\d{1,2})\\b`, "i").exec(value);
  if (!match) return null;
  const word = match[1].toLowerCase();
  const label = word === "laboratory" ? "Lab" : word === "practical" ? "Prac" : `${word[0].toUpperCase()}${word.slice(1)}`;
  return `${label} ${Number(match[2])}`;
}

/** Stable comparison key for "Workshop 3" vs "workshop 03". */
export function normalizeSession(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(new RegExp(`\\b(${SESSION_WORDS})\\s*0?(\\d{1,2})\\b`, "g"), (_match, word: string, number: string) =>
      `${word === "laboratory" ? "lab" : word} ${Number(number)}`,
    );
}

/** True when one row mentions both the unit and the session we are looking for. */
export function matchesSession(text: string, course: string, session: string): boolean {
  const rowCourse = courseCode(text);
  const rowSession = sessionLabel(text);
  return rowCourse === course.toUpperCase() && rowSession !== null && normalizeSession(rowSession) === normalizeSession(session);
}

export class AttendanceClient {
  constructor(private readonly credentials: AttendanceCredentials) {}

  private get baseUrl(): string {
    return this.credentials.baseUrl.replace(/\/+$/, "");
  }

  /** Every call gets a fresh browser: the portal is a WebForms app and leaks state between pages. */
  private async withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ channel: "chrome", headless: true }).catch((error: unknown) => {
        throw new AmtError("Could not start Chrome for the attendance portal.", {
          detail: error instanceof Error ? error.message : String(error),
          hint: "Install Google Chrome. The attendance portal needs a real browser because its TLS chain is not in Node's CA store.",
        });
      });
      const context = await browser.newContext();
      await context.addCookies(this.credentials.cookies);
      const page = await context.newPage();
      return await fn(page);
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }

  async validate(): Promise<boolean> {
    return this.withPage(async (page) => {
      await page.goto(`${this.baseUrl}/student/Default.aspx`, { waitUntil: "domcontentloaded", timeout: 20_000 });
      const url = page.url();
      if (/okta\.com|microsoftonline\.com/i.test(url)) return false;
      const text = await page.locator("body").innerText().catch(() => "");
      return /attendance/i.test(text);
    });
  }

  async listSessions(): Promise<AttendanceSession[]> {
    return this.withPage(async (page) => {
      await this.goto(page, "/student/Units.aspx");
      const dates = await this.dayValues(page);
      const found = new Map<string, AttendanceSession>();

      for (const date of dates) {
        await page.selectOption("#daySel", date).catch(() => undefined);
        await page.waitForTimeout(60);
        const rows = page.locator(`#dayPanel_${date} li`);
        const count = await rows.count();
        for (let index = 0; index < count; index += 1) {
          const text = (await rows.nth(index).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
          const course = courseCode(text);
          const session = sessionLabel(text);
          if (!course || !session) continue;
          const key = `${course}:${session}`;
          const entry = found.get(key) ?? { course, session, days: [] };
          if (!entry.days.includes(date)) entry.days.push(date);
          found.set(key, entry);
        }
      }

      return [...found.values()];
    });
  }

  async checkin(
    candidate: { course: string; session: string; code: string },
    options: { submit?: boolean } = {},
  ): Promise<CheckinResult> {
    const course = candidate.course.toUpperCase();
    const session = sessionLabel(candidate.session) ?? candidate.session;
    const code = candidate.code.trim();

    return this.withPage(async (page) => {
      await this.goto(page, "/student/Units.aspx");

      // A direct Entry.aspx link only exists while a code window is open.
      const links = page.locator('a[href*="Entry.aspx"]');
      const linkCount = await links.count();
      for (let index = 0; index < linkCount; index += 1) {
        const link = links.nth(index);
        const label = (await link.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        if (!matchesSession(label, course, session)) continue;
        const href = await link.getAttribute("href");
        if (!href) continue;
        return this.openEntry(page, new URL(href, page.url()).toString(), { course, session, code }, options);
      }

      // Fallback: click the matching row in the read-only day summary.
      const dates = await this.dayValues(page);
      for (const date of dates) {
        await page.selectOption("#daySel", date).catch(() => undefined);
        await page.waitForTimeout(80);
        const rows = page.locator(`#dayPanel_${date} li`);
        const count = await rows.count();
        for (let index = 0; index < count; index += 1) {
          const row = rows.nth(index);
          const text = await row.innerText().catch(() => "");
          if (!matchesSession(text, course, session)) continue;
          await row.click().catch(() => undefined);
          await page.waitForTimeout(250);
          return this.fillInput(page, { course, session, code }, options);
        }
      }

      return {
        status: "not_found",
        course,
        session,
        message: `No active attendance entry for ${course} / ${session}. The code window may be closed.`,
      };
    });
  }

  private async openEntry(
    page: Page,
    entryUrl: string,
    candidate: { course: string; session: string; code: string },
    options: { submit?: boolean },
  ): Promise<CheckinResult> {
    await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    return this.fillInput(page, candidate, options, entryUrl);
  }

  private async fillInput(
    page: Page,
    candidate: { course: string; session: string; code: string },
    options: { submit?: boolean },
    entryUrl?: string,
  ): Promise<CheckinResult> {
    const input = page
      .locator('input[type="text"], input:not([type]), input[type="tel"], input[placeholder*="code" i], input[name*="code" i]')
      .first();

    if ((await input.count()) === 0) {
      return {
        status: "inactive",
        course: candidate.course,
        session: candidate.session,
        message: "Reached the entry page, but no attendance-code input is active right now.",
        entryUrl,
      };
    }

    await input.fill(candidate.code);

    if (!options.submit) {
      return {
        status: "filled",
        course: candidate.course,
        session: candidate.session,
        message: "Code filled in. Not submitted: call again with submit=true once you have confirmed the code.",
        entryUrl,
      };
    }

    const button = page
      .locator(
        'input[type="submit"], button[type="submit"], button:has-text("Submit"), input[value*="Submit" i], button:has-text("Save"), input[value*="Save" i], button:has-text("Enter")',
      )
      .first();
    if ((await button.count()) === 0) {
      return {
        status: "filled",
        course: candidate.course,
        session: candidate.session,
        message: "Code filled, but no submit control was found on the entry page.",
        entryUrl,
      };
    }

    await button.click().catch(async () => {
      await input.press("Enter").catch(() => undefined);
    });
    await page.waitForTimeout(800);
    const pageText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 400);

    return {
      status: "submitted",
      course: candidate.course,
      session: candidate.session,
      message: "Submitted the attendance code.",
      entryUrl,
      pageText,
    };
  }

  private async goto(page: Page, path: string): Promise<void> {
    const response = await page.goto(`${this.baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
    if (!response) {
      throw new AmtError("The attendance portal did not respond.", { hint: "Check your network, then retry." });
    }
    if (response.status() === 401 || response.status() === 403) throw sessionRejected("attendance", response.status());
    if (/okta\.com|microsoftonline\.com/i.test(page.url())) {
      throw sessionRejected("attendance", 401, "The portal redirected to Monash SSO.");
    }
  }

  private async dayValues(page: Page): Promise<string[]> {
    return page
      .locator("#daySel option")
      .evaluateAll((options) => options.map((option) => (option as unknown as { value: string }).value))
      .catch(() => []);
  }
}

export function toPlaywrightCookie(cookie: AttendanceCookie): AttendanceCookie {
  return { ...cookie, sameSite: cookie.sameSite === "None" ? "None" : cookie.sameSite === "Strict" ? "Strict" : "Lax" };
}
