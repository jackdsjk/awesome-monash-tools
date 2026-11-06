#!/usr/bin/env node
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { profileDir } from "./core/config.js";
import { deleteCredential, readCredential, writeCredential } from "./core/credentials.js";
import { AmtError, sourceLabel } from "./core/errors.js";
import { VERSION } from "./core/mcp.js";
import { EdClient, isEdRegion } from "./ed/client.js";
import { GmailClient } from "./gmail/client.js";
import { loopbackLogin } from "./gmail/oauth.js";
import { MoodleClient } from "./moodle/client.js";
import { OnTrackClient } from "./ontrack/client.js";

const SOURCES = ["ed", "moodle", "gmail", "ontrack"] as const;
type Source = (typeof SOURCES)[number];

const HELP = `
awesome-monash-tools v${VERSION}

Usage:
  awesome-monash login <ed|moodle|gmail|ontrack>   Connect one source
  awesome-monash logout <source|all>               Forget saved credentials
  awesome-monash status [--json]                   Show what is connected
  awesome-monash serve <ed|moodle|gmail|ontrack|all>  Run an MCP server on stdio

Login options:
  --token <token>            Ed API token (default: $ED_API_TOKEN)
  --region <au|us|eu>        Ed region (default: au)
  --base-url <url>           Moodle or OnTrack base URL
  --client-id <id>           Google OAuth client id (default: $GOOGLE_CLIENT_ID)
  --client-secret <secret>   Google OAuth client secret (default: $GOOGLE_CLIENT_SECRET)
  --port <port>              Gmail loopback port (default: 48125)

Credentials live in ~/.config/awesome-monash-tools/credentials.json (mode 0600).
`.trim();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message: string, hint?: string): never {
  throw new AmtError(message, { hint });
}

function describe(error: unknown): string {
  if (error instanceof AmtError) {
    return [error.message, error.detail ? `Details: ${error.detail}` : "", error.hint ?? ""].filter(Boolean).join("\n");
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      token: { type: "string" },
      region: { type: "string" },
      cookie: { type: "string" },
      "base-url": { type: "string" },
      "client-id": { type: "string" },
      "client-secret": { type: "string" },
      port: { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
      version: { type: "boolean", default: false },
    },
  });

  if (values.version) {
    console.log(VERSION);
    return;
  }
  const [command, argument] = positionals;
  if (values.help || !command || command === "help") {
    console.log(HELP);
    return;
  }

  switch (command) {
    case "login":
      await login(argument, values);
      return;
    case "logout":
      await logout(argument);
      return;
    case "status":
      await status(values.json === true);
      return;
    case "serve":
      await serve(argument ?? "all");
      return;
    default:
      fail(`Unknown command "${command}".`, "Run `awesome-monash help`.");
  }
}

async function serve(target: string): Promise<void> {
  if (target === "all") {
    await import("./all.js");
    return;
  }
  if (!isSource(target)) fail(`Unknown source "${target}".`, "Use ed, moodle, gmail, ontrack or all.");
  await import(`./${target}/server.js`);
}

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

async function login(source: string | undefined, values: LoginValues): Promise<void> {
  if (!source || !isSource(source)) fail("Choose a source to log in to.", "Example: awesome-monash login ed");
  switch (source) {
    case "ed":
      return loginEd(values);
    case "moodle":
      return loginMoodle(values);
    case "gmail":
      return loginGmail(values);
    case "ontrack":
      return loginOnTrack(values);
  }
}

async function loginEd(values: LoginValues): Promise<void> {
  const token = values.token ?? process.env.ED_API_TOKEN ?? (await promptHidden("Ed API token (create one at https://edstem.org/settings/api-tokens): "));
  if (!token) fail("No Ed token provided.");

  const regionValue = values.region ?? process.env.ED_REGION ?? "au";
  if (!isEdRegion(regionValue)) fail(`Unknown Ed region "${regionValue}".`, "Use au, us or eu.");

  const identity = await new EdClient({ token, region: regionValue }).whoami();
  await writeCredential("ed", {
    token,
    region: regionValue,
    userId: identity.id,
    name: identity.name,
    email: identity.email,
    savedAt: new Date().toISOString(),
  });
  console.log(`Ed connected: ${identity.name || identity.email || "unknown"} (${identity.courses.length} courses, region ${regionValue}).`);
}

