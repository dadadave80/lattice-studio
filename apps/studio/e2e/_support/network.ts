/**
 * End-to-end tests never reach the internet: every request to a host other than the loopback is aborted and
 * recorded. The app then behaves as it does when a public RPC, Sourcify or ENS can't be reached, which keeps runs
 * hermetic, and no transaction can ever leave for a public network. A suite that needs a remote answer stubs it
 * with its own `page.route`, which Playwright checks before this one.
 */
import type { BrowserContext } from "@playwright/test";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether `url` stays on this machine (or never leaves the page: data:, blob:). */
export function isLocalUrl(url: URL): boolean {
  if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:") return true;
  return LOCAL_HOSTS.has(url.hostname);
}

/** Aborts every non-local request in `context`; returns the list of URLs it blocked, filled as they happen. */
export async function keepLocal(context: BrowserContext): Promise<string[]> {
  const blocked: string[] = [];
  await context.route(
    (url) => !isLocalUrl(url),
    async (route) => {
      blocked.push(route.request().url());
      await route.abort("blockedbyclient");
    },
  );
  return blocked;
}
