/**
 * Global setup and the network guard: the served app is the `VITE_STUDIO_E2E=1` build, its CSP is production's plus
 * the loopback Anvil origin, and nothing leaves the machine.
 */
import { expect, test } from "../fixtures.ts";
import { LOCAL_ANVIL_SOURCE, withLocalAnvil } from "../preview-csp.ts";
import { isLocalUrl } from "../network.ts";
import { openEmpty } from "../seed.ts";

test.describe("global setup @smoke", () => {
  test("serves the e2e build with the loopback Anvil origin allowed", async ({ page }) => {
    const response = await page.goto("/");
    const csp = response?.headers()["content-security-policy"] ?? "";
    const connect = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src"));
    expect(connect).toBe(`connect-src 'self' https: wss: ${LOCAL_ANVIL_SOURCE}`);
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
  });
});

test.describe("kit helpers @smoke", () => {
  test("adds the Anvil source to connect-src once and leaves the rest", () => {
    const production = "default-src 'self'; connect-src 'self' https: wss:; frame-ancestors 'none'";
    const e2e = withLocalAnvil(production);
    expect(e2e).toBe(`default-src 'self'; connect-src 'self' https: wss: ${LOCAL_ANVIL_SOURCE}; frame-ancestors 'none'`);
    expect(withLocalAnvil(e2e)).toBe(e2e);
  });

  test("treats only the loopback as local", () => {
    expect(isLocalUrl(new URL("http://127.0.0.1:20123"))).toBe(true);
    expect(isLocalUrl(new URL("http://localhost:4173/catalog/manifest.json"))).toBe(true);
    expect(isLocalUrl(new URL("data:text/plain,hi"))).toBe(true);
    expect(isLocalUrl(new URL("https://sepolia.base.org"))).toBe(false);
    expect(isLocalUrl(new URL("https://127.0.0.1.example.com"))).toBe(false);
  });
});
