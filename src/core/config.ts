import { homedir } from "node:os";
import { join } from "node:path";

/** Config root: `~/.config/awesome-monash-tools` unless `AMT_CONFIG_DIR` is set. */
export function configDir(): string {
  return (
    process.env.AMT_CONFIG_DIR ??
    join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "awesome-monash-tools")
  );
}

export function credentialFile(): string {
  return join(configDir(), "credentials.json");
}

/** Persistent Chrome profile used by `login moodle` / `login ontrack`. */
export function profileDir(source: string): string {
  return join(configDir(), "profiles", source);
}

export function downloadsDir(): string {
  return join(configDir(), "downloads");
}
