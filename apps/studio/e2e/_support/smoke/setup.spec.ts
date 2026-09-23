/**
 * Global setup and the network guard: the served app is the `VITE_STUDIO_E2E=1` build, its CSP is production's plus
 * the loopback Anvil origin, and nothing leaves the machine.
 */
import { expect, test } from "../fixtures.ts";
import { E2E_CONNECT_SOURCE } from "../../../build/headers.ts";
import { isLocalUrl } from "../network.ts";
import { openEmpty } from "../seed.ts";

test.describe("global setup @smoke", () => {
  test("serves the e2e build with the loopback Anvil origin allowed", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
    expect(connect).toBe(`connect-src 'self' https: wss: ${E2E_CONNECT_SOURCE}`);
    expect(csp).toContain("default-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    // The import map lists every chunk; the e2e build carries the mock connector's (contracts §5.5).
    const html = await (await page.request.get("/")).text();
    expect(html).toMatch(/assets\/e2e-[\w-]+\.js/);
    await expect(page).toHaveTitle(/ · Lattice Studio$/);
  });

  test("keeps every request on the machine", async ({ page, blockedRequests }) => {
    await openEmpty(page);
    const outcome = await page.evaluate(async () => {
      try {
        await fetch("https://example.com/", { mode: "no-cors" });
        return "reached";
      } catch {
        return "blocked";
      }
    });
    expect(outcome).toBe("blocked");
    expect(blockedRequests).toContain("https://example.com/");

    // The CSP allows wss: (the WalletConnect relay, a wss RPC), so WebSockets need their own guard.
    const socket = await page.evaluate(
      () =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket("wss://example.com/");
          ws.addEventListener("close", (event) => resolve(`closed ${event.code}`));
          ws.addEventListener("error", () => resolve("error"));
          setTimeout(() => resolve("still open"), 10_000);
        }),
    );
    expect(socket).toMatch(/^(closed \d+|error)$/);
    expect(blockedRequests.some((url) => url.startsWith("wss://example.com"))).toBe(true);
  });
});

test.describe("kit helpers @smoke", () => {
  test("treats only the loopback as local", () => {
    expect(isLocalUrl(new URL("http://127.0.0.1:20123"))).toBe(true);
    expect(isLocalUrl(new URL("http://localhost:4173/catalog/manifest.json"))).toBe(true);
    expect(isLocalUrl(new URL("data:text/plain,hi"))).toBe(true);
    expect(isLocalUrl(new URL("https://sepolia.base.org"))).toBe(false);
    expect(isLocalUrl(new URL("https://127.0.0.1.example.com"))).toBe(false);
  });
});