async function loginMoodle(values: LoginValues): Promise<void> {
  const baseUrl = (values["base-url"] ?? "https://learning.monash.edu").replace(/\/+$/, "");
  const browser = await launchChrome(profileDir("moodle"));
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto(`${baseUrl}/my/`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
    console.log("Finish the Monash SSO login in the Chrome window; this command saves the cookie jar automatically.");

    const deadline = Date.now() + 5 * 60_000;
    let last = "no MoodleSession cookie yet";
    while (Date.now() < deadline) {
      const jar = await browser
        .cookies(baseUrl)
        .then((cookies) => cookies.filter((cookie) => cookie.domain.replace(/^\./, "").endsWith("monash.edu") && cookie.value))
        .catch(() => []);
      const hasSession = jar.some((cookie) => cookie.name === "MoodleSession");
      if (hasSession) {
        const cookie = jar.map((entry) => `${entry.name}=${entry.value}`).join("; ");
        const probe = await new MoodleClient({ baseUrl, cookie }).probeSession().catch(() => null);
        if (probe?.ok) {
          await writeCredential("moodle", { baseUrl, cookie, savedAt: new Date().toISOString() });
          console.log(`Moodle connected: ${jar.length} cookies saved for ${baseUrl}.`);
          return;
        }
        last = probe ? `dashboard returned HTTP ${probe.status}` : "dashboard is not reachable with the saved cookies";
      }
      if (browser.pages().length === 0) break;
      await sleep(1_500);
    }
    fail("Moodle login timed out.", `Last check: ${last}. Open the dashboard in the browser, wait until it loads, then run the login again.`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function loginGmail(values: LoginValues): Promise<void> {
  const clientId = values["client-id"] ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = values["client-secret"] ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    fail("Google OAuth is not configured.", [
      "Create an OAuth client in Google Cloud, enable the Gmail API, and add this redirect URI:",
      `  http://127.0.0.1:${values.port ?? "48125"}/oauth/google/callback`,
      "Then pass --client-id / --client-secret, or export GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.",
    ].join("\n"));
  }

  const port = Number(values.port ?? "48125");
  const redirectUri = `http://127.0.0.1:${port}/oauth/google/callback`;
  const tokens = await loopbackLogin({ clientId, clientSecret, redirectUri }, { openBrowser });
  const profile = await new GmailClient(tokens.access_token).profile();
  await writeCredential("gmail", {
    ...tokens,
    client_id: clientId,
    client_secret: clientSecret,
    email: profile.emailAddress,
    savedAt: new Date().toISOString(),
  });
  console.log(`Gmail connected: ${profile.emailAddress} (${profile.messagesTotal} messages).`);
}

async function loginOnTrack(values: LoginValues): Promise<void> {
  const origin = (values["base-url"] ?? "https://ontrack.infotech.monash.edu").replace(/\/+$/, "");
  const apiBase = `${origin}/api`;
  const browser = await launchChrome(profileDir("ontrack"));
  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
    console.log("Finish the Monash SSO login in the Chrome window; the refresh cookie is saved automatically.");

    const deadline = Date.now() + 5 * 60_000;
    let last = "no refresh_token cookie yet";
    while (Date.now() < deadline) {
      const cookies = await browser.cookies(origin).catch(() => []);
      const refresh = cookies.find((cookie) => cookie.name === "refresh_token");
      const user = cookies.find((cookie) => cookie.name === "username");
      if (refresh?.value && user?.value) {
        const client = new OnTrackClient({ baseUrl: apiBase, username: user.value, refreshToken: refresh.value });
        const probe = await client.listProjects().then(
          () => ({ ok: true, message: "" }),
          (error: unknown) => ({ ok: false, message: describe(error) }),
        );
        if (probe.ok) {
          await writeCredential("ontrack", {
            baseUrl: apiBase,
            username: user.value,
            refreshToken: refresh.value,
            savedAt: new Date().toISOString(),
          });
          console.log(`OnTrack connected: ${user.value}.`);
          return;
        }
        last = probe.message;
      }
      if (browser.pages().length === 0) break;
      await sleep(1_500);
    }
    fail("OnTrack login timed out.", `Last check: ${last}. Wait until the task list loads, then run the login again.`);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function logout(source: string | undefined): Promise<void> {
  if (!source) fail("Choose a source to log out of.", "Example: awesome-monash logout ed");
  const targets = source === "all" ? [...SOURCES] : isSource(source) ? [source] : [];
  if (targets.length === 0) fail(`Unknown source "${source}".`);

  for (const target of targets) {
    await deleteCredential(target);
    if (target === "moodle" || target === "ontrack") {
      await rm(profileDir(target), { recursive: true, force: true }).catch(() => undefined);
    }
    console.log(`${sourceLabel(target)} signed out.`);
  }
}

async function status(json: boolean): Promise<void> {
  const rows = await Promise.all(SOURCES.map(async (source) => probeSource(source)));
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const width = Math.max(...rows.map((row) => sourceLabel(row.source).length));
  for (const row of rows) {
    const state = row.connected ? "connected" : "not connected";
    const detail = row.connected ? row.summary : "run: awesome-monash login " + row.source;
    console.log(`${sourceLabel(row.source).padEnd(width)}  ${state.padEnd(13)}  ${detail}`);
  }
}

async function probeSource(source: Source): Promise<{ source: Source; connected: boolean; summary: string }> {
  try {
    switch (source) {
      case "ed": {
        const stored = await readCredential<{ token?: string; region?: string }>("ed");
        const token = process.env.ED_API_TOKEN ?? stored?.token;
        if (!token) return { source, connected: false, summary: "" };
        const region = isEdRegion(process.env.ED_REGION) ? process.env.ED_REGION : isEdRegion(stored?.region) ? stored.region : "au";
        const identity = await new EdClient({ token, region }).whoami();
        return { source, connected: true, summary: `${identity.name || identity.email} · ${identity.courses.length} courses` };
      }
      case "moodle": {
        const stored = await readCredential<{ baseUrl?: string; cookie?: string }>("moodle");
        const cookie = process.env.MOODLE_COOKIE ?? stored?.cookie;
        if (!cookie) return { source, connected: false, summary: "" };
        const baseUrl = process.env.MOODLE_BASE_URL ?? stored?.baseUrl ?? "https://learning.monash.edu";
        const probe = await new MoodleClient({ baseUrl, cookie }).probeSession();
        return { source, connected: probe.ok, summary: probe.ok ? baseUrl : "session expired" };
      }
      case "gmail": {
        const stored = await readCredential<{ access_token?: string; expires_at?: number; email?: string; refresh_token?: string }>("gmail");
        if (!stored?.access_token && !stored?.refresh_token) return { source, connected: false, summary: "" };
        if (stored.email && stored.expires_at && stored.expires_at > Date.now() + 60_000) {
          return { source, connected: true, summary: stored.email };
        }
        return { source, connected: true, summary: stored.email ?? "token saved (refresh on first use)" };
      }
      case "ontrack": {
        const stored = await readCredential<{ baseUrl?: string; username?: string; refreshToken?: string }>("ontrack");
        const username = process.env.ONTRACK_USERNAME ?? stored?.username;
        const refreshToken = process.env.ONTRACK_REFRESH_TOKEN ?? stored?.refreshToken;
        if (!username || !refreshToken) return { source, connected: false, summary: "" };
        const baseUrl = process.env.ONTRACK_BASE_URL ?? stored?.baseUrl ?? "https://ontrack.infotech.monash.edu/api";
        const account = await new OnTrackClient({ baseUrl, username, refreshToken }).whoami();
        return { source, connected: true, summary: `${account.username} (id ${account.userId})` };
      }
    }
  } catch (error) {
    return { source, connected: false, summary: describe(error).split("\n")[0] };
  }
}

interface LoginValues {
  token?: string;
  region?: string;
  cookie?: string;
  "base-url"?: string;
  "client-id"?: string;
  "client-secret"?: string;
  port?: string;
}

interface BrowserContextLike {
  pages(): Array<{ goto(url: string, options?: Record<string, unknown>): Promise<unknown> }>;
  newPage(): Promise<{ goto(url: string, options?: Record<string, unknown>): Promise<unknown> }>;
  cookies(url?: string): Promise<Array<{ name: string; value: string; domain: string; expires: number }>>;
  close(): Promise<void>;
}

async function launchChrome(profile: string): Promise<BrowserContextLike> {
  const { chromium } = await import("playwright-core");
  const options = {
    channel: "chrome",
    headless: process.env.AMT_HEADLESS === "1",
    viewport: { width: 1180, height: 820 },
  };

  try {
    return (await chromium.launchPersistentContext(profile, options)) as unknown as BrowserContextLike;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ProcessSingleton|SingletonLock|profile.*in use/i.test(message)) {
      for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        await rm(join(profile, name), { force: true }).catch(() => undefined);
      }
      return (await chromium.launchPersistentContext(profile, options)) as unknown as BrowserContextLike;
    }
    throw new AmtError("Could not open Chrome for the login.", {
      detail: message,
      hint: "Install Google Chrome, or set AMT_HEADLESS=1 on a machine without a desktop.",
    });
  }
}

async function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    fail("No token provided.", "Pass --token <token> or set ED_API_TOKEN when running without a terminal.");
  }
  process.stdout.write(question);
  return new Promise<string>((resolve, reject) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value.trim());
          return;
        }
        if (char === "\u0003") {
          cleanup();
          reject(new AmtError("Cancelled."));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (char >= " ") {
          value += char;
          process.stdout.write("*");
        }
      }
    };

    stdin.on("data", onData);
  });
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await new Promise<void>((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => resolve());
    child.unref();
    resolve();
  });
}

await main().catch((error: unknown) => {
  console.error(describe(error));
  process.exit(1);
});

export {};
