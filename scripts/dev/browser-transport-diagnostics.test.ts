import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { playwright, PlaywrightBrowserProvider } from "@vitest/browser-playwright";
import type { BrowserContext, CDPSession, Page } from "playwright";
import type { TestProject } from "vitest/node";
import { closeCode, createDiagnosticWriter, socketKind, withBrowserTransportDiagnostics } from "./browser-transport-diagnostics";

const temporary: string[] = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

test("decodes only a valid binary close code without retaining its reason", () => {
  expect(closeCode(Buffer.from([3, 233]).toString("base64"))).toBe(1001);
  expect(closeCode(Buffer.from([3, 232, 115, 101, 99, 114, 101, 116]).toString("base64"))).toBe(1000);
  expect(closeCode("")).toBeNull();
  expect(closeCode("not base64!")).toBeNull();
  expect(closeCode(Buffer.from([1]).toString("base64"))).toBeNull();
});

test("classifies the orchestrator and HMR sockets without exposing query values", () => {
  expect(socketKind("ws://localhost:63463/__vitest_browser_api__?type=orchestrator&token=secret")).toBe("orchestrator");
  expect(socketKind("ws://localhost:63463/__vitest_browser_api__?type=tester&token=secret")).toBe("tester");
  expect(socketKind("ws://localhost:63463/?token=secret")).toBe("hmr");
  expect(socketKind("https://localhost:63463/?token=secret")).toBe("other");
  expect(socketKind("ws://elsewhere.test/private?token=secret")).toBe("other");
  expect(socketKind("invalid")).toBe("other");
});

test("caps the entire JSONL file and writes a final truncation marker", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-transport-")); temporary.push(root);
  const write = createDiagnosticWriter(join(root, "events.jsonl"), 300);
  for (let i = 0; i < 100; i++) write({ event: "sample", index: i });
  const text = readFileSync(join(root, "events.jsonl"), "utf8");
  expect(Buffer.byteLength(text)).toBeLessThanOrEqual(300);
  const records = text.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(records.at(-1)?.event).toBe("output-limit");
  expect(records.filter((record) => record.event === "output-limit")).toHaveLength(1);
  expect(() => createDiagnosticWriter(join(root, "events.jsonl"))).toThrow();
  expect(readFileSync(join(root, "events.jsonl"), "utf8")).toBe(text);
});

test("an unavailable measurement output cannot interrupt the suite", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-transport-")); temporary.push(root);
  const write = createDiagnosticWriter(join(root, "events.jsonl"));
  rmSync(root, { recursive: true });
  expect(() => write({ event: "sample" })).not.toThrow();
  expect(() => write({ event: "sample" })).not.toThrow();
});

async function within<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Optional observation blocked the provider.")), 150);
    })]);
  } finally { clearTimeout(timer); }
}

test.each(["session", "enable", "sample", "detach"])("a hung CDP %s cannot block the provider or hide its original close error", async (stage) => {
  const root = mkdtempSync(join(tmpdir(), "studio-transport-")); temporary.push(root);
  const never = () => new Promise<never>(() => {});
  let markReached: () => void = () => {};
  const reached = new Promise<void>((resolve) => { markReached = resolve; });
  let resolveLate: (value: CDPSession) => void = () => {};
  const lateSession = new Promise<CDPSession>((resolve) => { resolveLate = resolve; });
  let detachCalls = 0;
  const cdp = Object.assign(new EventEmitter(), {
    send: (method: string) => {
      if (stage === "enable" && method.endsWith(".enable") || stage === "sample" && method.includes("get")) { markReached(); return never(); }
      return Promise.resolve(method === "Memory.getDOMCounters" ? { documents: 1, nodes: 1, jsEventListeners: 0 } : { usedSize: 1, totalSize: 1 });
    },
    detach: () => { detachCalls++; if (stage === "detach") { markReached(); return never(); } return Promise.resolve(); },
  }) as unknown as CDPSession;
  const context = Object.assign(new EventEmitter(), { newCDPSession: stage === "session" ? () => { markReached(); return lateSession; } : () => Promise.resolve(cdp) });
  const frame = { url: () => "http://localhost:63463/__vitest_test__/" };
  const events = Object.assign(new EventEmitter(), { context: () => context, mainFrame: () => frame, frames: () => [frame], url: frame.url });
  const page = events as unknown as Page;
  // Exercise the real public-provider wrapper while replacing only browser I/O with deterministic faults.
  const instance = Object.create(PlaywrightBrowserProvider.prototype) as PlaywrightBrowserProvider;
  instance.contexts = new Map(); instance.pages = new Map(); instance.browser = null;
  let openingFailure: Error | undefined;
  instance.openPage = async (id) => {
    if (openingFailure) throw openingFailure;
    instance.contexts.set(id, context as unknown as BrowserContext);
    instance.pages.set(id, page);
    context.emit("page", page);
  };
  const original = new Error("Original provider close failure.");
  instance.close = async () => { throw original; };
  const project = { vite: { ws: new EventEmitter() } } as unknown as TestProject;
  const wrapped = withBrowserTransportDiagnostics({ ...playwright(), providerFactory: () => instance }, root).providerFactory(project);
  await expect(within(wrapped.openPage("session", frame.url(), { parallel: false }))).resolves.toBeUndefined();
  if (stage !== "detach") await within(reached);
  openingFailure = new Error("Original provider open failure.");
  await expect(within(wrapped.openPage("session", frame.url(), { parallel: false }))).rejects.toBe(openingFailure);
  if (stage === "session") {
    await new Promise((resolve) => setTimeout(resolve, 2_050));
    expect(events.listenerCount("close")).toBe(0);
    expect(readFileSync(join(root, "lifecycle.jsonl"), "utf8")).toContain("cdp-unavailable");
    resolveLate(cdp);
    await Promise.resolve();
    expect(detachCalls).toBe(1);
  }
  events.emit("close");
  if (stage === "detach") await within(reached);
  expect(events.listenerCount("close")).toBe(0);
  expect(events.listenerCount("crash")).toBe(0);
  expect(events.listenerCount("framenavigated")).toBe(0);
  await expect(within(Promise.resolve(wrapped.close()))).rejects.toBe(original);
  expect(events.listenerCount("close")).toBe(0);
  expect(events.listenerCount("crash")).toBe(0);
  expect(events.listenerCount("framenavigated")).toBe(0);
  expect(context.listenerCount("page")).toBe(0);
  expect((cdp as unknown as EventEmitter).eventNames()).toHaveLength(0);
});
