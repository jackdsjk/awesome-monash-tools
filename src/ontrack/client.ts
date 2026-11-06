import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { AmtError, notConnected, sessionRejected } from "../core/errors.js";
import { request } from "../core/http.js";
import { downloadsDir } from "../core/config.js";

export interface OnTrackCredentials {
  baseUrl: string;
  username: string;
  refreshToken: string;
  userId?: number;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export interface OnTrackAccount {
  userId: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
}

export interface OnTrackProject {
  id: number;
  unitId: number;
  unitCode: string;
  unitName: string;
}

export interface OnTrackTask {
  id: number;
  taskDefinitionId: number;
  abbreviation: string;
  name: string;
  description: string;
  status: string;
  dueDate: string | null;
  targetDueDate: string | null;
  submissionDate: string | null;
  completionDate: string | null;
  weighting: number | null;
  timesAssessed: number;
  numNewComments: number;
}

export interface OnTrackComment {
  id: string;
  type: string;
  comment: string;
  createdAt: string;
  authorId: number | null;
  authorName: string;
}

export interface OnTrackArtifact {
  body: Buffer;
  contentType: string;
}

interface MintedAuth {
  token: string;
  expiresAt: number;
  user: { id?: number; username?: string; email?: string; first_name?: string; last_name?: string } | null;
}

const TOKEN_MARGIN_MS = 60_000;

export class OnTrackClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly refreshToken: string;
  private readonly fetcher: typeof fetch;
  private auth: MintedAuth | null = null;

  constructor(credentials: OnTrackCredentials, fetcher: typeof fetch = fetch) {
    this.baseUrl = credentials.baseUrl.replace(/\/+$/, "");
    this.username = credentials.username;
    this.refreshToken = credentials.refreshToken;
    this.fetcher = fetcher;
  }

  get siteUrl(): string {
    return this.baseUrl.replace(/\/api\/?$/, "");
  }

  async mintAccessToken(): Promise<MintedAuth> {
    const response = await this.fetcher(`${this.baseUrl}/auth/access-token`, {
      method: "POST",
      headers: {
        accept: "application/json",
        cookie: `refresh_token=${sanitize(this.refreshToken)}; username=${sanitize(this.username)}`,
      },
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      throw new AmtError("Could not reach OnTrack.", {
        detail: error instanceof Error ? error.message : String(error),
        hint: "Check your network or VPN, then retry.",
      });
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 419) throw sessionRejected("ontrack", response.status);
      throw new AmtError(`OnTrack login returned HTTP ${response.status}.`, { status: response.status });
    }

    const body = (await response.json().catch(() => null)) as
      | { auth_token?: string; auth_token_expiry?: string; user?: MintedAuth["user"] }
      | null;
    if (!body?.auth_token) {
      throw new AmtError("OnTrack did not return an access token.", {
        hint: "Run `npx awesome-monash-tools login ontrack` again.",
      });
    }
    const expiresAt = body.auth_token_expiry ? Date.parse(body.auth_token_expiry) : Date.now() + 5 * 60_000;
    return {
      token: body.auth_token,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + 5 * 60_000,
      user: body.user ?? null,
    };
  }

  private async token(): Promise<string> {
    if (this.auth && this.auth.expiresAt - Date.now() > TOKEN_MARGIN_MS) return this.auth.token;
    this.auth = await this.mintAccessToken();
    return this.auth.token;
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.token();
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      headers: { accept: "application/json", "auth-token": token, username: this.username },
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => {
      throw new AmtError("Could not reach OnTrack.", {
        detail: error instanceof Error ? error.message : String(error),
        hint: "Check your network or VPN, then retry.",
      });
    });

