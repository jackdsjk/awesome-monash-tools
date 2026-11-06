import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readCredential } from "../core/credentials.js";
import { notConnected } from "../core/errors.js";
import { createServer, handler, text } from "../core/mcp.js";
import { MoodleClient } from "./client.js";

interface MoodleStored {
  baseUrl?: string;
  cookie?: string;
  savedAt?: string;
}

export async function loadMoodleClient(): Promise<MoodleClient> {
  const stored = await readCredential<MoodleStored>("moodle");
  const baseUrl = process.env.MOODLE_BASE_URL ?? stored?.baseUrl ?? "https://learning.monash.edu";
  const cookie = process.env.MOODLE_COOKIE ?? stored?.cookie;
  if (!cookie) throw notConnected("moodle");
  return new MoodleClient({ baseUrl, cookie });
}

const INSTRUCTIONS =
  "Read-only Monash Moodle access. Start with moodle_list_courses, then moodle_deadlines for due dates and moodle_course_content for materials. Sessions expire after a few hours; ask the user to run `npx awesome-monash-tools login moodle` when a tool reports an expired session.";

export function createMoodleServer() {
  const server = createServer("awesome-monash-moodle", INSTRUCTIONS);
  registerMoodleTools(server);
  return server;
}

export function registerMoodleTools(server: McpServer) {
  let client: Promise<MoodleClient> | null = null;

  function moodle(): Promise<MoodleClient> {
    if (!client) {
      client = loadMoodleClient().catch((error: unknown) => {
        client = null;
        throw error;
      });
    }
    return client;
  }

  server.registerTool(
    "moodle_whoami",
    {
      title: "Check the Moodle session",
      description: "Probe the saved Moodle cookie and show which site it reaches.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => {
      const api = await moodle();
      const probe = await api.probeSession();
      return text({
        connected: probe.ok,
        baseUrl: process.env.MOODLE_BASE_URL ?? undefined,
        status: probe.status,
        hint: probe.ok ? undefined : "Run `npx awesome-monash-tools login moodle` to refresh the session.",
      });
    }),
  );

  server.registerTool(
    "moodle_list_courses",
    {
      title: "List Moodle courses",
      description: "List enrolled Monash Moodle courses with the ids used by the other tools.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await moodle()).listCourses())),
  );

  server.registerTool(
    "moodle_deadlines",
    {
      title: "List Moodle deadlines",
      description: "List assessment due dates nearest first. Optionally check whether each one was already submitted.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(180).default(30).describe("How far ahead to look"),
        fromDaysAgo: z.number().int().min(0).max(180).default(0).describe("Include items that were due up to N days ago"),
        checkSubmitted: z
          .boolean()
          .default(false)
          .describe("Fetch each activity page to report submitted/graded. Slower, one request per item."),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ days, fromDaysAgo, checkSubmitted }) =>
      text(await (await moodle()).deadlines({ days, fromDaysAgo, checkSubmitted })),
    ),
  );

  server.registerTool(
    "moodle_course_content",
    {
      title: "Read Moodle course materials",
      description: "List the sections and activities of one course, including label text and file links.",
      inputSchema: z.object({
        courseId: z.number().int().positive(),
        section: z.number().int().min(0).optional().describe("Only this section number"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ courseId, section }) => text(await (await moodle()).courseContent(courseId, { section }))),
  );

  server.registerTool(
    "moodle_submission_status",
    {
      title: "Check one submission status",
      description: "Read the submission status of a Moodle assignment from its activity URL.",
      inputSchema: z.object({ url: z.string().url() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ url }) => {
      const status = await (await moodle()).submissionStatus(url);
      return text({ url, status });
    }),
  );
}
