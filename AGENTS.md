# Repository Guidelines

## Purpose

`awesome-monash-tools` ships four read-only MCP servers (Ed, Moodle, Gmail, OnTrack) plus one combined server, all started through the same CLI. The package is published to npm as `awesome-monash-tools`.

## Commands

Run from the repository root:

```bash
npm install
npm run check      # tsc --noEmit + vitest
npm run build      # tsc -p tsconfig.build.json -> dist/
npm run smoke      # build first; starts every server over stdio and calls one tool
npm run dev -- status
```

## Layout

- `src/core/` — config paths, credential store, HTTP retry wrapper, MCP result helpers.
- `src/<source>/` — client (HTTP/scraping), tools (MCP registration), `server.ts` (bin).
- `src/cli.ts` — `login`, `logout`, `status`, `serve`.
- `src/all.ts` — combined server.
- `scripts/smoke.mjs` — protocol-level smoke test (spawns each bin).
- `docs/` — auth and tool reference; keep them in sync with code.

## Conventions

- ESM + NodeNext, strict TypeScript, two-space indentation.
- Tool names are `source_action` and every schema uses zod.
- Every thrown error must become an `AmtError` with a hint, so MCP clients see the next command to run.
- New tools must be annotated with `readOnlyHint`; this project has no write path.
- Tests are colocated (`src/**/*.test.ts`) and use a fake `fetch`; never call real services in tests.

## Security

- Never log or return tokens, cookies or email bodies beyond what a tool explicitly returns.
- Credentials stay in `~/.config/awesome-monash-tools/credentials.json` (0600); tests must set `AMT_CONFIG_DIR` to a temp directory.
- Do not add telemetry, remote logging or a server-side component.
