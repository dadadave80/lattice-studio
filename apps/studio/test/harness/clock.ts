/**
 * `fakeClock()`: a controllable clock behind the `now` service, so console lines, "saved 2 min ago" and
 * timeouts are deterministic. Pass Vitest's `vi` as `timers` (after `vi.useFakeTimers()`) to move timers
 * and `Date` with it. Free of Vitest imports, so `bun test` can use it too.
 */
import { provideServices } from "@/contracts";
import { onCleanup } from "./cleanup";

/** The subset of Vitest's `vi` (or any fake-timer API) the clock drives. */
export type FakeTimers = {
  advanceTimersByTime(ms: number): unknown;
  setSystemTime?(time: number): unknown;
};

export type FakeClockOptions = {
  /** Start time: an ISO string or epoch milliseconds. Default 2026-01-01T00:00:00.000Z. */
  at?: string | number;
  timers?: FakeTimers;
};

export type FakeClock = {
  now(): number;
  /** The current time as an ISO string, as console lines stamp it. */
  iso(): string;
  set(time: string | number): void;
  /** Moves the clock, and fake timers when given, forward by `ms`. */
  advance(ms: number): void;
  /** Puts the previous clock back. The harness also does this after each test. */
  restore(): void;
};

const DEFAULT_START = "2026-01-01T00:00:00.000Z";

function toMillis(time: string | number): number {
  const ms = typeof time === "number" ? time : Date.parse(time);
  if (Number.isNaN(ms)) throw new Error(`fakeClock: "${time}" isn't a time.`);
  return ms;
}

export function fakeClock(options: FakeClockOptions = {}): FakeClock {
  let current = toMillis(options.at ?? DEFAULT_START);
  const { timers } = options;
  timers?.setSystemTime?.(current);
  const dispose = provideServices({ now: () => current });
  let restored = false;
  const clock: FakeClock = {
    now: () => current,
    iso: () => new Date(current).toISOString(),
    set(time) {
      current = toMillis(time);
      timers?.setSystemTime?.(current);
    },
    advance(ms) {
      current += ms;
      timers?.advanceTimersByTime(ms);
    },
    restore() {
      if (restored) return;
      restored = true;
      dispose();
    },
  };
  onCleanup(() => clock.restore());
  return clock;
}
