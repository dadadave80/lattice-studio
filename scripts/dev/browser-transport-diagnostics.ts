import { appendFileSync, mkdirSync, statfsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { PlaywrightBrowserProvider, type PlaywrightProviderOptions } from "@vitest/browser-playwright";
import type { BrowserProviderOption } from "vitest/node";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";
import type { WebSocket as ViteWebSocket } from "vite";

type RecordEvent = Readonly<Record<string, unknown>>;
type WriteEvent = (event: RecordEvent) => void;

function fingerprint(value: unknown): string | null {
  return typeof value === "string" ? createHash("sha256").update(value).digest("hex").slice(0, 12) : null;
}

/** Binary CDP frame payloads are base64. Keep the status code, never the close reason. */
export function closeCode(payload: string): number | null {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) return null;
  const bytes = Buffer.from(payload, "base64");
  return bytes.length >= 2 ? bytes.readUInt16BE(0) : null;
}

/** Classify local runner sockets without retaining URLs, session IDs or authentication queries. */
export function socketKind(raw: string): "orchestrator" | "tester" | "hmr" | "other" {
  try {
    const url = new URL(raw);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return "other";
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "other";
    if (url.pathname === "/__vitest_browser_api__") {
      return url.searchParams.get("type") === "orchestrator" ? "orchestrator" : "tester";
    }
    return url.pathname === "/" ? "hmr" : "other";
  } catch { return "other"; }
}

/** One bounded file per invocation, including its final marker. Existing evidence is never overwritten. */
export function createDiagnosticWriter(path: string, maximumBytes = 96_000): WriteEvent {
  const marker = `${JSON.stringify({ event: "output-limit" })}\n`;
  const reservedBytes = Buffer.byteLength(marker);
  if (maximumBytes < reservedBytes) throw new RangeError("Diagnostic output limit is too small.");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", { flag: "wx" });
  let bytes = 0;
  let exhausted = false;
  return (event) => {
    if (exhausted) return;
    const line = `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`;
    const length = Buffer.byteLength(line);
    try {
      if (bytes + length + reservedBytes > maximumBytes) {
        appendFileSync(path, marker);
        exhausted = true;
        return;
      }
      appendFileSync(path, line);
      bytes += length;
    } catch {
      exhausted = true;
      console.warn("Browser transport measurements stopped because the output is unavailable.");
    }
  };
}

function pathOnly(raw: string): string {
  try { return new URL(raw).pathname; } catch { return "unknown"; }
}

