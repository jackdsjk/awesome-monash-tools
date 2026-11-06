import { parse } from "node-html-parser";
import { AmtError, sessionRejected } from "../core/errors.js";
import { compact } from "../core/text.js";

const API = "https://gmail.googleapis.com/gmail/v1";

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  labelIds: string[];
  url: string;
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string | null;
}

export interface GmailMessageDetail extends GmailMessageSummary {
  to: string;
  cc: string;
  text: string;
  attachments: GmailAttachment[];
}

interface GmailPayload {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPayload[];
}

interface GmailApiMessage {
  id?: string;
  threadId?: string;
  internalDate?: string;
  labelIds?: string[];
  snippet?: string;
  payload?: GmailPayload;
}

interface GmailListResponse {
  messages?: Array<{ id?: string; threadId?: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export class GmailClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async get<T>(path: string, attempt = 0): Promise<T> {
    const response = await this.fetcher(`${API}${path}`, {
      headers: { authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      throw new AmtError("Could not reach Gmail.", {
        detail: error instanceof Error ? error.message : String(error),
        hint: "Check your network, then retry.",
      });
    });

    if ((response.status === 429 || (response.status === 403 && attempt < 4)) && attempt < 4) {
      const retryAfter = Number(response.headers.get("retry-after") ?? 0);
      await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1_000 : Math.min(20_000, 1_000 * 2 ** attempt)));
      return this.get<T>(path, attempt + 1);
    }
    if (response.status === 401) {
      throw sessionRejected("gmail", response.status, "Google rejected the access token.");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AmtError(`Gmail returned HTTP ${response.status}.`, {
        status: response.status,
        detail: body.slice(0, 500) || undefined,
      });
    }
    return (await response.json()) as T;
  }

  async profile(): Promise<GmailProfile> {
    const data = await this.get<{ emailAddress?: string; messagesTotal?: number; threadsTotal?: number; historyId?: string }>(
      "/users/me/profile",
    );
    return {
      emailAddress: data.emailAddress ?? "",
      messagesTotal: Number(data.messagesTotal ?? 0),
      threadsTotal: Number(data.threadsTotal ?? 0),
      historyId: data.historyId ?? "",
    };
  }

  async listLabels(): Promise<GmailLabel[]> {
    const data = await this.get<{ labels?: Array<{ id?: string; name?: string; type?: string }> }>("/users/me/labels");
    return (data.labels ?? []).map((label) => ({
      id: label.id ?? "",
      name: label.name ?? "",
      type: label.type ?? "user",
    }));
  }

  /** `query` uses Gmail search syntax, e.g. `from:monash.edu newer_than:7d`. */
  async listMessages(
    options: { query?: string; maxResults?: number; labelIds?: string[]; includeSpamTrash?: boolean; pageToken?: string } = {},
  ): Promise<{ messages: GmailMessageSummary[]; nextPageToken: string | null }> {
    const params = new URLSearchParams({
      maxResults: String(Math.min(Math.max(options.maxResults ?? 10, 1), 50)),
      includeSpamTrash: String(options.includeSpamTrash ?? false),
    });
    if (options.query) params.set("q", options.query);
    if (options.pageToken) params.set("pageToken", options.pageToken);
    for (const label of options.labelIds ?? []) params.append("labelIds", label);

    const data = await this.get<GmailListResponse>(`/users/me/messages?${params.toString()}`);
    const ids = (data.messages ?? []).map((message) => message.id).filter((id): id is string => Boolean(id));
    const messages = await Promise.all(ids.map((id) => this.getSummary(id).catch(() => null)));
    return { messages: messages.filter((message): message is GmailMessageSummary => message !== null), nextPageToken: data.nextPageToken ?? null };
  }

