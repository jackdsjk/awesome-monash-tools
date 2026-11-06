import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readCredential, writeCredential } from "../core/credentials.js";
import { AmtError, notConnected } from "../core/errors.js";
import { createServer, handler, text } from "../core/mcp.js";
import { GmailClient } from "./client.js";
import { refreshTokens, type GoogleClientConfig, type GmailTokens } from "./oauth.js";

export interface GmailStored extends GmailTokens {
  client_id?: string;
  client_secret?: string;
  email?: string;
}

export function gmailClientConfig(stored?: GmailStored | null): GoogleClientConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? stored?.client_id;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? stored?.client_secret;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "http://127.0.0.1:48125/oauth/google/callback";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri };
}

export async function loadGmailClient(): Promise<GmailClient> {
  const stored = await readCredential<GmailStored>("gmail");
  if (!stored?.access_token && !stored?.refresh_token) throw notConnected("gmail");

  let tokens = stored;
  if (!tokens.access_token || tokens.expires_at <= Date.now() + 60_000) {
    if (!tokens.refresh_token) throw notConnected("gmail");
    const config = gmailClientConfig(stored);
    if (!config) {
      throw new AmtError("Gmail needs to be re-authorized.", {
        hint: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, then run `npx awesome-monash-tools login gmail`.",
      });
    }
    tokens = { ...stored, ...(await refreshTokens(config, tokens.refresh_token)) };
    await writeCredential("gmail", { ...tokens });
  }
  return new GmailClient(tokens.access_token);
}

const INSTRUCTIONS =
  "Read-only Gmail access with Gmail search syntax (from:, newer_than:, subject:). Start with gmail_search_messages, then gmail_get_message for the body. Gmail is a personal inbox: never assume the account belongs to anyone but the user.";

export function createGmailServer() {
  const server = createServer("awesome-monash-gmail", INSTRUCTIONS);
  registerGmailTools(server);
  return server;
}

export function registerGmailTools(server: McpServer) {
  let client: Promise<GmailClient> | null = null;

  function gmail(): Promise<GmailClient> {
    if (!client) {
      client = loadGmailClient().catch((error: unknown) => {
        client = null;
        throw error;
      });
    }
    return client;
  }

  server.registerTool(
    "gmail_profile",
    {
      title: "Show the connected Gmail account",
      description: "Return the address and message counts of the saved Gmail authorization.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await gmail()).profile())),
  );

  server.registerTool(
    "gmail_list_labels",
    {
      title: "List Gmail labels",
      description: "List labels and their ids, for use with the labelIds filter.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async () => text(await (await gmail()).listLabels())),
  );

  server.registerTool(
    "gmail_search_messages",
    {
      title: "Search Gmail",
      description: "Search messages with Gmail query syntax and return subject, sender, date and snippet.",
      inputSchema: z.object({
        query: z.string().max(400).default("").describe("Gmail query, e.g. from:monash.edu newer_than:7d"),
        maxResults: z.number().int().min(1).max(25).default(10),
        labelIds: z.array(z.string()).max(10).optional(),
        includeSpamTrash: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ query, maxResults, labelIds, includeSpamTrash }) =>
      text(await (await gmail()).listMessages({ query, maxResults, labelIds, includeSpamTrash })),
    ),
  );

  server.registerTool(
    "gmail_get_message",
    {
      title: "Read a Gmail message",
      description: "Read one message as plain text, with recipients and the attachment list.",
      inputSchema: z.object({ id: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ id }) => text(await (await gmail()).getMessage(id))),
  );

  server.registerTool(
    "gmail_get_thread",
    {
      title: "Read a Gmail thread",
      description: "Read every message of a thread in order.",
      inputSchema: z.object({ threadId: z.string().min(1) }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    handler(async ({ threadId }) => text(await (await gmail()).getThread(threadId))),
  );
}
