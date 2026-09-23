// Runs Solidity harness tests inside a Lattice checkout without leaving anything behind: the files go into a
// uniquely named folder under test/, `forge test` runs only that folder with the ci profile, and the folder is
// deleted even when forge fails or the run is interrupted.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export class SetupError extends Error {
  override name = "SetupError";
}

/**
 * The Lattice checkout to run against: `$LATTICE_DIR`, else `LATTICE_DIR` in the repo's `.env.local`, else the
 * repo's `lattice/` submodule. Relative paths resolve against the repo root.
 */
export function latticeDir(env: Record<string, string | undefined> = process.env, root = REPO_ROOT): string {
  let dir = env["LATTICE_DIR"];
  if (!dir) {
    const file = join(root, ".env.local");
    if (existsSync(file)) dir = readEnvValue(readFileSync(file, "utf8"), "LATTICE_DIR");
  }
  dir = dir ? (isAbsolute(dir) ? dir : resolve(root, dir)) : join(root, "lattice");
  if (!existsSync(join(dir, "foundry.toml"))) {
    throw new SetupError(`No Lattice checkout at ${dir} (no foundry.toml). Set LATTICE_DIR or run git submodule update --init.`);
  }
  return dir;
}

/** The value of `key` in dotenv-style text, without quotes; undefined when absent. */
export function readEnvValue(text: string, key: string): string | undefined {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq).replace(/^export\s+/, "").trim() !== key) continue;
    return line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}

export type ForgeTest = { suite: string; test: string; ok: boolean; reason: string | null; logs: string[] };
export type ForgeRun = { exitCode: number; tests: ForgeTest[]; output: string };

/**
 * Copies `files` into `<lattice>/test/<folder>/`, runs `forge test` on that folder only and returns each test's
 * status and decoded console logs. The folder is removed before this returns or throws, and on SIGINT/SIGTERM.
 */
export async function runForgeHarness(opts: {
  lattice: string;
  files: string[];
  folder?: string;
  timeoutMs?: number;
}): Promise<ForgeRun> {
  if (!Bun.which("forge")) throw new SetupError("forge isn't on PATH. Install Foundry 1.8.3 (contracts §2).");
  const folder = opts.folder ?? `.studio-golden-${process.pid}`;
  const rel = `test/${folder}`;
  const dir = join(opts.lattice, rel);
  if (existsSync(dir)) throw new SetupError(`${dir} already exists; another run may be using it.`);

  let child: { kill(): void } | undefined;
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const onSignal = (signal: NodeJS.Signals) => {
    child?.kill();
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    mkdirSync(dir, { recursive: true });
    for (const f of opts.files) copyFileSync(f, join(dir, basename(f)));
    const jsonFile = join(dir, "result.json");
    const proc = Bun.spawn(
      ["forge", "test", "--root", opts.lattice, "--match-path", `${rel}/*`, "--json-file", jsonFile, "-vv"],
      {
        cwd: opts.lattice,
        env: { ...process.env, FOUNDRY_PROFILE: "ci" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    child = proc;
    const timer = setTimeout(() => proc.kill(), opts.timeoutMs ?? 600_000);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    const output = `${stdout}${stderr}`;
    const tests = existsSync(jsonFile) ? parseForgeJson(readFileSync(jsonFile, "utf8")) : [];
    return { exitCode, tests, output };
  } finally {
    cleanup();
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

/** Reads `forge test --json` output: `{ "<path>:<Contract>": { test_results: { "<test>()": {...} } } }`. */
export function parseForgeJson(text: string): ForgeTest[] {
  const json: unknown = JSON.parse(text);
  const tests: ForgeTest[] = [];
  if (!isObject(json)) return tests;
  for (const [suite, value] of Object.entries(json)) {
    const results = isObject(value) ? value["test_results"] : undefined;
    if (!isObject(results)) continue;
    for (const [test, r] of Object.entries(results)) {
      if (!isObject(r)) continue;
      const logs = Array.isArray(r["decoded_logs"]) ? r["decoded_logs"].filter((l) => typeof l === "string") : [];
      const reason = typeof r["reason"] === "string" ? r["reason"] : null;
      tests.push({ suite, test, ok: r["status"] === "Success", reason, logs });
    }
  }
  return tests;
}

/**
 * Function signatures from Lattice's build output. `artifact` is a Foundry artifact id such as
 * "ERC20.sol:ERC20" or "src/tokens/ERC20/ERC20.sol:ERC20"; its methodIdentifiers map signatures to selectors.
 */
export function artifactSignatures(lattice: string): (artifact: string, selector: string) => string | undefined {
  const cache = new Map<string, Map<string, string>>();
  return (artifact, selector) => {
    let table = cache.get(artifact);
    if (!table) {
      table = new Map();
      for (const [sig, hex] of Object.entries(readMethodIds(lattice, artifact))) table.set(`0x${hex.toLowerCase()}`, sig);
      cache.set(artifact, table);
    }
    return table.get(selector);
  };
}

function readMethodIds(lattice: string, artifact: string): Record<string, string> {
  const colon = artifact.lastIndexOf(":");
  if (colon < 0) throw new SetupError(`"${artifact}" isn't an artifact id (<file>.sol:<Contract>).`);
  const file = artifact.slice(0, colon);
  const name = artifact.slice(colon + 1);
  const hasDir = dirname(file) !== ".";
  const candidates = [join(lattice, "out", basename(file), `${name}.json`)];
  for (const p of new Bun.Glob(`**/${basename(file)}/${name}.json`).scanSync({ cwd: join(lattice, "out") })) {
    candidates.push(join(lattice, "out", p));
  }
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const json: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isObject(json)) continue;
    const target = compilationTarget(json);
    if (hasDir ? target !== file : !target?.endsWith(basename(file))) continue;
    const ids = json["methodIdentifiers"];
    if (isObject(ids)) return Object.fromEntries(Object.entries(ids).filter((e): e is [string, string] => typeof e[1] === "string"));
  }
  throw new SetupError(`No build artifact for ${artifact} under ${join(lattice, "out")}. Build Lattice with the ci profile.`);
}

function compilationTarget(json: Record<string, unknown>): string | undefined {
  const meta = json["metadata"];
  const settings = isObject(meta) ? meta["settings"] : undefined;
  const target = isObject(settings) ? settings["compilationTarget"] : undefined;
  return isObject(target) ? Object.keys(target)[0] : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