function observePage(page: Page, session: string, write: WriteEvent, primaryHandshakes: Set<string>): () => void {
  let active = true;
  let sampling = false;
  let cdp: CDPSession | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  const cancellations = new Set<() => void>();
  const cdpListeners: (() => void)[] = [];
  const emit = (event: RecordEvent) => write({ session, ...event });
  const closed = () => { emit({ event: "page-close" }); dispose(); };
  const crashed = () => emit({ event: "page-crash" });
  const navigated = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame === page.mainFrame()) emit({ event: "top-navigation", path: pathOnly(frame.url()) });
  };
  // Stop waiting after two seconds or disposal. A late CDP response must never hold up the provider.
  const bounded = <T>(operation: Promise<T>): Promise<{ value: T } | undefined> => new Promise((resolve) => {
    let finished = false;
    const finish = (result?: { value: T }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cancellations.delete(cancel);
      resolve(result);
    };
    const cancel = () => finish();
    const timer = setTimeout(cancel, 2_000);
    timer.unref();
    cancellations.add(cancel);
    operation.then((value) => finish({ value }), cancel);
  });
  const dispose = () => {
    if (!active) return;
    active = false;
    clearInterval(interval);
    for (const cancel of cancellations) cancel();
    page.off("close", closed);
    page.off("crash", crashed);
    page.off("framenavigated", navigated);
    for (const remove of cdpListeners.splice(0)) remove();
    void cdp?.detach().catch(() => {});
  };
  page.on("close", closed);
  page.on("crash", crashed);
  page.on("framenavigated", navigated);
  const initialize = async () => {
    const creation = page.context().newCDPSession(page);
    // If creation resolves after the observation deadline/teardown, detach the late session too.
    void creation.then((created) => {
      if (!active) void created.detach().catch(() => {});
    }, () => {});
    const created = await bounded(creation);
    if (!active) return;
    if (!created) { emit({ event: "cdp-unavailable" }); dispose(); return; }
    cdp = created.value;
    const sockets = new Map<string, ReturnType<typeof socketKind>>();
    const primarySockets = new Set<string>();
    const observedKinds = new Set<string>();
    const socketCreated = ({ requestId, url }: { requestId: string; url: string }) => {
      const kind = socketKind(url);
      sockets.set(requestId, kind);
      if ((kind === "orchestrator" || kind === "hmr") && !observedKinds.has(kind)) {
        primarySockets.add(requestId);
        observedKinds.add(kind);
        emit({ event: "socket-created", kind });
      }
    };
    cdp.on("Network.webSocketCreated", socketCreated);
    cdpListeners.push(() => cdp!.off("Network.webSocketCreated", socketCreated));
    const handshakeSent = ({ requestId, request }: { requestId: string; request: { headers: Record<string, string> } }) => {
      if (!primarySockets.has(requestId)) return;
      const id = fingerprint(request.headers["Sec-WebSocket-Key"] ?? request.headers["sec-websocket-key"]);
      if (id) {
        primaryHandshakes.add(id);
        emit({ event: "socket-handshake", kind: sockets.get(requestId), id });
      }
    };
    cdp.on("Network.webSocketWillSendHandshakeRequest", handshakeSent);
    cdpListeners.push(() => cdp!.off("Network.webSocketWillSendHandshakeRequest", handshakeSent));
    const socketClosed = ({ requestId }: { requestId: string }) => {
      const kind = sockets.get(requestId) ?? "unknown";
      if (primarySockets.has(requestId)) emit({ event: "socket-closed", kind });
      sockets.delete(requestId);
    };
    cdp.on("Network.webSocketClosed", socketClosed);
    cdpListeners.push(() => cdp!.off("Network.webSocketClosed", socketClosed));
    type FrameEvent = { requestId: string; response: { opcode: number; payloadData: string } };
    const frameSent = ({ requestId, response }: FrameEvent) => {
      if (response.opcode !== 8) return;
      const kind = sockets.get(requestId) ?? "unknown";
      if (primarySockets.has(requestId)) emit({ event: "socket-close-frame", direction: "sent", kind, code: closeCode(response.payloadData) });
    };
    cdp.on("Network.webSocketFrameSent", frameSent);
    cdpListeners.push(() => cdp!.off("Network.webSocketFrameSent", frameSent));
    const frameReceived = ({ requestId, response }: FrameEvent) => {
      if (response.opcode !== 8) return;
      const kind = sockets.get(requestId) ?? "unknown";
      if (primarySockets.has(requestId)) emit({ event: "socket-close-frame", direction: "received", kind, code: closeCode(response.payloadData) });
    };
    cdp.on("Network.webSocketFrameReceived", frameReceived);
    cdpListeners.push(() => cdp!.off("Network.webSocketFrameReceived", frameReceived));
    const targetCrashed = () => emit({ event: "target-crash" });
    cdp.on("Inspector.targetCrashed", targetCrashed);
    cdpListeners.push(() => cdp!.off("Inspector.targetCrashed", targetCrashed));
    const enabled = await bounded(Promise.all([cdp.send("Network.enable"), cdp.send("Inspector.enable")]));
    if (!active) return;
    if (!enabled) { emit({ event: "cdp-enable-unavailable" }); dispose(); return; }
    const sample = async () => {
      if (!active || sampling) return;
      sampling = true;
      try {
        const result = await bounded(Promise.all([cdp!.send("Memory.getDOMCounters"), cdp!.send("Runtime.getHeapUsage")]));
        if (!active) return;
        if (!result) { emit({ event: "resources-unavailable" }); dispose(); return; }
        const [dom, heap] = result.value;
        const disk = statfsSync(tmpdir());
        emit({ event: "resources", frames: page.frames().length, documents: dom.documents, nodes: dom.nodes, listeners: dom.jsEventListeners, heapUsedBytes: heap.usedSize, heapTotalBytes: heap.totalSize, tempAvailableBytes: disk.bavail * disk.bsize, nodeRssBytes: process.memoryUsage().rss });
      } catch { if (active) { emit({ event: "resources-unavailable" }); dispose(); } }
      finally { sampling = false; }
    };
    void sample();
    interval = setInterval(() => void sample(), 5_000);
    interval.unref();
    emit({ event: "page-observed", initialPath: pathOnly(page.url()) });
  };
  void initialize().catch(() => {
    if (active) { emit({ event: "observation-unavailable" }); dispose(); }
  });
  return dispose;
}

