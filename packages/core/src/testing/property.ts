/**
 * Seeded property runs for the property and hostile-input suites (spec L932, L936). Every property runs at
 * least `MIN_RUNS` times from a seed fixed by its name, so a run is the same on every machine; a failure throws
 * with the seed, the shrunk counterexample path and the command that replays just that property:
 *
 *   LATTICE_FC_PROPERTY="<name>" LATTICE_FC_SEED=<seed> LATTICE_FC_PATH=<path> bun test packages/core/test/properties
 *
 * `LATTICE_FC_SEED` and `LATTICE_FC_PATH` apply to the property `LATTICE_FC_PROPERTY` names; without a name,
 * the seed applies to every property (a fresh search) and the path to none. `LATTICE_FC_RUNS` raises the run
 * count (never below the property's own minimum).
 */
import fc from "fast-check";

/** The fewest runs any property gets (C12 "Done when"). */
export const MIN_RUNS = 200;

/** How one property runs: its seed, its run count and, when replaying, the counterexample path. */
export type PropertyRun = { seed: number; numRuns: number; path?: string };

/** Environment variables a replay reads; `process.env` under Bun or Node, nothing in a browser. */
export type PropertyEnv = Partial<Record<"LATTICE_FC_PROPERTY" | "LATTICE_FC_SEED" | "LATTICE_FC_PATH" | "LATTICE_FC_RUNS", string>>;

function processEnv(): PropertyEnv {
  const proc: unknown = (globalThis as { process?: unknown }).process;
  if (proc === undefined || proc === null || typeof proc !== "object" || !("env" in proc)) return {};
  const env = (proc as { env: unknown }).env;
  return env !== null && typeof env === "object" ? (env as PropertyEnv) : {};
}

/** FNV-1a of the name, as a positive 31-bit seed: each property has its own stable seed. */
export function seedFor(name: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & 0x7fffffff;
}

function integerFrom(text: string | undefined): number | undefined {
  if (text === undefined || !/^-?[0-9]+$/.test(text.trim())) return undefined;
  const value = Number(text.trim());
  return Number.isSafeInteger(value) ? value : undefined;
}

/** The seed, run count and replay path for property `name`, from its defaults and the environment. */
export function propertyRun(name: string, runs = MIN_RUNS, env: PropertyEnv = processEnv()): PropertyRun {
  const floor = Math.max(runs, MIN_RUNS);
  const target = env.LATTICE_FC_PROPERTY;
  const named = target !== undefined && target !== "";
  const mine = named && target === name;
  const seed = named && !mine ? undefined : integerFrom(env.LATTICE_FC_SEED);
  const run: PropertyRun = {
    seed: seed ?? seedFor(name),
    numRuns: Math.max(floor, integerFrom(env.LATTICE_FC_RUNS) ?? floor),
  };
  const path = env.LATTICE_FC_PATH?.trim();
  if (mine && seed !== undefined && path !== undefined && path !== "") run.path = path;
  return run;
}

/** The message a failed property throws: how to replay it, then fast-check's own report. */
export function failureMessage(name: string, details: fc.RunDetails<unknown>): string {
  const path = details.counterexamplePath ?? "";
  const replay = `LATTICE_FC_PROPERTY=${JSON.stringify(name)} LATTICE_FC_SEED=${details.seed}${path === "" ? "" : ` LATTICE_FC_PATH=${path}`}`;
  const report = fc.defaultReportMessage(details) ?? "no report";
  const cause = details.errorInstance instanceof Error ? details.errorInstance.message : details.errorInstance === null ? "" : String(details.errorInstance);
  return [
    `Property "${name}" failed with seed ${details.seed}${path === "" ? "" : ` at path ${path}`}.`,
    `Replay: ${replay} bun test packages/core/test/properties`,
    ...(cause === "" ? [] : [`Cause: ${cause}`]),
    report,
  ].join("\n");
}

/** What a finished property reports: the runs it made and the seed it used. */
export type PropertyOutcome = { seed: number; runs: number; skipped: number };

/**
 * Runs `property` with `propertyRun(name, runs)` and throws `failureMessage` on a failure. Returns what ran,
 * so a suite can assert that preconditions didn't skip most runs.
 */
export function checkProperty<Ts>(name: string, property: fc.IProperty<Ts>, runs = MIN_RUNS, env?: PropertyEnv): PropertyOutcome {
  const run = propertyRun(name, runs, env);
  const params: fc.Parameters<Ts> = { seed: run.seed, numRuns: run.numRuns, endOnFailure: false };
  if (run.path !== undefined) params.path = run.path;
  const details = fc.check(property, params);
  if (details.failed || details.interrupted) throw new Error(failureMessage(name, details as fc.RunDetails<unknown>));
  return { seed: details.seed, runs: details.numRuns, skipped: details.numSkips };
}
