import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { credentialFile } from "./config.js";

type Stored = Record<string, Record<string, unknown> | undefined>;

/**
 * One JSON file for every source, written atomically with 0600 permissions.
 *
 * It is deliberately plain JSON rather than a keychain: MCP servers are spawned
 * by the host on every session, and a file works identically on macOS, Linux
 * and Windows. Anything truly secret still belongs in an environment variable.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readAll(): Promise<Stored> {
  try {
    const raw = await readFile(credentialFile(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Stored) : {};
  } catch (error) {
    // A missing or corrupt file is recoverable: the next login rewrites it.
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return {};
    throw error;
  }
}

async function writeAll(data: Stored): Promise<void> {
  const file = credentialFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
  await chmod(file, 0o600).catch(() => undefined);
}

export async function readCredential<T>(source: string): Promise<T | null> {
  return serialize(async () => {
    const data = await readAll();
    const value = data[source];
    return value ? (value as T) : null;
  });
}

export async function writeCredential(source: string, value: Record<string, unknown>): Promise<void> {
  return serialize(async () => {
    const data = await readAll();
    data[source] = value;
    await writeAll(data);
  });
}

export async function deleteCredential(source: string): Promise<void> {
  return serialize(async () => {
    const data = await readAll();
    if (!(source in data)) return;
    delete data[source];
    await writeAll(data);
  });
}

export async function credentialSources(): Promise<string[]> {
  return serialize(async () => Object.keys(await readAll()).sort());
}
