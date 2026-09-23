/**
 * Ports and paths for the app's configs (contracts §2 "Ports and environment"). Each value comes from
 * `process.env`, then from the repo root's `.env.local` (Vite doesn't load non-`VITE_` variables, and
 * `bun run --cwd` changes where Bun looks for `.env` files), then from the defaults below. Never bind a
 * fixed port: every worktree gets its own from `scripts/wp/claim.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** `apps/studio/`. */
export const appDir = dirname(fileURLToPath(import.meta.url));

/** The repo root (two levels above the app). */
export const repoRoot = join(appDir, "..", "..");

/** The variables the configs read, with their fallbacks. */
export const envDefaults = {
  STUDIO_PORT: "5173",
  VITEST_BROWSER_PORT: "63315",
  PLAYWRIGHT_PORT: "4173",
  ANVIL_PORT_BASE: "8545",
} as const;

export type LocalEnvName = keyof typeof envDefaults;

/** Parses `KEY=value` lines; `#` starts a comment, surrounding quotes are dropped. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let fileCache: Record<string, string> | undefined;

function fromFile(): Record<string, string> {
  if (fileCache) return fileCache;
  const path = join(repoRoot, ".env.local");
  fileCache = existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
  return fileCache;
}

/** One variable: `process.env`, then the repo root's `.env.local`, then `fallback`. */
export function localEnv(name: string, fallback?: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess !== undefined && fromProcess !== "") return fromProcess;
  const file = fromFile()[name];
  if (file !== undefined && file !== "") return file;
  return fallback;
}

/** A port variable as a number, with the default from `envDefaults`. */
export function localPort(name: LocalEnvName): number {
  const value = localEnv(name, envDefaults[name]) ?? envDefaults[name];
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${name} must be a port number; got "${value}".`);
  }
  return port;
}
