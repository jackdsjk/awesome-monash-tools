import { createHash, randomBytes } from "node:crypto";
import { AmtError } from "../core/errors.js";

export interface GoogleClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scope?: string;
  token_type?: string;
}

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export function base64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function createPkce(): { verifier: string; challenge: string; state: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  const state = base64url(randomBytes(24));
  return { verifier, challenge, state };
}

export function authorizationUrl(config: GoogleClientConfig, pkce: { challenge: string; state: string }): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    state: pkce.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCode(
  config: GoogleClientConfig,
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
): Promise<GmailTokens> {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
    code_verifier: verifier,
  });
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string }
    | null;
  if (!response.ok || !payload?.access_token) {
    throw new AmtError("Google did not return an access token.", {
      detail: payload?.error_description ?? `HTTP ${response.status}`,
      hint: "Check the OAuth client id/secret and that the redirect URI matches the one registered in Google Cloud.",
    });
  }
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    expires_at: Number(Date.now() + (payload.expires_in ?? 3_500) * 1_000),
    scope: payload.scope,
    token_type: "Bearer",
  };
}

export async function refreshTokens(
  config: GoogleClientConfig,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<GmailTokens> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string }
    | null;
  if (!response.ok || !payload?.access_token) {
    throw new AmtError("Google refused to refresh the Gmail token.", {
      detail: payload?.error_description ?? `HTTP ${response.status}`,
      hint: "Run `npx awesome-monash-tools login gmail` again.",
    });
  }
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token ?? refreshToken,
    expires_at: Number(Date.now() + (payload.expires_in ?? 3_500) * 1_000),
    scope: payload.scope,
    token_type: "Bearer",
  };
}

/** Runs the loopback browser flow and resolves with the tokens once Google redirects back. */
export async function loopbackLogin(
  config: GoogleClientConfig,
  options: { openBrowser?: (url: string) => Promise<void> | void; timeoutMs?: number } = {},
): Promise<GmailTokens> {
  const { createServer } = await import("node:http");
  const pkce = createPkce();
  const url = authorizationUrl(config, pkce);

  return new Promise<GmailTokens>((resolve, reject) => {
    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? "/", config.redirectUri);
      if (requestUrl.pathname !== new URL(config.redirectUri).pathname) {
        res.writeHead(404).end("Not found");
        return;
      }
      const code = requestUrl.searchParams.get("code");
      const state = requestUrl.searchParams.get("state");
      const error = requestUrl.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "content-type": "text/html" }).end(page(`Google returned: ${error}`));
        cleanup();
        reject(new AmtError(`Google authorization failed: ${error}`));
        return;
      }
      if (!code || state !== pkce.state) {
        res.writeHead(400, { "content-type": "text/html" }).end(page("Invalid OAuth callback."));
        cleanup();
        reject(new AmtError("Google returned an invalid OAuth callback."));
        return;
      }

      res.writeHead(200, { "content-type": "text/html" }).end(page("Gmail connected. You can close this tab."));
      cleanup();
      exchangeCode(config, code, pkce.verifier)
        .then(resolve)
        .catch(reject);
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new AmtError("Timed out waiting for the Google login."));
    }, options.timeoutMs ?? 5 * 60_000);

    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };

    server.on("error", (error) => {
      cleanup();
      reject(error);
    });

    server.listen(Number(new URL(config.redirectUri).port) || 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      if (port && String(port) !== new URL(config.redirectUri).port) {
        cleanup();
        reject(
          new AmtError(`Port ${new URL(config.redirectUri).port} is busy.`, {
            hint: `Free the port or pass --port and add http://127.0.0.1:<port>/oauth/google/callback to the OAuth client.`,
          }),
        );
        return;
      }
      void options.openBrowser?.(url);
      process.stderr.write(`\nOpen this URL if the browser did not open:\n${url}\n\n`);
    });
  });
}

function page(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Gmail</title><body style="font:16px system-ui;padding:3rem">${message}</body>`;
}
