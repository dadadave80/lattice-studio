/**
 * The fork RPC URL never reaches a message: the scrubber replaces the URL and every piece of it that could appear on
 * its own, and a fork node that can't start (anvil quoting the endpoint in its stderr) rejects with it scrubbed.
 */
import { describe, expect, test } from "bun:test";
import { ANVIL_SKIP_REASON, PORT, anvilPort } from "./harness/env";
import { startNode } from "./harness/node";
import { ResultTable } from "./harness/report";
import { URL_PLACEHOLDER, registerSecretUrl, scrub, scrubError, scrubUrl, urlParts } from "./harness/scrub";

const KEY = "k3yAbCdEf0123456789xyz";
const PATH_KEYED = `https://eth-sepolia.example-rpc.io/v2/${KEY}`;
const QUERY_KEYED = `https://sepolia.example-node.net/rpc?apikey=${KEY}&chain=11155111`;

describe("scrubUrl", () => {
  test("replaces the whole URL, with or without a trailing slash", () => {
    expect(scrubUrl(`error sending request for url (${PATH_KEYED})`, PATH_KEYED)).toBe(`error sending request for url (${URL_PLACEHOLDER})`);
    expect(scrubUrl(`url (${PATH_KEYED}/)`, PATH_KEYED)).toBe(`url (${URL_PLACEHOLDER}/)`);
    expect(scrubUrl(`url (${PATH_KEYED})`, `${PATH_KEYED}/`)).toBe(`url (${URL_PLACEHOLDER})`);
  });

  test("replaces the origin, host, path and key when a message prints them apart", () => {
    const message = [
      "Error: failed to get fork block number",
      "Context:",
      "- Error #0: HTTP error 401 with body: invalid key",
      `- endpoint eth-sepolia.example-rpc.io, path /v2/${KEY}`,
      `- origin https://eth-sepolia.example-rpc.io`,
      `- key ${KEY} rejected`,
    ].join("\n");
    const out = scrubUrl(message, PATH_KEYED);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("eth-sepolia.example-rpc.io");
    expect(out).not.toContain("/v2/");
    expect(out).toContain("HTTP error 401 with body: invalid key");
  });

  test("replaces keys in the query string", () => {
    const out = scrubUrl(`rate limited: ${QUERY_KEYED} (apikey=${KEY})`, QUERY_KEYED);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("sepolia.example-node.net");
    expect(out).toBe(`rate limited: ${URL_PLACEHOLDER} (apikey=${URL_PLACEHOLDER})`);
  });

  test("leaves short path segments and unrelated text alone", () => {
    expect(urlParts(PATH_KEYED)).not.toContain("v2");
    expect(scrubUrl("v2 of the loupe; 0xdeadbeef", PATH_KEYED)).toBe("v2 of the loupe; 0xdeadbeef");
  });

  test("a URL that doesn't parse is still replaced whole", () => {
    expect(scrubUrl("bad url: not a url/with/SECRETKEY99", "not a url/with/SECRETKEY99")).toBe(`bad url: ${URL_PLACEHOLDER}`);
  });
});

describe("registered URLs", () => {
  const secret = `https://registered.example-rpc.io/v3/${KEY}`;
  registerSecretUrl(secret);

  test("scrub removes them from any text", () => {
    expect(scrub(`fork failed: ${secret}`)).toBe(`fork failed: ${URL_PLACEHOLDER}`);
  });

  test("scrubError scrubs a string rejection (prool rejects with anvil's stderr) and an Error's message, stack and data", () => {
    expect(scrubError(`Error: ${secret} unreachable`).message).toBe(`Error: ${URL_PLACEHOLDER} unreachable`);
    const error = new Error(`upstream ${secret}`) as Error & { code?: number; data?: string };
    error.code = -32603;
    error.data = `see ${secret}`;
    const clean = scrubError(error) as Error & { code?: number; data?: string };
    expect(clean.message).toBe(`upstream ${URL_PLACEHOLDER}`);
    expect(clean.stack ?? "").not.toContain(KEY);
    expect(clean.data).toBe(`see ${URL_PLACEHOLDER}`);
    expect(clean.code).toBe(-32603);
  });

  test("result-table rows are scrubbed, including a failed case's reason", async () => {
    const table = new ResultTable("scrub");
    table.record("ERC20", "factory", `pass via ${secret}`);
    await expect(table.run("ERC20", "createx", () => Promise.reject(new Error(`fork error at ${secret}`)), () => "")).rejects.toThrow();
    expect(table.text()).not.toContain(KEY);
    expect(table.text()).toContain(`fail: fork error at ${URL_PLACEHOLDER}`);
  });
});

describe.skipIf(ANVIL_SKIP_REASON !== undefined)("a fork node that can't reach its RPC", () => {
  test("rejects without the URL or its key", async () => {
    // Nothing listens on port 9 locally, so anvil fails at once and quotes the endpoint in its stderr.
    const unreachable = `http://127.0.0.1:9/v2/${KEY}`;
    let message = "";
    try {
      const node = await startNode({ port: anvilPort(PORT.scrub), forkUrl: unreachable });
      await node.stop();
    } catch (error) {
      message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(KEY);
    expect(message).not.toContain("127.0.0.1:9");
    // Anvil did quote the endpoint: the placeholder stands where it was.
    expect(message).toContain(URL_PLACEHOLDER);
  }, 60_000);
});
