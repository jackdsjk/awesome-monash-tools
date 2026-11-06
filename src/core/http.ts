import { AmtError } from "./errors.js";

export interface RequestOptions extends Omit<RequestInit, "signal"> {
  timeoutMs?: number;
  retries?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` with a timeout and bounded retries for 429/5xx. Network and timeout
 * failures are retried too; 4xx responses are returned untouched so callers can
 * decide whether they mean "expired session".
 */
export async function request(
  url: string | URL,
  options: RequestOptions = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const { timeoutMs = 20_000, retries = 2, ...init } = options;
  let lastError: unknown = new Error("Request failed.");

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === retries) return response;

      const retryAfter = Number(response.headers.get("retry-after") ?? "0");
      await sleep(retryAfter > 0 ? Math.min(retryAfter * 1_000, 30_000) : Math.min(8_000, 500 * 2 ** attempt));
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await sleep(Math.min(8_000, 500 * 2 ** attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function jsonRequest<T>(url: string | URL, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, {
    ...options,
    headers: { accept: "application/json", ...(options.headers as Record<string, string> | undefined) },
  });
  const body = await response.text().catch(() => "");
  if (!response.ok) {
    throw new AmtError(`Request to ${hostOf(url)} returned HTTP ${response.status}.`, {
      status: response.status,
      detail: body.slice(0, 600) || undefined,
    });
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new AmtError(`Request to ${hostOf(url)} returned invalid JSON.`, {
      detail: body.slice(0, 600) || undefined,
    });
  }
}

function hostOf(url: string | URL): string {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}
