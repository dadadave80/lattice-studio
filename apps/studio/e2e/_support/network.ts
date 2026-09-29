/**
 * End-to-end tests never reach the internet: every request and every WebSocket to a host other than the loopback
 * is aborted or closed, and recorded. The CSP allows `https:` and `wss:` (public RPCs, Sourcify, ENS, the
 * WalletConnect relay), so without this a test could. The app then behaves as it does when those can't be reached,
 * which keeps runs hermetic, and no transaction can ever leave for a public network. A suite that needs a remote
 * answer stubs it with its own `page.route` or `page.routeWebSocket`, which Playwright checks before these.
 */
import type { BrowserContext } from "@playwright/test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether `url` stays on this machine (or never leaves the page: data:, blob:). */
export function isLocalUrl(url: URL): boolean {
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return true;
  return LOCAL_HOSTS.has(url.hostname);
}

/**
 * Aborts every non-local request and closes every non-local WebSocket in `context`, without connecting it. Returns
 * the list of URLs it stopped, filled as they happen.
 */
export async function keepLocal(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route(
    (url) => !isLocalUrl(url),
    async (route) => {
      blocked.push(route.request().url());
      await route.abort("blockedbyclient");
    },
  );
  await context.routeWebSocket(
    (url) => !isLocalUrl(url),
    async (socket) => {
      blocked.push(socket.url());
      // 1008: policy violation. The page sees the socket close; nothing reaches the server.
      await socket.close({ code: 1008, reason: "End-to-end tests stay on this machine." });
    },
  );
  return blocked;
}

/** The page global `stayOnline` keeps the test's own offline state in. */
const TEST_OFFLINE = "__latticeStudioE2eOffline";

const staying = new WeakSet<BrowserContext>();

/**
 * Keeps the page online whatever the machine's own connection does, while the test's own `context.setOffline` still
 * works. Studio reads `navigator.onLine` and the window's `online` and `offline` events (src/pwa/connection.ts) and
 * blocks Deploy while offline ("Deploy needs a connection"), even for a local Anvil node; Chromium reports the host's
 * network, so a dropped Wi-Fi link during a run failed deploy specs although every request they make stays on the
 * loopback.
 *
 * So the page's `navigator.onLine` answers from the test's state, never the host's, and the browser's own `online`
 * and `offline` events never reach the app. `context.setOffline` is wrapped to change that state and fire the event
 * itself: going offline, the page hears it before the network goes (as it would); coming back, after the network is
 * there again, so the probe Studio sends on `online` gets an answer.
 *
 * The `anvil` fixture applies it, so every Anvil test has it. The offline suite doesn't ask for `anvil`, and leaves
 * the host's connection alone apart from its own `setOffline`. Call before the first `page.goto`.
 */
export async function stayOnline(context: BrowserContext): Promise<void> {
  if (staying.has(context)) return;
  staying.add(context);
  await context.addInitScript((key) => {
    const state = window as unknown as Record<string, boolean | undefined>;
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => state[key] !== true });
    const ignoreHost = (event: Event) => {
      if (event.isTrusted) event.stopImmediatePropagation();
    };
    window.addEventListener("online", ignoreHost, true);
    window.addEventListener("offline", ignoreHost, true);
  }, TEST_OFFLINE);

  const setOffline = context.setOffline.bind(context);
  const tell = async (offline: boolean): Promise<void> => {
    // Pages opened or reloaded from now on start in this state (init scripts run in the order they were added).
    await context.addInitScript(({ key, value }) => {
      (window as unknown as Record<string, boolean>)[key] = value;
    }, { key: TEST_OFFLINE, value: offline });
    for (const page of context.pages()) {
      await page
        .evaluate(({ key, value }) => {
          (window as unknown as Record<string, boolean>)[key] = value;
          window.dispatchEvent(new Event(value ? "offline" : "online"));
        }, { key: TEST_OFFLINE, value: offline })
        // A page that's closing or between documents picks the state up from the init script instead.
        .catch(() => undefined);
    }
  };
  context.setOffline = async (offline: boolean): Promise<void> => {
    if (offline) {
      await tell(true);
      await setOffline(true);
    } else {
      await setOffline(false);
      await tell(false);
    }
  };
}

/** The binding pages report CSP violations through. */
const CSP_BINDING = "__latticeStudioE2eCspViolation";

/**
 * Records every `securitypolicyviolation` event in `context`'s pages, from before their first script runs, and
 * returns the list, one line per violation, filled as they happen. Studio's CSP has no `unsafe-inline` or
 * `unsafe-eval` (spec L863-L865): a style Base UI injects without `CSPProvider`, a style attribute set from markup,
 * an `eval` or a script from another origin is a violation, and the `cspViolations` fixture fails the test on any.
 */
export async function recordCspViolations(context: BrowserContext): Promise<string[]> {
  const violations: string[] = [];
  await context.exposeBinding(CSP_BINDING, (_source, line: string) => {
    violations.push(line);
  });
  await context.addInitScript((binding) => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const where = event.sourceFile ? ` at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}` : "";
      const sample = event.sample ? ` (${event.sample.slice(0, 80)})` : "";
      const line = `${event.effectiveDirective} blocked ${event.blockedURI || "inline"}${where}${sample} on ${location.pathname}`;
      const report = (window as unknown as Record<string, ((line: string) => Promise<void>) | undefined>)[binding];
      void report?.(line);
    });
  }, CSP_BINDING);
  return violations;
}