  private async getSummary(id: string): Promise<GmailMessageSummary> {
    const data = await this.get<GmailApiMessage>(`/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
    const headers = headerMap(data.payload?.headers);
    return {
      id: data.id ?? id,
      threadId: data.threadId ?? "",
      subject: decodeHeader(headers.get("subject") ?? "") || "(no subject)",
      from: decodeHeader(headers.get("from") ?? ""),
      date: headers.get("date") ?? "",
      snippet: data.snippet ?? "",
      labelIds: data.labelIds ?? [],
      url: gmailUrl(data.id ?? id),
    };
  }

  async getMessage(id: string): Promise<GmailMessageDetail> {
    const data = await this.get<GmailApiMessage>(`/users/me/messages/${encodeURIComponent(id)}?format=full`);
    const headers = headerMap(data.payload?.headers);
    const attachments = collectAttachments(data.payload);
    return {
      id: data.id ?? id,
      threadId: data.threadId ?? "",
      subject: decodeHeader(headers.get("subject") ?? "") || "(no subject)",
      from: decodeHeader(headers.get("from") ?? ""),
      to: decodeHeader(headers.get("to") ?? ""),
      cc: decodeHeader(headers.get("cc") ?? ""),
      date: headers.get("date") ?? "",
      snippet: data.snippet ?? "",
      labelIds: data.labelIds ?? [],
      url: gmailUrl(data.id ?? id),
      text: extractText(data.payload) || data.snippet || "",
      attachments,
    };
  }

  async getThread(threadId: string): Promise<GmailMessageDetail[]> {
    const data = await this.get<{ messages?: GmailApiMessage[] }>(`/users/me/threads/${encodeURIComponent(threadId)}?format=full`);
    return (data.messages ?? []).map((message) => {
      const headers = headerMap(message.payload?.headers);
      return {
        id: message.id ?? "",
        threadId: message.threadId ?? threadId,
        subject: decodeHeader(headers.get("subject") ?? "") || "(no subject)",
        from: decodeHeader(headers.get("from") ?? ""),
        to: decodeHeader(headers.get("to") ?? ""),
        cc: decodeHeader(headers.get("cc") ?? ""),
        date: headers.get("date") ?? "",
        snippet: message.snippet ?? "",
        labelIds: message.labelIds ?? [],
        url: gmailUrl(message.id ?? ""),
        text: extractText(message.payload) || message.snippet || "",
        attachments: collectAttachments(message.payload),
      };
    });
  }
}

function gmailUrl(id: string): string {
  return `https://mail.google.com/mail/u/0/#all/${id}`;
}

function headerMap(headers?: Array<{ name?: string; value?: string }>): Map<string, string> {
  return new Map((headers ?? []).map((header) => [header.name?.toLowerCase() ?? "", header.value ?? ""]));
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function extractText(payload?: GmailPayload): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return compact(parse(decodeBase64Url(payload.body.data)).text);
  }
  for (const part of payload.parts ?? []) {
    const text = extractText(part);
    if (text.trim()) return text;
  }
  return "";
}

function collectAttachments(payload?: GmailPayload, into: GmailAttachment[] = []): GmailAttachment[] {
  if (!payload) return into;
  if (payload.filename) {
    into.push({
      filename: payload.filename,
      mimeType: payload.mimeType ?? "application/octet-stream",
      size: Number(payload.body?.size ?? 0),
      attachmentId: payload.body?.attachmentId ?? null,
    });
  }
  for (const part of payload.parts ?? []) collectAttachments(part, into);
  return into;
}

/** RFC 2047 encoded words (=?UTF-8?B?...?=) appear in almost every Monash subject line. */
export function decodeHeader(value: string): string {
  if (!value.includes("=?")) return value;
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_match, charset: string, encoding: string, text: string) => {
    try {
      if (encoding.toLowerCase() === "b") return Buffer.from(text, "base64").toString(charset as BufferEncoding);
      return Buffer.from(
        text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
        "binary",
      ).toString(charset as BufferEncoding);
    } catch {
      return text;
    }
  });
}
