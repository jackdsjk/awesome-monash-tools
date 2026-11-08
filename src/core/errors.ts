export interface AmtErrorOptions {
  /** One actionable line shown after the error message. */
  hint?: string;
  /** Upstream body or context, truncated by the caller. */
  detail?: string;
  status?: number;
}

/**
 * Every failure a tool returns goes through this type so the MCP client sees a
 * stable message plus a concrete next step instead of a bare stack trace.
 */
export class AmtError extends Error {
  readonly hint?: string;
  readonly detail?: string;
  readonly status?: number;

  constructor(message: string, options: AmtErrorOptions = {}) {
    super(message);
    this.name = "AmtError";
    this.hint = options.hint;
    this.detail = options.detail;
    this.status = options.status;
  }
}

const SOURCE_LABELS: Record<string, string> = {
  ed: "Ed",
  moodle: "Moodle",
  gmail: "Gmail",
  ontrack: "OnTrack",
  attendance: "Attendance",
};

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function notConnected(source: string): AmtError {
  return new AmtError(`${sourceLabel(source)} is not connected.`, {
    hint: `Run \`npx awesome-monash-tools login ${source}\` to connect it.`,
  });
}

export function sessionRejected(source: string, status: number, detail?: string): AmtError {
  return new AmtError(`${sourceLabel(source)} rejected the saved session (HTTP ${status}).`, {
    hint: `Reconnect with \`npx awesome-monash-tools login ${source}\`.`,
    detail,
    status,
  });
}
