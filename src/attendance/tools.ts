import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readCredential } from "../core/credentials.js";
import { notConnected } from "../core/errors.js";
import { createServer, handler, text } from "../core/mcp.js";
import { AttendanceClient, DEFAULT_ATTENDANCE_BASE_URL, type AttendanceCookie } from "./client.js";

interface AttendanceStored {
  baseUrl?: string;
  cookies?: AttendanceCookie[];
  savedAt?: string;
}

export async function loadAttendanceClient(): Promise<AttendanceClient> {
  const stored = await readCredential<AttendanceStored>("attendance");
  if (!stored?.cookies?.length) throw notConnected("attendance");
  const baseUrl = process.env.ATTENDANCE_BASE_URL ?? stored.baseUrl ?? DEFAULT_ATTENDANCE_BASE_URL;
  return new AttendanceClient({ baseUrl, cookies: stored.cookies });
}

const INSTRUCTIONS =
  "Monash attendance portal access. Use attendance_sessions to see which workshops/tutorials exist, and attendance_checkin to fill a code the lecturer gave in class. Check-in is the only write in this package: it fills by default and only submits when submit=true, so confirm the code with the user first.";

export function createAttendanceServer() {
  const server = createServer("awesome-monash-attendance", INSTRUCTIONS);
  registerAttendanceTools(server);
  return server;
}

export function registerAttendanceTools(server: McpServer) {
  let client: Promise<AttendanceClient> | null = null;

  function attendance(): Promise<AttendanceClient> {
    if (!client) {
      client = loadAttendanceClient().catch((error: unknown) => {
        client = null;
        throw error;
      });
    }
    return client;
  }

  server.registerTool(
    "attendance_status",
    {
      title: "Check the attendance session",
      description: "Probe the saved Monash attendance cookie and report whether the portal still accepts it.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => {
      const api = await attendance();
      const ok = await api.validate();
      return text({
        connected: ok,
        hint: ok ? undefined : "Run `npx awesome-monash-tools login attendance` to capture a fresh session.",
      });
    }),
  );

  server.registerTool(
    "attendance_sessions",
    {
      title: "List attendance sessions",
      description: "List the workshop/tutorial sessions the portal shows for this account, with the days each one appears.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await attendance()).listSessions())),
  );

  server.registerTool(
    "attendance_checkin",
    {
      title: "Check in to an attendance session",
      description:
        "Open the active attendance entry page for one unit/session and fill the code. Submits only when submit=true, which writes an attendance record — ask the user before using it.",
      inputSchema: z.object({
        course: z.string().min(1).max(40).describe("Unit code, e.g. FIT1045"),
        session: z.string().min(1).max(40).describe("Session label, e.g. Workshop 3"),
        code: z.string().min(2).max(20).describe("The attendance code shown in class"),
        submit: z.boolean().default(false).describe("Actually submit the code; false only fills it in"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    handler(async ({ course, session, code, submit }) =>
      text(await (await attendance()).checkin({ course, session, code }, { submit })),
    ),
  );
}
