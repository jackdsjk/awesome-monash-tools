import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AmtError } from "./errors.js";

export const VERSION: string = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return manifest.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export function text(value: unknown): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

export function fail(error: unknown): ToolResult {
  const amt = error instanceof AmtError ? error : null;
  const message = error instanceof Error ? error.message : String(error ?? "Unknown error");
  const parts = [message];
  if (amt?.detail) parts.push(`Details: ${amt.detail}`);
  if (amt?.hint) parts.push(amt.hint);
  return { isError: true, content: [{ type: "text", text: parts.join("\n\n") }] };
}

/** Wraps a tool body so every thrown error becomes a readable tool result. */
export function handler<T>(fn: (args: T) => Promise<ToolResult>): (args: T) => Promise<ToolResult> {
  return async (args: T) => {
    try {
      return await fn(args);
    } catch (error) {
      return fail(error);
    }
  };
}

export function createServer(name: string, instructions: string): McpServer {
  return new McpServer({ name, version: VERSION }, { instructions });
}

export async function serve(server: McpServer, name: string): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${name}] awesome-monash-tools v${VERSION} ready on stdio\n`);
}
