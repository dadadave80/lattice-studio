/**
 * @internal Fakes for the verify engine's tests (`bun test` and Vitest Browser Mode): a manual clock, an in-memory
 * record store and a turn-flusher for interleaving the clock with the engine's own async steps. Never imported by
 * the app.
 */
import type { Deployment } from "@lattice-studio/core";
import type { VerifyClock, VerifyRecords } from "./ports";

export type ManualClock = VerifyClock & { advance(ms: number): void };

export function manualClock(start = Date.parse("2026-09-23T12:00:00.000Z")): ManualClock {
  let now = start;
  let seq = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    now: () => now,
    setTimeout(run, ms) {
      seq += 1;
      timers.set(seq, { at: now + ms, run });
      return seq;
    },
    clearTimeout(handle) {
      if (typeof handle === "number") timers.delete(handle);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
  };
}

function key(d: Pick<Deployment, "chainId" | "address">): string {
  return `${d.chainId}:${d.address.toLowerCase()}`;
}

export type FakeRecords = VerifyRecords & {
  all(): Deployment[];
  set(d: Deployment): void;
  /** Every write's `verification`, in order (retry's own write, then the job's). */
  writes(): Deployment["verification"][];
};

export function memoryRecords(initial: readonly Deployment[] = []): FakeRecords {
  const map = new Map(initial.map((d) => [key(d), d]));
  const history: Deployment["verification"][] = [];
  return {
    list: async (projectId) => [...map.values()].filter((d) => d.projectId === projectId),
    put: async (d) => {
      map.set(key(d), d);
      history.push(d.verification);
    },
    all: () => [...map.values()],
    set: (d) => void map.set(key(d), d),
    writes: () => [...history],
  };
}

/** Lets pending promise chains (not the manual clock's timers) settle before the test drives the clock again. */
export async function flush(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
}
