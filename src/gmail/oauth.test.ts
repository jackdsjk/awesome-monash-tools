import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { authorizationUrl, base64url, createPkce, exchangeCode, refreshTokens } from "./oauth.js";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "http://127.0.0.1:48125/oauth/google/callback",
};

function tokenResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Google OAuth", () => {
  it("builds a PKCE challenge from the verifier", () => {
    const pkce = createPkce();
    expect(pkce.challenge).toBe(base64url(createHash("sha256").update(pkce.verifier).digest()));
    expect(pkce.verifier.length).toBeGreaterThan(40);
  });

  it("asks only for read-only Gmail with offline access", () => {
    const url = new URL(authorizationUrl(config, { challenge: "challenge", state: "state" }));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });

  it("exchanges an authorization code for tokens", async () => {
    const fetcher = vi.fn(async () =>
      tokenResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "gmail.readonly" }),
    );
    const tokens = await exchangeCode(config, "code", "verifier", fetcher as unknown as typeof fetch);
    expect(tokens).toMatchObject({ access_token: "at", refresh_token: "rt" });
    expect(tokens.expires_at).toBeGreaterThan(Date.now() + 3_000_000);

    const body = new URLSearchParams(String((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("verifier");
  });

  it("explains a failed code exchange", async () => {
    const fetcher = vi.fn(async () => tokenResponse({ error_description: "redirect_uri_mismatch" }, 400));
    await expect(exchangeCode(config, "code", "verifier", fetcher as unknown as typeof fetch)).rejects.toMatchObject({
      detail: "redirect_uri_mismatch",
      hint: expect.stringContaining("redirect URI"),
    });
  });

  it("refreshes an access token without dropping the refresh token", async () => {
    const fetcher = vi.fn(async () => tokenResponse({ access_token: "new", expires_in: 3600 }));
    const tokens = await refreshTokens(config, "keep-me", fetcher as unknown as typeof fetch);
    expect(tokens.access_token).toBe("new");
    expect(tokens.refresh_token).toBe("keep-me");
  });

  it("reports a revoked refresh token", async () => {
    const fetcher = vi.fn(async () => tokenResponse({ error: "invalid_grant" }, 400));
    await expect(refreshTokens(config, "revoked", fetcher as unknown as typeof fetch)).rejects.toMatchObject({
      hint: expect.stringContaining("login gmail"),
    });
  });
});
