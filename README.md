# Awesome Monash Tools

Unofficial [MCP](https://modelcontextprotocol.io) servers for the tools Monash students actually use every day: **Ed**, **Moodle**, **Gmail** and **OnTrack**.

Each source ships as its own MCP server, and one combined server exposes all of them. Everything is **read-only**: the servers never post, submit, enrol, delete or send anything. They exist so an assistant can answer questions like *"what is due this week?"*, *"what did my tutor say about task 3?"*, or *"search my Ed threads for the exam format"* with real data instead of guesses.

> Not affiliated with Monash University or any of the services above. Use your own account, at your own risk, and check each service's terms.

## Servers

| Server | Bin | Tools | Auth |
|---|---|---|---|
| Ed | `awesome-monash-ed` | 7 | Ed API token |
| Moodle | `awesome-monash-moodle` | 5 | Monash SSO cookie (captured in Chrome) |
| Gmail | `awesome-monash-gmail` | 5 | Google OAuth (read-only scope) |
| OnTrack | `awesome-monash-ontrack` | 5 | Monash SSO refresh cookie (captured in Chrome) |
| All | `awesome-monash-all` | 22 | whichever sources are connected |

## Quick start

Requires Node.js 20.11+ and Google Chrome (only for the two SSO logins).

```bash
# 1. Connect the sources you use. Each command stores a credential locally.
npx awesome-monash-tools login ed
npx awesome-monash-tools login moodle
npx awesome-monash-tools login ontrack
npx awesome-monash-tools login gmail --client-id <id> --client-secret <secret>

# 2. Check what is connected.
npx awesome-monash-tools status

# 3. Point your MCP host at one server (or at `serve all`).
npx awesome-monash-tools serve all
```

`login moodle` and `login ontrack` open a Chrome window: finish the normal Monash SSO login there, wait for the dashboard to load, and the command saves the session automatically.

## MCP configuration

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "monash": {
      "command": "npx",
      "args": ["-y", "awesome-monash-tools@latest", "serve", "all"]
    }
  }
}
```

Prefer one server per source (smaller tool list, clearer permissions):

```json
{
  "mcpServers": {
    "ed": { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "ed"] },
    "moodle": { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "moodle"] },
    "gmail": { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "gmail"] },
    "ontrack": { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "ontrack"] }
  }
}
```

Cursor uses the same JSON shape in `.cursor/mcp.json`. Codex uses TOML in `~/.codex/config.toml`:

```toml
[mcp_servers.monash]
command = "npx"
args = ["-y", "awesome-monash-tools@latest", "serve", "all"]
```

## Auth

All credentials live in `~/.config/awesome-monash-tools/credentials.json` (mode `0600`). Nothing is sent anywhere except to the service it belongs to. See [docs/auth.md](docs/auth.md) for the longer version, including Google Cloud setup and troubleshooting.

### Ed

1. Open <https://edstem.org/settings/api-tokens> while logged in and create a token.
2. Run `npx awesome-monash-tools login ed` and paste it (or pass `--token`).
3. Tokens are per-account and long-lived; revoke them from the same page.

Monash lives on Ed's `au` region; use `--region au|us|eu` if your course URLs say otherwise.

### Moodle

`npx awesome-monash-tools login moodle` launches Chrome, waits for the Monash SSO login, and saves the whole `learning.monash.edu` cookie jar. Moodle sessions expire after a few hours; when a tool reports an expired session, run the same command again.

### Gmail

Create an OAuth **Desktop app** client in Google Cloud, enable the Gmail API, and add

```
http://127.0.0.1:48125/oauth/google/callback
```

as an authorized redirect URI. Then:

```bash
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
npx awesome-monash-tools login gmail
```

Only `gmail.readonly` is requested. Use a dedicated client for this tool; do not reuse production credentials.

### OnTrack

`npx awesome-monash-tools login ontrack` captures the `refresh_token` cookie from a real Monash SSO login at `ontrack.infotech.monash.edu`. The server mints short-lived access tokens from it, exactly like the web app does. If the refresh cookie is revoked, log in again.

## Tools

See [docs/tools.md](docs/tools.md) for parameters and return shapes.

| Source | Tools |
|---|---|
| Ed | `ed_whoami`, `ed_list_courses`, `ed_list_threads`, `ed_search_threads`, `ed_get_thread`, `ed_list_lessons`, `ed_get_lesson` |
| Moodle | `moodle_whoami`, `moodle_list_courses`, `moodle_deadlines`, `moodle_course_content`, `moodle_submission_status` |
| Gmail | `gmail_profile`, `gmail_list_labels`, `gmail_search_messages`, `gmail_get_message`, `gmail_get_thread` |
| OnTrack | `ontrack_whoami`, `ontrack_list_projects`, `ontrack_list_tasks`, `ontrack_task_comments`, `ontrack_download` |

Design notes:

- **Read-only by construction.** There is no write path in the codebase; tools are annotated `readOnlyHint: true` (except `ontrack_download`, which writes a file to the local config directory).
- **No runtime dependency on `moodle-cli`, `edstem-cli` or `ontrack-cli`.** The HTTP contracts were derived from them, but each server talks to the service directly so `npx` works on a fresh machine.
- **Failures are actionable.** A missing or expired session returns *"Ed is not connected. Run `npx awesome-monash-tools login ed`"* instead of an opaque HTTP error.
- **One credential file, 0600.** Environment variables (`ED_API_TOKEN`, `MOODLE_COOKIE`, `ONTRACK_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, …) override saved credentials for CI or throwaway use.

## Development

```bash
npm install
npm run check        # tsc + vitest
npm run build        # emit dist/
npm run smoke        # start every server over stdio and call one tool
npm run dev -- status
```

Layout:

```
src/core/       config, credential store, HTTP retries, MCP helpers
src/ed/         Ed client, tools, server bin
src/moodle/     Moodle client (AJAX + scraping), tools, server bin
src/gmail/      Gmail client + OAuth loopback, tools, server bin
src/ontrack/    OnTrack client (refresh-cookie auth), tools, server bin
src/all.ts      combined server
src/cli.ts      login / logout / status / serve
```

## Security and privacy

- The MCP server runs locally, over stdio. No server, no telemetry, no analytics.
- Credentials are stored in plain JSON with owner-only permissions. If you need a keychain, put the secrets in environment variables instead and rerun the login less.
- Gmail access is read-only and revocable at <https://myaccount.google.com/permissions>.
- Treat the output as sensitive: it contains your emails, grades, feedback and course activity.

## License

MIT. See [LICENSE](LICENSE).
