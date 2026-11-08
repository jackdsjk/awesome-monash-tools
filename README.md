<div align="center">

# Awesome Monash Tools

**Agent-native MCP servers for Monash University — Ed, Moodle, Gmail, OnTrack and the attendance portal, exposed as 25 tools your agent can call.**

[![Awesome](https://awesome.re/badge.svg)](https://awesome.re)
[![CI](https://github.com/jackdsjk/awesome-monash-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/jackdsjk/awesome-monash-tools/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/awesome-monash-tools.svg)](https://www.npmjs.com/package/awesome-monash-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-stdio-6B4FBB)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/tools-25-blue)](#-tool-catalogue)
[![Agent-first](https://img.shields.io/badge/built%20for-agents-0A66C2)](#-built-for-agents-not-for-humans)

**English** · [中文](README.zh-CN.md)

</div>

> Monash students work across five systems that never talk to each other: **Ed** for discussion, **Moodle** for deadlines and materials, **Gmail** for official mail, **OnTrack** for FIT task feedback, and the **attendance portal** for workshop check-in. None of them offers a student-facing API. This repository turns them into small, typed MCP tools so an agent can answer *"what is due, what did my tutor say, what did I miss, and did I get marked present?"* with real data instead of guesses.

> **Unofficial.** Not affiliated with Monash University, Ed, Moodle, Google or Doubtfire. Use your own account, at your own risk, and respect each service's terms.

---

## 🤖 Built for agents, not for humans

This repository ships **no app, no dashboard and no chat UI**. The only interface is a set of MCP tools. Every design choice targets the model on the other side of the protocol:

| Decision | Why it exists |
|---|---|
| **Tools, not pages** | An agent cannot "browse" Moodle. It can call `moodle_deadlines` and get JSON. |
| **Descriptions written for models** | Each tool states when to use it, what it returns, and what the next step is. |
| **Errors are instructions** | A dead session returns *"Moodle rejected the saved session. Run `awesome-monash login moodle`"* — not a stack trace. |
| **Deterministic output** | Stable field names, ISO timestamps, nearest-first sorting. Nothing the model has to re-derive. |
| **One guarded write** | Everything is read-only except attendance check-in, which fills a code and submits only when `submit: true` is passed explicitly. |
| **One credential, many calls** | Login is a CLI step; the agent never sees or asks for a password. |
| **Local stdio only** | No server, no telemetry, no account to create. The host spawns a process. |

Works with any MCP host: **Claude Code**, **Claude Desktop**, **Cursor**, **Codex**, **DeepSeek Harness**, or your own agent loop.

## 📋 Table of Contents

- [Why this exists](#-why-this-exists)
- [What's inside](#-whats-inside)
- [What agents can do](#-what-agents-can-do)
- [Quick start](#-quick-start)
- [MCP configuration](#-mcp-configuration)
- [Tool catalogue](#-tool-catalogue)
- [Design principles](#-design-principles)
- [Security and privacy](#-security-and-privacy)
- [Repository layout](#-repository-layout)
- [Development](#-development)
- [Contributing](#-contributing)
- [Related projects](#-related-projects)
- [License](#-license)

---

## 💡 Why this exists

Ask a Monash student a simple question — *"what's due this week?"* — and the real answer requires four logins, four UIs and a mental join. The information exists, but it is optimized for humans clicking around, not for an agent answering.

Existing tools stop halfway:

- `moodle-cli`, `edstem-cli` and `ontrack-cli` are excellent **terminal** tools. They print tables for a person and assume a person runs them.
- Scraping libraries return HTML. A model then burns context re-reading a Moodle theme.
- Each service authenticates differently (API token, SSO cookie, OAuth, refresh cookie). Doing that per question is impossible.

This project does the boring part once — **authentication, normalization, and error recovery** — and exposes the result as 25 MCP tools with consistent shapes. The agent does the thinking; the repository does the plumbing.

**What this is not:** not a Monash client, not a notification app, not a scraper you point at arbitrary URLs, and not a way to automate submissions. The only write is an attendance check-in the caller has to confirm.

## 📦 What's inside

| Component | What you get |
|---|---|
| **5 MCP servers** | `ed`, `moodle`, `gmail`, `ontrack`, `attendance` — each independently runnable |
| **1 combined server** | `all` — all 25 tools in one process |
| **1 CLI** | `awesome-monash login / logout / status / serve` |
| **25 tools** | typed inputs, JSON output, actionable errors |
| **Docs** | [Auth guide](docs/auth.md) · [Tool reference](docs/tools.md) · [llms.txt](llms.txt) |

| Server | Bin | Tools | Auth captured by `awesome-monash login` |
|---|---|---:|---|
| Ed | `awesome-monash-ed` | 7 | API token from <https://edstem.org/settings/api-tokens> |
| Moodle | `awesome-monash-moodle` | 5 | Monash SSO cookie jar (Chrome, one login) |
| Gmail | `awesome-monash-gmail` | 5 | Google OAuth, `gmail.readonly` only |
| OnTrack | `awesome-monash-ontrack` | 5 | Monash SSO refresh cookie |
| Attendance | `awesome-monash-attendance` | 3 | Monash SSO cookies for `attendance.monash.edu.my` |
| All | `awesome-monash-all` | 25 | whichever sources you connected |

## 🎯 What agents can do

Real questions, and the tools that answer them:

| Ask your agent | Tools it calls |
|---|---|
| "What is due in the next 14 days, and which ones have I already submitted?" | `moodle_deadlines` with `checkSubmitted: true` |
| "Summarize this week's Ed threads in FIT1045; skip anything already answered." | `ed_list_threads` → `ed_get_thread` |
| "Did my tutor leave feedback on P1? Quote the part about the data model." | `ontrack_list_projects` → `ontrack_list_tasks` → `ontrack_task_comments` |
| "I am in FIT1045 Workshop 3 and the code is ABC123 — mark me present." | `attendance_sessions` → `attendance_checkin` |
| "Find the enrolment email from Monash and tell me the payment deadline." | `gmail_search_messages` → `gmail_get_message` |
| "What's in week 8 of FIT1047, and is there a lab sheet?" | `moodle_list_courses` → `moodle_course_content` |
| "Build my week: deadlines first, then unread Ed threads, then tutor feedback." | all five servers |

Because everything is scoped to **your own account**, the answers are yours: your submissions, your feedback, your inbox. Nothing is shared or cached remotely.

## 🚀 Quick start

Requires **Node.js 20.11+** and **Google Chrome** (only for the three SSO logins).

```bash
# Nothing to install: npx pulls the published package.
npx -y awesome-monash-tools@latest login ed
npx -y awesome-monash-tools@latest login moodle
npx -y awesome-monash-tools@latest login ontrack
npx -y awesome-monash-tools@latest login attendance
npx -y awesome-monash-tools@latest login gmail --client-id <id> --client-secret <secret>

npx -y awesome-monash-tools@latest status
npx -y awesome-monash-tools@latest serve all
```

Prefer a short command? Install it once and drop the `npx ...` prefix:

```bash
npm install -g awesome-monash-tools

awesome-monash login ed
awesome-monash status
awesome-monash serve all
```

`login moodle`, `login ontrack` and `login attendance` open a Chrome window: finish the normal Monash SSO login, wait for the dashboard, and the session is saved automatically. Nothing is typed into this tool.

> Working on the code instead? `git clone` the repo, then `npm install && npm run build && npm link`.

## 🔌 MCP configuration

**Claude Code**

```bash
claude mcp add monash -- npx -y awesome-monash-tools@latest serve all
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`)

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
    "ed":       { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "ed"] },
    "moodle":   { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "moodle"] },
    "gmail":    { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "gmail"] },
    "ontrack":  { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "ontrack"] },
    "attendance": { "command": "npx", "args": ["-y", "awesome-monash-tools@latest", "serve", "attendance"] }
  }
}
```

**Cursor** uses the same JSON in `.cursor/mcp.json`.

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.monash]
command = "npx"
args = ["-y", "awesome-monash-tools@latest", "serve", "all"]
```

## 🧰 Tool catalogue

Full parameters and return shapes: [docs/tools.md](docs/tools.md).

### Ed — discussion threads and lessons

| Tool | Description |
|---|---|
| `ed_whoami` | Account and courses behind the token |
| `ed_list_courses` | Course ids and codes |
| `ed_list_threads` | Threads of one course, newest/top/unanswered |
| `ed_search_threads` | Search titles and bodies across courses |
| `ed_get_thread` | Full thread with nested replies and staff answers |
| `ed_list_lessons` | Weekly lesson modules |
| `ed_get_lesson` | Every slide as text/Markdown, files and video URLs |

### Moodle — deadlines and materials

| Tool | Description |
|---|---|
| `moodle_whoami` | Session health check |
| `moodle_list_courses` | Enrolled courses |
| `moodle_deadlines` | Due dates nearest first, optional submission check |
| `moodle_course_content` | Sections, activities, label text, file links |
| `moodle_submission_status` | submitted / graded / none for one activity |

### Gmail — the official inbox

| Tool | Description |
|---|---|
| `gmail_profile` | Address and counts |
| `gmail_list_labels` | Labels and ids |
| `gmail_search_messages` | Gmail query syntax, metadata results |
| `gmail_get_message` | Plain-text body, recipients, attachments |
| `gmail_get_thread` | Every message in a thread |

### OnTrack — FIT task feedback

| Tool | Description |
|---|---|
| `ontrack_whoami` | Account behind the refresh cookie |
| `ontrack_list_projects` | Units and project ids |
| `ontrack_list_tasks` | Status, weighting, due dates |
| `ontrack_task_comments` | Tutor comments and grade rationale |
| `ontrack_download` | Save a task sheet or submission PDF locally |

### Attendance — workshop check-in

| Tool | Description |
|---|---|
| `attendance_status` | Whether the saved attendance session still works |
| `attendance_sessions` | Workshops/tutorials the portal lists, with their days |
| `attendance_checkin` | Fill a code for one unit/session; submits only with `submit: true` |

## 🧱 Design principles

1. **Normalize at the edge.** Moodle is scraped internally and returned as structured sections — the model never sees HTML.
2. **One job per tool.** `moodle_deadlines` does deadlines; `moodle_submission_status` checks one submission. No mega-tools.
3. **Verb + noun names, prefixed by source.** `ed_get_thread` is unambiguous in a 25-tool list.
4. **Fail with the fix.** Every `AmtError` carries a `hint`; the tool result includes the exact command to run.
5. **Read-only by default.** The only write is `attendance_checkin`, which fills a code and submits only with `submit: true`. `ontrack_download` writes a local file. Both are annotated as such.
6. **Stable shapes.** Field names, ISO timestamps, deterministic ordering — agents can rely on them between calls.
7. **Local and quiet.** stdio transport, no server component, no analytics, no remote cache.

## 🔒 Security and privacy

- Credentials live in `~/.config/awesome-monash-tools/credentials.json`, mode `0600`; `AMT_CONFIG_DIR` relocates them.
- No password is ever entered into this tool. Moodle and OnTrack logins happen in a real Chrome window.
- Gmail requests only `gmail.readonly`; revoke at <https://myaccount.google.com/permissions>.
- No telemetry, no remote logging, no third-party service in the middle.
- Output is sensitive by definition (grades, feedback, email, attendance). Treat transcripts accordingly.
- Attendance is the only write: it needs `attendance_checkin` with `submit: true`, and it is recorded against your student account.
- Environment overrides exist for advanced users: `ED_API_TOKEN`, `MOODLE_COOKIE`, `ONTRACK_REFRESH_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

## 🗂 Repository layout

```
src/core/       config, credential store, HTTP retries, MCP helpers
src/ed/         Ed client, tools, server bin
src/moodle/     Moodle client (AJAX + scraping), tools, server bin
src/gmail/      Gmail client + OAuth loopback, tools, server bin
src/ontrack/    OnTrack client (refresh-cookie auth), tools, server bin
src/all.ts      combined server
src/cli.ts      login / logout / status / serve
docs/           auth guide and tool reference (EN + 中文)
scripts/        protocol-level smoke test
```

## 🛠 Development

```bash
npm install
npm run check     # tsc --noEmit + vitest
npm run build     # emit dist/
npm run smoke     # start every server over stdio and call one tool
npm run dev -- status
```

The test suite uses a fake `fetch`; no real account is required to develop. See [AGENTS.md](AGENTS.md) for conventions.

## 🤝 Contributing

- **New tools:** prefer read-only; any write must be explicit, annotated, and documented in both languages.
- **New sources:** follow `src/ed/` (client → tools → server) and add a credential section in [docs/auth.md](docs/auth.md).
- **Docs:** update both `README.md` and `README.zh-CN.md`, and both language versions of `docs/`.
- Run `npm run check && npm run smoke` before opening a PR.

## 🌏 Related projects

Other community work in the Monash × agents space. Some of it taught this project how the APIs behave; none of it is bundled here.

| Project | What it does | License |
|---|---|---|
| [bunizao/edstem-cli](https://github.com/bunizao/edstem-cli) | Ed CLI + MCP server, the closest prior art | MIT |
| [bunizao/moodle-cli](https://github.com/bunizao/moodle-cli) | Moodle CLI covering deadlines, grades and forums | MIT |
| [bunizao/ontrack-cli](https://github.com/bunizao/ontrack-cli) | OnTrack tasks and submissions from the terminal | MIT |
| [MarkChu-git/Always-Ontrack](https://github.com/MarkChu-git/Always-Ontrack) | OnTrack watcher with real-time feedback | Apache-2.0 |
| [TuuHub/unicorn](https://github.com/TuuHub/unicorn) | Self-hosted campus memory layer (Cove) | Apache-2.0 |

Built something else for Monash students? Open a PR and add it to the table.

## 📄 License

[MIT](LICENSE) © 2026 jackdsjk

---

*Built for agents that need to know what is due.*
