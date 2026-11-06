import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readCredential } from "../core/credentials.js";
import { notConnected } from "../core/errors.js";
import { createServer, handler, text } from "../core/mcp.js";
import { OnTrackClient, type OnTrackCredentials } from "./client.js";

interface OnTrackStored extends OnTrackCredentials {
  savedAt?: string;
}

export async function loadOnTrackClient(): Promise<OnTrackClient> {
  const stored = await readCredential<OnTrackStored>("ontrack");
  const baseUrl = process.env.ONTRACK_BASE_URL ?? stored?.baseUrl ?? "https://ontrack.infotech.monash.edu/api";
  const username = process.env.ONTRACK_USERNAME ?? stored?.username;
  const refreshToken = process.env.ONTRACK_REFRESH_TOKEN ?? stored?.refreshToken;
  if (!username || !refreshToken) throw notConnected("ontrack");
  return new OnTrackClient({ baseUrl, username, refreshToken });
}

const INSTRUCTIONS =
  "Read-only OnTrack (Doubtfire) access for Monash FIT units. Start with ontrack_list_projects, then ontrack_list_tasks for due dates and submission state. Comments are tutor feedback and often contain the grade rationale.";

export function createOnTrackServer() {
  const server = createServer("awesome-monash-ontrack", INSTRUCTIONS);
  registerOnTrackTools(server);
  return server;
}

export function registerOnTrackTools(server: McpServer) {
  let client: Promise<OnTrackClient> | null = null;

  function ontrack(): Promise<OnTrackClient> {
    if (!client) {
      client = loadOnTrackClient().catch((error: unknown) => {
        client = null;
        throw error;
      });
    }
    return client;
  }

  server.registerTool(
    "ontrack_whoami",
    {
      title: "Show the connected OnTrack account",
      description: "Return the student account behind the saved OnTrack refresh token.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await ontrack()).whoami())),
  );

  server.registerTool(
    "ontrack_list_projects",
    {
      title: "List OnTrack units",
      description: "List the units OnTrack exposes for this account, with project ids for the task tools.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await ontrack()).listProjects())),
  );

  server.registerTool(
    "ontrack_list_tasks",
    {
      title: "List OnTrack tasks",
      description: "List the tasks of one unit with status, weighting and due dates.",
      inputSchema: z.object({ projectId: z.number().int().positive() }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ projectId }) => {
      const api = await ontrack();
      const tasks = await api.listTasks(projectId);
      return text(
        tasks.map((task) => ({
          ...task,
          url: api.taskUrl(projectId, task.taskDefinitionId),
        })),
      );
    }),
  );

  server.registerTool(
    "ontrack_task_comments",
    {
      title: "Read OnTrack task comments",
      description: "Read tutor comments and feedback for one task.",
      inputSchema: z.object({
        projectId: z.number().int().positive(),
        taskDefinitionId: z.number().int().positive(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ projectId, taskDefinitionId }) =>
      text(await (await ontrack()).listComments(projectId, taskDefinitionId)),
    ),
  );

  server.registerTool(
    "ontrack_download",
    {
      title: "Download an OnTrack artifact",
      description: "Save a task sheet, resource or submission PDF to the local config folder and return its path.",
      inputSchema: z.object({
        path: z.string().min(1).describe("API path such as /projects/123/task_def_id/456/task_pdf"),
        filename: z.string().max(120).optional(),
      }),
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    handler(async ({ path, filename }) => text(await (await ontrack()).downloadToFile(path, filename))),
  );
}
