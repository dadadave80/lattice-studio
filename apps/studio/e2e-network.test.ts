import { describe, expect, test } from "bun:test";
import type { BrowserContext } from "@playwright/test";
import fc from "fast-check";
import { isLocalUrl, keepLocal } from "./e2e/_support/network.ts";

async function registeredMatchers(): Promise<RegExp[]> {
  const matchers: unknown[] = [];
  const context = {
    route: async (matcher: unknown) => { matchers.push(matcher); },
    routeWebSocket: async (matcher: unknown) => { matchers.push(matcher); },
  } as unknown as BrowserContext;
  await keepLocal(context);
  expect(matchers).toHaveLength(2);
  return matchers.map((matcher) => {
    // Function matchers make Playwright send every local asset to the test client before falling back.
    expect(matcher).toBeInstanceOf(RegExp);
    if (!(matcher instanceof RegExp)) throw new Error("The network guard must match URLs in the Playwright server.");
    return matcher;
  });
}

function assertParity(matchers: readonly RegExp[], url: URL): void {
  for (const matcher of matchers) {
    expect(matcher.test(url.href), url.href).toBe(!isLocalUrl(url));
    expect(matcher.lastIndex).toBe(0);
  }
}

describe("the end-to-end network guard", () => {
  test("registers HTTP and WebSocket matchers that skip local assets before the client RPC", async () => {
    const matchers = await registeredMatchers();
    for (const matcher of matchers) {
      expect(matcher.flags).toBe("");
      expect(matcher.test("http://localhost:5173/assets/persistence.js")).toBe(false);
      expect(matcher.test("http://127.0.0.1:8545/")).toBe(false);
      expect(matcher.test("ws://[::1]:8545/")).toBe(false);
      expect(matcher.test("https://rpc.example/")).toBe(true);
      expect(matcher.test("wss://relay.example/")).toBe(true);
    }
  });

  test("preserves the exact host boundary, URL normalization, and non-network schemes", async () => {
    const matchers = await registeredMatchers();
    const allowed = [
      "http://localhost", "https://LOCALHOST:443/path", "ws://127.0.0.1:8545/", "wss://[::1]:8545/",
      "http://127.1/", "http://2130706433/", "http://0x7f000001/", "http://[0:0:0:0:0:0:0:1]/",
      "https://remote.example@localhost:123/path", "http://user:p%40ss@127.0.0.1/",
      "custom://localhost:123/path", "custom://[::1]/", "data:text/plain,remote.example",
      "blob:https://remote.example/id", "about:blank", "about://remote.example/path",
    ];
    const blocked = [
      "http://localhost.example/", "http://localhost./", "http://localhost%2Eexample/", "http://localhost%2E/",
      "http://127.0.0.1.example/", "http://127.0.0.2/", "http://[::ffff:127.0.0.1]/",
      "https://localhost@remote.example/", "https://localhost:443@remote.example/",
      "http://lоcalhost/", "http://localhost-example/", "custom://LOCALHOST/", "custom:localhost",
      "file://localhost/path", "file:///path", "mailto:localhost", "https://remote.example/#localhost",
    ];
    for (const raw of allowed) {
      const url = new URL(raw);
      expect(isLocalUrl(url), raw).toBe(true);
      assertParity(matchers, url);
    }
    for (const raw of blocked) {
      const url = new URL(raw);
      expect(isLocalUrl(url), raw).toBe(false);
      assertParity(matchers, url);
    }
  });

  test("agrees with the URL reference across credentials, ports, paths, and custom schemes", async () => {
    const matchers = await registeredMatchers();
    const schemes = ["http", "https", "HTTP", "ws", "wss", "ftp", "file", "custom", "custom+v1"];
    const hosts = [
      "localhost", "LOCALHOST", "localhost.", "localhost.example", "localhost%2Eexample", "localhost%2E",
      "127.0.0.1", "127.1", "2130706433", "0x7f000001", "127.0.0.1.example", "127.0.0.2",
      "[::1]", "[0:0:0:0:0:0:0:1]", "[::ffff:127.0.0.1]", "remote.example", "lоcalhost",
    ];
    const credentials = ["", "user@", "user:pass@", "remote.example@", "localhost@", "u:p%40ss@"];
    const ports = ["", ":0", ":80", ":443", ":8545", ":65535", ":65536", ":"];
    const paths = ["", "/", "/@localhost", "?host=localhost", "#localhost"];
    let checked = 0;
    for (const scheme of schemes) for (const host of hosts) for (const auth of credentials) {
      for (const port of ports) for (const path of paths) {
        let url: URL;
        try { url = new URL(`${scheme}://${auth}${host}${port}${path}`); } catch { continue; }
        assertParity(matchers, url);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(25_000);
  });

  test("agrees with the URL reference for generated canonical URLs", async () => {
    const matchers = await registeredMatchers();
    const authority = fc.tuple(
      fc.constantFrom("http", "https", "ws", "wss", "custom"),
      fc.constantFrom("localhost", "127.0.0.1", "[::1]", "localhost.example", "remote.example", "LOCALHOST"),
      fc.string().map((value) => encodeURIComponent(value)),
      fc.integer({ min: 0, max: 65535 }),
    ).map(([scheme, host, user, port]) => `${scheme}://${user}@${host}:${port}/`);
    fc.assert(fc.property(fc.oneof(fc.webUrl(), authority), (raw) => {
      assertParity(matchers, new URL(raw));
    }), { numRuns: 10_000, seed: 63864 });
  });
});
