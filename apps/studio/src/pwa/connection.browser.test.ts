import { describe, expect, test, vi } from "vitest";
import { isOnline, provideServices, subscribeOnline } from "@/contracts";
import { reportConnectionFailure } from "@/contracts/services";
import { onCleanup } from "../../test/harness";
import { createConnection, probeOrigin, type ConnectionDeps } from "./connection";
import { manualTimers } from "./test-support";

function setup(options: { onLine?: boolean; reachable?: boolean } = {}) {
  const target = new EventTarget();
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  let onLine = options.onLine ?? true;
  let reachable = options.reachable ?? true;
  const probe = vi.fn(async () => reachable);
  const timers = manualTimers();
  const deps: ConnectionDeps = {
    target,
    page,
    onLine: () => onLine,
    probe,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
  };
  const connection = createConnection(deps);
  onCleanup(() => connection.dispose());
  const changes: boolean[] = [];
  connection.subscribe((online) => changes.push(online));
  return {
    connection,
    probe,
    timers,
    changes,
    page,
    goOffline() {
      onLine = false;
      target.dispatchEvent(new Event("offline"));
    },
    goOnline() {
      onLine = true;
      target.dispatchEvent(new Event("online"));
    },
    setReachable(value: boolean) {
      reachable = value;
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createConnection", () => {
  test("starts from navigator.onLine and runs no probe on creation", () => {
    expect(setup({ onLine: false }).connection.isOnline()).toBe(false);
    const online = setup();
    expect(online.connection.isOnline()).toBe(true);
    expect(online.probe).not.toHaveBeenCalled();
  });

  test("follows the browser's offline and online events", () => {
    const s = setup();
    s.goOffline();
    expect(s.connection.isOnline()).toBe(false);
    s.goOnline();
    expect(s.connection.isOnline()).toBe(true);
    expect(s.changes).toEqual([false, true]);
  });

  test("a reported failure probes Studio's origin, and stays online when it answers", async () => {
    const s = setup();
    s.connection.reportFailure();
    await settle();
    expect(s.probe).toHaveBeenCalledTimes(1);
    expect(s.connection.isOnline()).toBe(true);
    expect(s.changes).toEqual([]);
  });

  test("goes offline when the origin doesn't answer, though the browser says online, and retries every 15 s", async () => {
    const s = setup({ reachable: false });
    s.connection.reportFailure();
    await settle();
    expect(s.connection.isOnline()).toBe(false);
    expect(s.changes).toEqual([false]);
    s.timers.advance(15_000);
    await settle();
    expect(s.probe).toHaveBeenCalledTimes(2);
    s.setReachable(true);
    s.timers.advance(15_000);
    await settle();
    expect(s.connection.isOnline()).toBe(true);
    expect(s.changes).toEqual([false, true]);
    expect(s.timers.pending()).toBe(0);
  });

  test("probes again when the tab becomes visible", async () => {
    const s = setup({ reachable: false });
    s.connection.reportFailure();
    await settle();
    s.setReachable(true);
    s.page.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(s.connection.isOnline()).toBe(true);
  });

  test("runs one probe at a time, and none while the browser says offline", async () => {
    const s = setup();
    s.connection.reportFailure();
    s.connection.reportFailure();
    await settle();
    expect(s.probe).toHaveBeenCalledTimes(1);
    s.goOffline();
    s.connection.reportFailure();
    await settle();
    expect(s.probe).toHaveBeenCalledTimes(1);
  });

  test("dispose stops listening", () => {
    const s = setup();
    s.connection.dispose();
    s.goOffline();
    expect(s.changes).toEqual([]);
  });
});

describe("probeOrigin", () => {
  test("any answer means online, a failed request offline", async () => {
    expect(await probeOrigin("/sw.js")()).toBe(true);
    expect(await probeOrigin("http://localhost:0/unreachable")()).toBe(false);
  });
});

describe("as the app's connection service", () => {
  test("isOnline() and subscribers follow it, which Deploy's reason and the chain module read", async () => {
    const s = setup({ reachable: false });
    onCleanup(provideServices({ connection: s.connection }));
    const heard: boolean[] = [];
    onCleanup(subscribeOnline((online) => heard.push(online)));
    expect(isOnline()).toBe(true);
    s.connection.reportFailure();
    await settle();
    expect(isOnline()).toBe(false);
    expect(heard).toContain(false);
  });

  test("the contracts' reportConnectionFailure() (S8a's failed RPC calls) runs the origin probe", async () => {
    const s = setup({ reachable: false });
    onCleanup(provideServices({ connection: s.connection }));
    reportConnectionFailure();
    await settle();
    expect(s.probe).toHaveBeenCalledTimes(1);
    expect(isOnline()).toBe(false);
  });

  test("check() resolves with the state after the probe, sharing one probe between callers", async () => {
    const s = setup({ reachable: false });
    const [a, b] = await Promise.all([s.connection.check(), s.connection.check()]);
    expect([a, b]).toEqual([false, false]);
    expect(s.probe).toHaveBeenCalledTimes(1);
    s.goOffline();
    expect(await s.connection.check()).toBe(false);
    expect(s.probe).toHaveBeenCalledTimes(1);
  });
});
