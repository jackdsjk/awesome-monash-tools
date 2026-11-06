import { describe, expect, it, vi } from "vitest";
import { GmailClient, decodeHeader } from "./client.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const metadata = {
  id: "m1",
  threadId: "t1",
  internalDate: "1767225600000",
  labelIds: ["INBOX"],
  snippet: "Your unit results are out",
  payload: {
    headers: [
      { name: "Subject", value: "=?UTF-8?B?5L2g5aW9?=" },
      { name: "From", value: "Monash Results <results@monash.edu>" },
      { name: "Date", value: "Thu, 1 Jan 2026 09:00:00 +0800" },
    ],
  },
};

function fakeFetch(routes: Array<[string, () => Response]>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [needle, make] of routes) if (url.includes(needle)) return make();
    return json({ error: "unexpected" }, 404);
  });
}

describe("GmailClient", () => {
  it("lists messages with decoded headers", async () => {
    const fetcher = fakeFetch([
      ["/users/me/messages?", () => json({ messages: [{ id: "m1", threadId: "t1" }] })],
      ["/users/me/messages/m1?format=metadata", () => json(metadata)],
    ]);

    const result = await new GmailClient("token", fetcher).listMessages({ query: "from:monash.edu", maxResults: 5 });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: "m1",
      subject: "你好",
      from: "Monash Results <results@monash.edu>",
      snippet: "Your unit results are out",
      url: "https://mail.google.com/mail/u/0/#all/m1",
    });
  });

  it("extracts the plain-text body and attachments", async () => {
    const fetcher = fakeFetch([
      [
        "/users/me/messages/m2?format=full",
        () =>
          json({
            id: "m2",
            threadId: "t2",
            payload: {
              mimeType: "multipart/mixed",
              headers: [
                { name: "Subject", value: "Assignment feedback" },
                { name: "From", value: "tutor@monash.edu" },
                { name: "To", value: "student@monash.edu" },
              ],
              parts: [
                { mimeType: "text/plain", body: { data: Buffer.from("Feedback body").toString("base64url") } },
                {
                  mimeType: "application/pdf",
                  filename: "feedback.pdf",
                  body: { size: 1024, attachmentId: "att-1" },
                },
              ],
            },
          }),
      ],
    ]);

    const message = await new GmailClient("token", fetcher).getMessage("m2");
    expect(message.text).toBe("Feedback body");
    expect(message.attachments).toEqual([{ filename: "feedback.pdf", mimeType: "application/pdf", size: 1024, attachmentId: "att-1" }]);
  });

  it("turns HTTP 401 into a reconnect hint", async () => {
    const fetcher = fakeFetch([["/users/me/profile", () => json({ error: "unauthorized" }, 401)]]);
    await expect(new GmailClient("expired", fetcher).profile()).rejects.toMatchObject({
      status: 401,
      hint: expect.stringContaining("login gmail"),
    });
  });

  it("decodes RFC 2047 encoded words", () => {
    expect(decodeHeader("=?UTF-8?B?5L2g5aW9?=")).toBe("你好");
    expect(decodeHeader("=?UTF-8?Q?Hello_World?=")).toBe("Hello World");
    expect(decodeHeader("plain subject")).toBe("plain subject");
  });
});