    if (response.status === 401 || response.status === 419) throw sessionRejected("ontrack", response.status);
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new AmtError(`OnTrack request failed (HTTP ${response.status}).`, {
        status: response.status,
        detail: detail.slice(0, 400) || undefined,
      });
    }
    return (await response.json()) as T;
  }

  async whoami(): Promise<OnTrackAccount> {
    const auth = this.auth ?? (this.auth = await this.mintAccessToken());
    const user = auth.user;
    return {
      userId: Number(user?.id ?? 0),
      username: user?.username ?? this.username,
      firstName: user?.first_name ?? "",
      lastName: user?.last_name ?? "",
      email: user?.email ?? "",
    };
  }

  async listProjects(): Promise<OnTrackProject[]> {
    const raw = await this.get<Array<{ id?: number; unit?: { id?: number; code?: string; name?: string } }>>("/projects");
    return raw
      .filter((project) => typeof project.id === "number" && typeof project.unit?.id === "number")
      .map((project) => ({
        id: Number(project.id),
        unitId: Number(project.unit?.id),
        unitCode: project.unit?.code ?? "",
        unitName: project.unit?.name ?? "",
      }));
  }

  async listTasks(projectId: number): Promise<OnTrackTask[]> {
    const detail = await this.get<{ unit_id?: number; tasks?: Array<Record<string, unknown>> }>(`/projects/${projectId}`);
    const definitions = await this.definitions(Number(detail.unit_id ?? 0));
    return (detail.tasks ?? []).map((task) => {
      const taskDefinitionId = Number(task.task_definition_id ?? 0);
      const definition = definitions.get(taskDefinitionId);
      return {
        id: Number(task.id ?? 0),
        taskDefinitionId,
        abbreviation: definition?.abbreviation ?? "",
        name: definition?.name ?? "",
        description: definition?.description ?? "",
        status: String(task.status ?? ""),
        dueDate: dateOnly(task.due_date),
        targetDueDate: dateOnly(task.target_due_date),
        submissionDate: dateOnly(task.submission_date),
        completionDate: dateOnly(task.completion_date),
        weighting: definition?.weighting ?? null,
        timesAssessed: Number(task.times_assessed ?? 0),
        numNewComments: Number(task.num_new_comments ?? 0),
      };
    });
  }

  private async definitions(unitId: number): Promise<Map<number, { abbreviation: string; name: string; description: string; weighting: number | null }>> {
    const map = new Map<number, { abbreviation: string; name: string; description: string; weighting: number | null }>();
    if (!unitId) return map;
    const unit = await this.get<{ task_definitions?: Array<Record<string, unknown>> }>(`/units/${unitId}`);
    for (const definition of unit.task_definitions ?? []) {
      const id = Number(definition.id ?? 0);
      if (!id) continue;
      map.set(id, {
        abbreviation: String(definition.abbreviation ?? ""),
        name: String(definition.name ?? ""),
        description: String(definition.description ?? ""),
        weighting: typeof definition.weighting === "number" ? definition.weighting : null,
      });
    }
    return map;
  }

  async listComments(projectId: number, taskDefinitionId: number): Promise<OnTrackComment[]> {
    const raw = await this.get<Array<Record<string, unknown>>>(
      `/projects/${projectId}/task_def_id/${taskDefinitionId}/comments`,
    );
    return raw.map((comment) => {
      const author = (comment.author ?? {}) as Record<string, unknown>;
      const authorId = Number(author.id ?? 0);
      const first = String(author.first_name ?? "");
      const last = String(author.last_name ?? "");
      return {
        id: String(comment.id ?? ""),
        type: String(comment.type ?? ""),
        comment: String(comment.comment ?? ""),
        createdAt: String(comment.created_at ?? ""),
        authorId: Number.isFinite(authorId) && authorId > 0 ? authorId : null,
        authorName: `${first} ${last}`.trim(),
      };
    });
  }

  /** Read-only artifact fetch: task sheets, resources and submission PDFs live behind the same auth. */
  async download(path: string): Promise<OnTrackArtifact> {
    const token = await this.token();
    const response = await request(
      `${this.baseUrl}${path}`,
      {
        headers: { accept: "*/*", "auth-token": token, username: this.username },
        timeoutMs: 60_000,
      },
      this.fetcher,
    );
    if (response.status === 401 || response.status === 419) throw sessionRejected("ontrack", response.status);
    if (!response.ok) throw new AmtError(`OnTrack download failed (HTTP ${response.status}).`, { status: response.status });
    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  /** Save an artifact under the config directory and return the absolute path. */
  async downloadToFile(path: string, filename?: string): Promise<{ path: string; bytes: number; contentType: string }> {
    if (!path.startsWith("/")) {
      throw new AmtError("OnTrack paths must start with `/`.", { hint: "Pass the path returned by ontrack_list_tasks or the project JSON." });
    }
    const artifact = await this.download(path);
    const safeName = sanitizeFilename(filename ?? path.split("/").pop() ?? "ontrack-file");
    const target = join(downloadsDir(), safeName);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, artifact.body);
    return { path: normalize(target), bytes: artifact.body.byteLength, contentType: artifact.contentType };
  }

  taskUrl(projectId: number, taskDefinitionId: number): string {
    return `${this.siteUrl}/#/projects/${projectId}/tasks/${taskDefinitionId}`;
  }
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.slice(0, 10);
}

function sanitize(value: string): string {
  return value.replace(/[;\r\n]/g, "");
}

function sanitizeFilename(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\r\n]/g, "_").trim();
  return cleaned || "ontrack-file";
}

export function assertRelativePath(path: string): string {
  if (isAbsolute(path) || path.includes("..")) {
    throw new AmtError("Unsafe OnTrack artifact path.");
  }
  return path;
}

export { notConnected };
