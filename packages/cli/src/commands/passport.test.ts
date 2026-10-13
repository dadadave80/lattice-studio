import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { custom, encodeFunctionResult, numberToHex, toFunctionSelector, type Transport } from "viem";
import { run } from "../cli";
import type { Deps } from "../deps";
import { LOUPE_ABI } from "./passport";

const DIAMOND = "0x1111111111111111111111111111111111111111";
const STRANGER = "0x2222222222222222222222222222222222222222";
const FACETS = toFunctionSelector("facets()");
const SECRET = "tok-SECRET-123";

type Loupe = { facetAddress: `0x${string}`; functionSelectors: `0x${string}`[] }[];
type FakeChain = { chainId?: number; code?: `0x${string}`; loupe?: Loupe; hyperFails?: boolean };

/** A chain that answers from `chain`, through the same `deps.transport` hook the command uses. */
function fakeTransport(chain: FakeChain): (url: string) => Transport {
  return (url) => {
    const request = async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
      if (url.includes("hypersync") && chain.hyperFails === true) throw new Error(`HTTP request failed. URL: ${url}`);
      if (method === "eth_chainId") return numberToHex(chain.chainId ?? 10143);
      if (method === "eth_blockNumber") return numberToHex(1000);
      if (method === "eth_getCode") {
        const [address] = params as [string];
        return address.toLowerCase() === DIAMOND ? (chain.code ?? "0x6001") : "0x6002";
      }
      if (method === "eth_call") {
        const [call] = params as [{ data?: string; input?: string }];
        const data = call.data ?? call.input ?? "";
        if (data.startsWith(FACETS) && chain.loupe !== undefined) {
          return encodeFunctionResult({ abi: LOUPE_ABI, functionName: "facets", result: chain.loupe });
        }
        throw new Error("execution reverted");
      }
      if (method === "eth_getLogs") return [];
      throw new Error(`Unexpected ${method}`);
    };
    return custom({ request } as unknown as Parameters<typeof custom>[0], { retryCount: 0 });
  };
}

function harness(chain: FakeChain, env: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: Deps = {
    cwd: process.cwd(),
    env,
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    random: (bytes) => new Uint8Array(bytes),
    now: () => 0,
    transport: fakeTransport(chain),
    hasBun: true,
  };
  return { deps, stdout: () => out.join(""), everything: () => out.join("") + err.join("") };
}

const SELF_ROUTED: Loupe = [{ facetAddress: DIAMOND, functionSelectors: [FACETS] }];

describe("passport", () => {
  test("exits 0 when no claim fails", async () => {
    const h = harness({ loupe: SELF_ROUTED });
    expect(await run(["passport", DIAMOND, "--chain", "10143"], h.deps)).toBe(0);
    expect(h.stdout()).toContain("PASS PP-01");
  });

  test("exits 1 for a facet no catalog knows", async () => {
    const h = harness({ loupe: [{ facetAddress: STRANGER, functionSelectors: [FACETS] }] });
    expect(await run(["passport", DIAMOND, "--chain", "10143"], h.deps)).toBe(1);
    expect(h.stdout()).toContain("FAIL PP-03");
  });

  test("exits 1 when there's no code at the address", async () => {
    expect(await run(["passport", DIAMOND, "--chain", "10143"], harness({ code: "0x" }).deps)).toBe(1);
  });

  test("exits 2 for invalid input and for an RPC that serves another chain", async () => {
    expect(await run(["passport", "0x123", "--chain", "10143"], harness({}).deps)).toBe(2);
    expect(await run(["passport", DIAMOND], harness({}).deps)).toBe(2);
    expect(await run(["passport", DIAMOND, "--chain", "10143"], harness({ chainId: 1, loupe: SELF_ROUTED }).deps)).toBe(2);
  });

  test("exits 3 when the recipe's catalog isn't bundled", async () => {
    const example = join(import.meta.dir, "..", "..", "..", "..", "docs", "examples", "erc20.recipe.json");
    const recipe = JSON.parse(readFileSync(example, "utf8")) as { catalog: { hash: string }; template?: { catalogHash: string } };
    const other = `0x${"ab".repeat(32)}`;
    recipe.catalog.hash = other;
    if (recipe.template !== undefined) recipe.template.catalogHash = other;
    const file = join(mkdtempSync(join(tmpdir(), "passport-")), "other.recipe.json");
    writeFileSync(file, JSON.stringify(recipe));
    expect(await run(["passport", DIAMOND, "--chain", "10143", "--recipe", file], harness({ loupe: SELF_ROUTED }).deps)).toBe(3);
  });

  test("never prints the Envio token", async () => {
    const h = harness({ loupe: SELF_ROUTED, hyperFails: true }, { ENVIO_API_TOKEN: SECRET });
    expect(await run(["passport", DIAMOND, "--chain", "10143"], h.deps)).toBe(0);
    expect(h.everything()).not.toContain(SECRET);
    expect(h.everything()).toContain("History not read");
  });

  test("--json prints the whole passport with its digest", async () => {
    const h = harness({ loupe: SELF_ROUTED });
    expect(await run(["passport", DIAMOND, "--chain", "10143", "--json"], h.deps)).toBe(0);
    const passport = JSON.parse(h.stdout()) as { kind: string; digest: string; claims: unknown[] };
    expect(passport.kind).toBe("lattice-passport/v1");
    expect(passport.digest).toMatch(/^0x[0-9a-f]{64}$/);
    expect(passport.claims).toHaveLength(8);
  });
});
