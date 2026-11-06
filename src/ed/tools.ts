import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readCredential } from "../core/credentials.js";
import { notConnected } from "../core/errors.js";
import { createServer, handler, text } from "../core/mcp.js";
import { EdClient, isEdRegion, type EdRegion } from "./client.js";

interface EdStored {
  token?: string;
  region?: string;
}

function regionFrom(value: unknown): EdRegion | null {
  return isEdRegion(value) ? value : null;
}

export async function loadEdClient(): Promise<EdClient> {
  const stored = await readCredential<EdStored>("ed");
  const token = process.env.ED_API_TOKEN ?? stored?.token;
  if (!token) throw notConnected("ed");
  const region = regionFrom(process.env.ED_REGION) ?? regionFrom(stored?.region) ?? "au";
  return new EdClient({ token, region });
}

const courseSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe("Ed course: numeric id from ed_list_courses, or a code such as FIT1045");

const INSTRUCTIONS =
  "Read-only Ed Discussion access for Monash students. Start with ed_list_courses, then ed_list_threads or ed_search_threads. Never assume the token is shared between users.";

export function createEdServer() {
  const server = createServer("awesome-monash-ed", INSTRUCTIONS);
  registerEdTools(server);
  return server;
}

export function registerEdTools(server: McpServer) {
  let client: Promise<EdClient> | null = null;

  function ed(): Promise<EdClient> {
    if (!client) {
      client = loadEdClient().catch((error: unknown) => {
        client = null;
        throw error;
      });
    }
    return client;
  }

  server.registerTool(
    "ed_whoami",
    {
      title: "Show the connected Ed account",
      description: "Return the Ed account behind the saved token and the courses it can see.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await ed()).whoami())),
  );

  server.registerTool(
    "ed_list_courses",
    {
      title: "List Ed courses",
      description: "List every Ed course the token is enrolled in, with ids usable by the other tools.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await ed()).listCourses())),
  );

  server.registerTool(
    "ed_list_threads",
    {
      title: "List Ed discussion threads",
      description: "List threads of one course, newest first by default.",
      inputSchema: z.object({
        course: courseSchema,
        limit: z.number().int().min(1).max(100).default(30),
        offset: z.number().int().min(0).default(0),
        sort: z.enum(["new", "top", "unanswered"]).default("new"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ course, limit, offset, sort }) => {
      const api = await ed();
      const resolved = await api.resolveCourse(course);
      return text(
        await api.listThreads(resolved.id, {
          limit,
          offset,
          sort: sort === "top" ? "top" : sort === "unanswered" ? "unanswered" : "new",
        }),
      );
    }),
  );

  server.registerTool(
    "ed_search_threads",
    {
      title: "Search Ed threads",
      description: "Search thread titles and bodies across one course or every active course.",
      inputSchema: z.object({
        query: z.string().min(1).max(200),
        course: courseSchema.optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ query, course, limit }) => {
      const api = await ed();
      const courseId = course === undefined ? undefined : (await api.resolveCourse(course)).id;
      return text(await api.searchThreads(query, { courseId, limit }));
    }),
  );

  server.registerTool(
    "ed_get_thread",
    {
      title: "Read an Ed thread",
      description: "Read one thread in full, including nested replies and staff answers.",
      inputSchema: z.object({ threadId: z.number().int().positive() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ threadId }) => text(await (await ed()).getThread(threadId))),
  );

  server.registerTool(
    "ed_list_lessons",
    {
      title: "List Ed lessons",
      description: "List the lesson modules of a course (week 1, week 2, ...).",
      inputSchema: z.object({ course: courseSchema }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ course }) => {
      const api = await ed();
      const resolved = await api.resolveCourse(course);
      return text(await api.listLessons(resolved.id));
    }),
  );

  server.registerTool(
    "ed_get_lesson",
    {
      title: "Read an Ed lesson",
      description: "Read every slide of a lesson as text plus downloadable files and video URLs.",
      inputSchema: z.object({ lessonId: z.number().int().positive() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ lessonId }) => text(await (await ed()).getLesson(lessonId))),
  );
}
