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
