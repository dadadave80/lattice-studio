/**
 * @internal Fakes for the PWA module's tests: timers that advance by hand, a service worker (workbox-window's
 * surface), and a save status that changes on demand.
 */
import type { SaveStatus } from "@/contracts";
import type { WorkboxLike } from "./updates";

export type ManualTimers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  /** Runs everything due within `ms`, in time order. */
  advance(ms: number): void;
  pending(): number;
};

export function manualTimers(): ManualTimers {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const clear = (handle: unknown) => void timers.delete(handle as number);
  return {
    setTimeout(fn, ms) {
      next += 1;
      timers.set(next, { at: now + ms, fn });
      return next;
    },
    clearTimeout: clear,
    setInterval(fn, ms) {
      next += 1;
      timers.set(next, { at: now + ms, fn, every: ms });
      return next;
    },
    clearInterval: clear,
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [handle, timer] = due;
        now = timer.at;
        if (timer.every) timers.set(handle, { ...timer, at: timer.at + timer.every });
        else timers.delete(handle);
        timer.fn();
      }
      now = until;
    },
    pending: () => timers.size,
  };
}

type Listener = (event: { isExternal?: boolean }) => void;

/** A service worker registration as workbox-window reports it. */
export type FakeWorkbox = WorkboxLike & {
  /** A new version installed and is waiting. */
  emitWaiting(): void;
  /** A worker took control; `isExternal` when another tab activated it. */
  emitControlling(isExternal: boolean): void;
  skipWaitingCalls: number;
  updateCalls: number;
  /** What the next `update()` does. */
  failUpdate: boolean;
};

export function fakeWorkbox(): FakeWorkbox {
  const listeners = { waiting: new Set<Listener>(), controlling: new Set<Listener>() };
  const fake: FakeWorkbox = {
    addEventListener: (type, fn) => void listeners[type].add(fn),
    removeEventListener: (type, fn) => void listeners[type].delete(fn),
    messageSkipWaiting() {
      fake.skipWaitingCalls += 1;
    },
    update() {
      fake.updateCalls += 1;
      return fake.failUpdate ? Promise.reject(new TypeError("Failed to fetch")) : Promise.resolve();
    },
    emitWaiting: () => {
      for (const fn of Array.from(listeners.waiting)) fn({});
    },
    emitControlling: (isExternal) => {
      for (const fn of Array.from(listeners.controlling)) fn({ isExternal });
    },
    skipWaitingCalls: 0,
    updateCalls: 0,
    failUpdate: false,
  };
  return fake;
}

export const SAVED: SaveStatus = { state: "saved", text: "Saved" };
export const SAVING: SaveStatus = { state: "saving", text: "Saving…" };
export const READ_ONLY: SaveStatus = { state: "read-only", text: "Read-only" };
export const STORAGE_FULL: SaveStatus = { state: "not-saved", text: "Not saved: browser storage is full" };

/** A save status the test sets; subscribers hear each change. */
export function fakeSaveStatus(initial: SaveStatus): {
  get(): SaveStatus;
  set(status: SaveStatus): void;
  subscribe(listener: (status: SaveStatus) => void): () => void;
} {
  let status = initial;
  const listeners = new Set<(status: SaveStatus) => void>();
  return {
    get: () => status,
    set(next) {
      status = next;
      for (const fn of Array.from(listeners)) fn(next);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
