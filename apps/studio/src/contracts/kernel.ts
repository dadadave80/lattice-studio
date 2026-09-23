/**
 * The leaf of the contracts: the console log, the clock and randomness. Every other contracts module may
 * import this one; it imports none of them at runtime, so there are no import cycles. `provideServices`
 * (services.ts) replaces `log`, `now` and `randomBytes` through `provideKernel`.
 */
import type { ConsoleLine, LineDraft, Random } from "@lattice-studio/core";

export type Kernel = {
  log(line: ConsoleLine): void;
  now(): number;
  randomBytes: Random;
};

const RECORD_CAP = 1000;

/** Every line logged, delivered or not (capped), so tests can assert console output. */
let recorded: ConsoleLine[] = [];
/** Lines logged before a real log registered; replayed into it when it does. */
let pending: ConsoleLine[] = [];
let provided: Partial<Kernel> = {};

const defaults: Kernel = {
  log: (line) => {
    pending.push(line);
    if (pending.length > RECORD_CAP) pending.splice(0, pending.length - RECORD_CAP);
  },
  now: () => Date.now(),
  randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
};

/** Milliseconds since the epoch, from the injected clock. */
export function now(): number {
  return (provided.now ?? defaults.now)();
}

/** Random bytes, from the injected source. */
export function randomBytes(n: number): Uint8Array {
  return (provided.randomBytes ?? defaults.randomBytes)(n);
}

/** Appends a console line. A draft without `at` is stamped with the injected clock. */
export function log(line: ConsoleLine | LineDraft): void {
  const stamped: ConsoleLine = "at" in line ? line : { ...line, at: new Date(now()).toISOString() };
  recorded.push(stamped);
  if (recorded.length > RECORD_CAP) recorded.splice(0, recorded.length - RECORD_CAP);
  (provided.log ?? defaults.log)(stamped);
}

/**
 * Replaces kernel functions; replays pending lines into a new `log`. Returns a disposer that puts back only
 * what this call provided and nobody has replaced since.
 */
export function provideKernel(next: Partial<Kernel>): () => void {
  const previous = { ...provided };
  provided = { ...provided, ...next };
  if (next.log) for (const line of pending.splice(0)) next.log(line);
  return () => {
    const restored: Partial<Kernel> = { ...provided };
    if (next.log && provided.log === next.log) restoreKey(restored, previous, "log");
    if (next.now && provided.now === next.now) restoreKey(restored, previous, "now");
    if (next.randomBytes && provided.randomBytes === next.randomBytes) restoreKey(restored, previous, "randomBytes");
    provided = restored;
  };
}

function restoreKey<K extends keyof Kernel>(target: Partial<Kernel>, from: Partial<Kernel>, key: K): void {
  if (from[key]) target[key] = from[key];
  else delete target[key];
}

/** @internal Lines logged so far, delivered or not. */
export function recordedLog(): readonly ConsoleLine[] {
  return recorded;
}

/** @internal Clears recorded and pending lines; keeps what's provided. */
export function clearLog(): void {
  recorded = [];
  pending = [];
}

/** @internal Back to the defaults. Returns a disposer that restores what was provided before. */
export function resetKernel(): () => void {
  const saved = { provided, recorded, pending };
  provided = {};
  recorded = [];
  pending = [];
  return () => {
    provided = saved.provided;
    recorded = saved.recorded;
    pending = saved.pending;
  };
}
