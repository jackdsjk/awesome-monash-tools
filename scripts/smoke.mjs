#!/usr/bin/env node
/**
 * Protocol-level smoke test: start every MCP server, list its tools, and make
 * sure a tool with no credentials fails with an actionable message instead of a
 * stack trace. Run `npm run build` first.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ENTRIES = [
  ["ed", "dist/ed/server.js", "ed_list_courses"],
  ["moodle", "dist/moodle/server.js", "moodle_list_courses"],
  ["gmail", "dist/gmail/server.js", "gmail_profile"],
  ["ontrack", "dist/ontrack/server.js", "ontrack_list_projects"],
  ["all", "dist/all.js", "moodle_deadlines"],
];

const config = await mkdtemp(join(tmpdir(), "amt-smoke-"));
let failed = 0;

try {
  for (const [name, entry, probe] of ENTRIES) {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      env: { ...process.env, AMT_CONFIG_DIR: config },
      stderr: "pipe",
    });
    const client = new Client({ name: "awesome-monash-tools-smoke", version: "0.0.0" });
    await client.connect(transport);

    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();
    console.log(`${name.padEnd(8)} ${names.length} tools: ${names.join(", ")}`);

    const result = await client.callTool({ name: probe, arguments: {} });
    const text = result.content?.[0]?.text ?? "";
    if (!result.isError || !text.includes("login")) {
      console.error(`  ✗ ${probe} should have failed with a login hint, got: ${text}`);
      failed += 1;
    } else {
      console.log(`  ✓ ${probe} reports: ${text.split("\n")[0]}`);
    }

    await client.close();
  }
} finally {
  await rm(config, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} smoke check(s) failed.`);
  process.exit(1);
}
console.log("\nAll MCP servers started and answered.");
