# Authentication

Every source authenticates differently because every Monash service does. This page explains what each login actually captures, where it is stored, and how to recover when it expires.

**Language:** **English** · [中文](auth.zh-CN.md)

## Where credentials live

| Item | Path |
|---|---|
| Credentials | `~/.config/awesome-monash-tools/credentials.json` (mode `0600`) |
| Chrome profiles | `~/.config/awesome-monash-tools/profiles/<source>/` |
| OnTrack downloads | `~/.config/awesome-monash-tools/downloads/` |

`AMT_CONFIG_DIR` moves the whole directory (useful for tests or a separate school account).

The file is plain JSON, written atomically. Environment variables win over the file:

| Source | Environment overrides |
|---|---|
| Ed | `ED_API_TOKEN`, `ED_REGION` |
| Moodle | `MOODLE_COOKIE`, `MOODLE_BASE_URL` |
| Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` |
| OnTrack | `ONTRACK_USERNAME`, `ONTRACK_REFRESH_TOKEN`, `ONTRACK_BASE_URL` |

Anything in an environment variable is never written to disk by this tool (the Gmail client secret is the exception when passed with `--client-secret`; prefer the environment variable if that matters).

---

## Ed

Ed's API uses `Authorization: Bearer <token>`.

1. Log in at <https://edstem.org>.
2. Open <https://edstem.org/settings/api-tokens> and create a token.
3. `npx awesome-monash-tools login ed` (or `--token`, or `ED_API_TOKEN`).

Tokens are per account and long-lived. Revoke them from the same settings page. The login validates the token by calling `/api/user`, so a typo fails immediately instead of on the first tool call.

Region: Monash uses `au`. The region only affects the web URLs the tools return; the API host is always `edstem.org/api`.

Troubleshooting:

| Symptom | Cause |
|---|---|
| `Ed rejected the saved session (HTTP 401)` | Token revoked or copied with whitespace; log in again |
| `No Ed course matches "..."` | The token belongs to a different account, or the course is archived |

---

## Moodle

Moodle has no usable personal API token for students, so the login captures the browser session instead.

`login moodle`:

1. Opens a persistent Chrome profile at `profiles/moodle`.
2. Navigates to `https://learning.monash.edu/my/`.
3. Waits for you to finish the Monash SSO login.
4. Collects every `*.monash.edu` cookie (including `MoodleSession` and `MDL_SSP_SessID` — both matter, sending only the former can bounce back to Okta).
5. Probes the dashboard with that cookie jar and only saves it if the dashboard actually loads.

Consequences:

- The session is the same one a browser would have. It expires after a few hours; Moodle logs the browser out too.
- No password is ever stored. The tool never types your credentials.
- The Chrome profile stays on disk so a re-login is usually one click.

When a tool says the session expired, rerun `login moodle`. If you want automatic keepalive, run the same command from a scheduled task; the tool does not install background agents on its own.

Troubleshooting:

| Symptom | Cause |
|---|---|
| Login times out | The dashboard never loaded, or SSO opened in another window |
| `Moodle dashboard did not contain a sesskey` | The saved cookie reaches a login page; log in again |
| `Moodle AJAX returned an error` | The site disabled that web service for your role |

---

## Gmail

Gmail uses standard Google OAuth with PKCE and a loopback redirect; no client secret ever leaves your machine.

Create the client once:

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or pick) a project.
2. **APIs & Services → Library → Gmail API → Enable**.
3. **APIs & Services → OAuth consent screen**: External, add yourself as a test user.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
5. Under the client, add the redirect URI `http://127.0.0.1:48125/oauth/google/callback`.

Then:

```bash
export GOOGLE_CLIENT_ID=...
export GOOGLE_CLIENT_SECRET=...
npx awesome-monash-tools login gmail
```

Notes:

- Scope: `https://www.googleapis.com/auth/gmail.readonly`. Nothing else is requested.
- The loopback listener binds `127.0.0.1` only and closes as soon as the code arrives.
- Refresh tokens are stored in `credentials.json`; access tokens are refreshed automatically before they expire.
- Port 48125 busy? Pass `--port 48126` and register that redirect URI too.
- Revoke access at <https://myaccount.google.com/permissions>.

Troubleshooting:

| Symptom | Cause |
|---|---|
| `Google did not return an access token` | Redirect URI mismatch or wrong client secret |
| `redirect_uri_mismatch` on the consent screen | The registered URI differs by port or path |
| `Google refused to refresh the Gmail token` | Access revoked or the OAuth client was deleted |

---

## OnTrack

OnTrack (Doubtfire) stores a `refresh_token` cookie for the signed-in web app and mints short-lived access tokens from it.

`login ontrack`:

1. Opens a persistent Chrome profile at `profiles/ontrack`.
2. Navigates to `https://ontrack.infotech.monash.edu`.
3. Waits for the Monash SSO login.
4. Reads the `refresh_token` and `username` cookies.
5. Calls `POST /api/auth/access-token` and then `GET /api/projects` to prove the cookie still works before saving it.

At runtime the client mints an access token, caches it in memory until 60 seconds before expiry, and never writes tokens to disk.

Troubleshooting:

| Symptom | Cause |
|---|---|
| Login times out | The task list never loaded |
| `OnTrack login returned HTTP 419` | The refresh cookie was revoked; log in again |
| `OnTrack request failed (HTTP 404)` | The API base URL is wrong (`.../api` is required) |

---

## Attendance

The Monash attendance portal (`attendance.monash.edu.my`) is a separate WebForms site with its own SSO cookie, `StudentFedAuth`.

`login attendance`:

1. Opens a persistent Chrome profile at `profiles/attendance`.
2. Navigates to `https://attendance.monash.edu.my/student/`.
3. Waits for you to finish the Monash SSO login.
4. Captures every `*.monash.edu.my` cookie once `StudentFedAuth` appears.
5. Re-opens the portal in a headless browser and only saves the cookies if the Units page actually loads.

Notes:

- The portal's TLS chain is not in Node's bundled CA store, so every attendance call drives a real Chrome instead of plain `fetch`.
- The session is the same one a browser would have; when it expires, every attendance tool returns a reconnect hint.
- `attendance_checkin` fills the code and, only with `submit: true`, submits it. That is the only write in this package.

Troubleshooting:

| Symptom | Cause |
|---|---|
| Login times out | The Units page never loaded, or SSO opened in another window |
| `Attendance rejected the saved session` | `StudentFedAuth` expired; log in again |
| `Could not start Chrome` | Chrome is not installed; the portal needs a real browser |

## What is never done

- No password prompt, no credential forwarding, no scraping of the password field.
- No tokens in logs, error messages or MCP output.
- No background process, daemon or LaunchAgent is installed.
- Attendance is the only write, and it is gated behind `submit: true`.