/** Opt-in observation through public provider methods; no patching of Vitest internals or browser behavior. */
export function withBrowserTransportDiagnostics(provider: BrowserProviderOption<PlaywrightProviderOptions>, directory: string): BrowserProviderOption<PlaywrightProviderOptions> {
  let write: WriteEvent;
  try { write = createDiagnosticWriter(join(directory, "lifecycle.jsonl")); }
  catch {
    console.warn("Browser transport measurements unavailable; running the unchanged provider.");
    return provider;
  }
  return {
    ...provider,
    providerFactory(project) {
      const instance = provider.providerFactory(project);
      if (!(instance instanceof PlaywrightBrowserProvider)) throw new Error("Browser transport diagnostics require the Playwright provider.");
      const observed = new Map<Page, () => void>();
      const primaryHandshakes = new Set<string>();
      const server = project.browser?.vite ?? project.vite;
      const closeListeners = new Map<ViteWebSocket, (code: number) => void>();
      const onConnection = (socket: ViteWebSocket, request: IncomingMessage) => {
        const id = fingerprint(request.headers["sec-websocket-key"]);
        const onClose = (code: number) => {
          closeListeners.delete(socket);
          if (id && primaryHandshakes.has(id)) write({ event: "hmr-close-code", id, code });
        };
        socket.once("close", onClose);
        closeListeners.set(socket, onClose);
      };
      server.ws.on("connection", onConnection);
      const contextListeners = new Map<BrowserContext, (page: Page) => void>();
      let connectedBrowser: Browser | null = null;
      const disconnected = () => write({ event: "browser-disconnected" });
      const openPage = instance.openPage.bind(instance);
      const close = instance.close.bind(instance);
      const contexts = instance.contexts;
      const setContext = contexts.set.bind(contexts);
      const originalSetContext = contexts.set;
      contexts.set = (id, context) => {
        if (!contextListeners.has(context)) {
          const onPage = (page: Page) => {
            observed.set(page, observePage(page, id, write, primaryHandshakes));
          };
          context.on("page", onPage);
          contextListeners.set(context, onPage);
        }
        return setContext(id, context);
      };
      instance.openPage = async (...args) => {
        await openPage(...args);
        const page = instance.getPage(args[0]);
        if (!connectedBrowser && instance.browser) {
          connectedBrowser = instance.browser;
          connectedBrowser.once("disconnected", disconnected);
        }
        if (!observed.has(page)) {
          write({ session: args[0], event: "late-page-observation" });
          observed.set(page, observePage(page, args[0], write, primaryHandshakes));
        }
      };
      instance.close = async () => {
        write({ event: "provider-close-start" });
        try { await close(); }
        finally {
          contexts.set = originalSetContext;
          server.ws.off("connection", onConnection);
          for (const [socket, listener] of closeListeners) socket.off("close", listener);
          for (const [context, listener] of contextListeners) context.off("page", listener);
          for (const dispose of observed.values()) dispose();
          connectedBrowser?.off("disconnected", disconnected);
          observed.clear(); contextListeners.clear(); closeListeners.clear(); primaryHandshakes.clear();
          write({ event: "provider-close-end" });
        }
      };
      return instance;
    },
  };
}
