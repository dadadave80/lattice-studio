/** ENS, account kinds and the fallback transport, over EIP-1193 mocks. */
import { describe, expect, test } from "bun:test";
import type { Address } from "@lattice-studio/core";
import { custom, HttpRequestError } from "viem";
import { getBlockNumber } from "viem/actions";
import { accountBalance, accountKind, isDelegation } from "./account";
import { ANVIL, BASE_SEPOLIA, ETHEREUM, isRpcUrl, publicRpcUrls, rpcUrls, SEPOLIA } from "./chains";
import { chainTransport, createClients, RANK, viemChain } from "./clients";
import { ensCoinType, resolveName, reverseName } from "./ens";
import { mockChain } from "./testing";

const ALICE = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ALICE_BASE = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const identity = (name: string): string => name.toLowerCase();

function clientFor(chain: ReturnType<typeof mockChain>, spec = SEPOLIA) {
  return createClients({ transport: () => chain.transport() }).get(spec);
}

describe("ENS", () => {
  test("ENSIP-11 coin types: 60 on the ENS chain itself, 0x80000000 | chainId elsewhere", () => {
    expect(ensCoinType(SEPOLIA.id, 11155111)).toBe(60n);
    expect(ensCoinType(ETHEREUM.id, 1)).toBe(60n);
    expect(ensCoinType(BASE_SEPOLIA.id, 11155111)).toBe(0x80000000n | 84532n);
    expect(ensCoinType(8453, 1)).toBe(2147492101n);
  });

  test("names resolve on Sepolia for testnets, to the address for the selected chain", async () => {
    const sepolia = mockChain({
      chainId: SEPOLIA.id,
      accounts: { "0xeeeeeeee14d718c2b47d9923deab1335e144eeee": { code: "0x01" } },
      ens: { "alice.eth": { "60": ALICE, [String(0x80000000 + 84532)]: ALICE_BASE } },
    });
    const client = clientFor(sepolia);
    expect(await resolveName(client, identity, "alice.eth", SEPOLIA.id, SEPOLIA.id)).toBe(ALICE);
    expect(await resolveName(client, identity, "alice.eth", BASE_SEPOLIA.id, SEPOLIA.id)).toBe(ALICE_BASE);
    expect(await resolveName(client, identity, "bob.eth", SEPOLIA.id, SEPOLIA.id)).toBeNull();
  });

  test("reverse lookups use the same coin type", async () => {
    const sepolia = mockChain({
      chainId: SEPOLIA.id,
      accounts: { "0xeeeeeeee14d718c2b47d9923deab1335e144eeee": { code: "0x01" } },
      reverse: { [`${ALICE.toLowerCase()}:60`]: "alice.eth", [`${ALICE_BASE.toLowerCase()}:${0x80000000 + 84532}`]: "alice.eth" },
    });
    const client = clientFor(sepolia);
    expect(await reverseName(client, ALICE, SEPOLIA.id, SEPOLIA.id)).toBe("alice.eth");
    expect(await reverseName(client, ALICE_BASE, BASE_SEPOLIA.id, SEPOLIA.id)).toBe("alice.eth");
    expect(await reverseName(client, ALICE, BASE_SEPOLIA.id, SEPOLIA.id)).toBeNull();
  });

  test("an RPC failure throws for the service to word", async () => {
    const sepolia = mockChain({ chainId: SEPOLIA.id });
    sepolia.down = true;
    await expect(resolveName(clientFor(sepolia), identity, "alice.eth", SEPOLIA.id, SEPOLIA.id)).rejects.toThrow();
  });
});

describe("account kinds", () => {
  const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as Address;
  const delegated = "0x1111111111111111111111111111111111111111" as Address;
  const wallet4337 = "0x2222222222222222222222222222222222222222" as Address;
  const eoa = "0x3333333333333333333333333333333333333333" as Address;
  const chain = mockChain({
    chainId: SEPOLIA.id,
    accounts: {
      [safe.toLowerCase()]: { code: "0x608060", safe: { threshold: 2n, owners: [eoa, delegated] } },
      [delegated]: { code: `0xef0100${"ab".repeat(20)}` },
      [wallet4337]: { code: "0x6080604052" },
      [eoa]: { balance: 4_000_000_000_000_000n },
    },
  });
  const client = clientFor(chain);

  test("no code is an account; a 7702 designator an EIP-7702 account; a Safe answers like one; other code a smart account", async () => {
    expect(await accountKind(client, eoa)).toBe("eoa");
    expect(await accountKind(client, delegated)).toBe("delegated");
    expect(await accountKind(client, safe)).toBe("safe");
    expect(await accountKind(client, wallet4337)).toBe("smart");
  });

  test("the designator is exactly 0xef0100 and 20 bytes", () => {
    expect(isDelegation(`0xef0100${"ab".repeat(20)}`)).toBe(true);
    expect(isDelegation(`0xef0100${"ab".repeat(21)}`)).toBe(false);
    expect(isDelegation("0x6080")).toBe(false);
  });

  test("balance in wei", async () => {
    expect(await accountBalance(client, eoa)).toBe(4_000_000_000_000_000n);
  });
});

describe("fallback transport", () => {
  test("the person's RPC first, then the chain default, then the extra; duplicates collapse", () => {
    expect(rpcUrls(SEPOLIA, undefined)).toEqual([SEPOLIA.rpc.default, SEPOLIA.rpc.extra ?? ""]);
    expect(rpcUrls(SEPOLIA, " https://mine.example/rpc ")).toEqual(["https://mine.example/rpc", SEPOLIA.rpc.default, SEPOLIA.rpc.extra ?? ""]);
    expect(rpcUrls(SEPOLIA, SEPOLIA.rpc.default)).toEqual([SEPOLIA.rpc.default, SEPOLIA.rpc.extra ?? ""]);
  });

  test("a failing RPC is absorbed: the next one answers", async () => {
    const tried: string[] = [];
    const make = (url: string) =>
      custom({
        request: async ({ method }: { method: string }) => {
          tried.push(url);
          if (url === "https://down.example") throw new HttpRequestError({ url, status: 503 });
          if (method === "eth_blockNumber") return "0x2a";
          throw new Error(`unexpected ${method}`);
        },
      }, { retryCount: 0 });
    const clients = createClients({ overrides: { [SEPOLIA.id]: "https://down.example" }, transport: make });
    expect(await getBlockNumber(clients.get(SEPOLIA), { cacheTime: 0 })).toBe(42n);
    expect(tried).toEqual(["https://down.example", SEPOLIA.rpc.default]);
  });

  test("every RPC down fails the call", async () => {
    const make = (url: string) => custom({ request: async () => { throw new HttpRequestError({ url, status: 503 }); } }, { retryCount: 0 });
    const clients = createClients({ transport: make });
    await expect(getBlockNumber(clients.get(SEPOLIA), { cacheTime: 0 })).rejects.toThrow();
  });

  test("several RPCs go behind a fallback without viem's ranking; one goes as is", () => {
    const make = (url: string) => custom({ request: async () => url });
    const several = chainTransport(["https://a.example", "https://b.example"], make);
    expect(several({ chain: viemChain(SEPOLIA, ["https://a.example"]), retryCount: 0 }).config.type).toBe("fallback");
    const one = chainTransport(["https://a.example"], make);
    expect(one({ chain: viemChain(SEPOLIA, ["https://a.example"]), retryCount: 0 }).config.type).toBe("custom");
  });

  test("ranking orders the RPCs by answer time, a silent one last, and remakes the client", async () => {
    let clock = 0;
    const answers: Record<string, number | "down"> = {
      [SEPOLIA.rpc.default]: 300,
      [SEPOLIA.rpc.extra ?? ""]: 50,
      "https://mine.example/rpc": "down",
    };
    const make = (url: string) => custom({
      request: async () => {
        const answer = answers[url];
        if (answer === "down") throw new HttpRequestError({ url, status: 503 });
        clock += answer ?? 0;
        return "0x1";
      },
    }, { retryCount: 0 });
    const clients = createClients({ overrides: { [SEPOLIA.id]: "https://mine.example/rpc" }, transport: make, clock: () => clock });
    const before = clients.get(SEPOLIA);
    expect(clients.urls(SEPOLIA)[0]).toBe("https://mine.example/rpc");
    await clients.rank();
    expect(clients.urls(SEPOLIA)).toEqual([SEPOLIA.rpc.extra ?? "", SEPOLIA.rpc.default, "https://mine.example/rpc"]);
    expect(clients.get(SEPOLIA)).not.toBe(before);
    // Ranking reorders, it doesn't reconfigure: the probe cache key stays.
    expect(clients.key(SEPOLIA)).toBe(["https://mine.example/rpc", SEPOLIA.rpc.default, SEPOLIA.rpc.extra].join(" "));
  });

  test("the ranking timer runs only while active, one at a time, and stops on dispose", () => {
    const started: number[] = [];
    const stopped: unknown[] = [];
    let next = 0;
    const clients = createClients({
      transport: () => custom({ request: async () => "0x1" }),
      setInterval: (_run, ms) => {
        started.push(ms);
        next += 1;
        return next;
      },
      clearInterval: (handle) => stopped.push(handle),
    });
    clients.setActive(true);
    clients.setActive(true);
    expect(started).toEqual([RANK.interval]);
    clients.setActive(false);
    expect(stopped).toEqual([1]);
    clients.setActive(true);
    clients.dispose();
    expect(stopped).toEqual([1, 2]);
  });

  test("changing the person's RPC makes a new client; the same one keeps it", () => {
    const clients = createClients({ transport: () => custom({ request: async () => "0x1" }) });
    const first = clients.get(SEPOLIA);
    expect(clients.get(SEPOLIA)).toBe(first);
    expect(clients.setOverrides({ [SEPOLIA.id]: "https://mine.example" })).toEqual([SEPOLIA.id]);
    const second = clients.get(SEPOLIA);
    expect(second).not.toBe(first);
    expect(second.chain.rpcUrls.default.http[0]).toBe("https://mine.example");
    expect(clients.setOverrides({ [SEPOLIA.id]: "https://mine.example" })).toEqual([]);
  });

  test("a half-typed or non-http override is never called", () => {
    for (const bad of ["https://mai", "mainnet.infura.io", "ftp://rpc.example.org", "javascript:alert(1)", "https://", ""]) {
      expect({ bad, ok: isRpcUrl(bad) }).toEqual({ bad, ok: false });
      expect(rpcUrls(SEPOLIA, bad)).toEqual([SEPOLIA.rpc.default, SEPOLIA.rpc.extra ?? ""]);
    }
    for (const good of ["https://sepolia.infura.io/v3/key", "http://127.0.0.1:8545", "http://localhost:8545"]) {
      expect({ good, ok: isRpcUrl(good) }).toEqual({ good, ok: true });
    }
  });

  test("a wallet only ever sees public RPCs; Anvil's local node is the exception", () => {
    const secret = "https://sepolia.infura.io/v3/SECRET";
    expect(publicRpcUrls(SEPOLIA, secret)).toEqual([SEPOLIA.rpc.default, SEPOLIA.rpc.extra ?? ""]);
    expect(publicRpcUrls(ANVIL, "http://127.0.0.1:20043")).toEqual(["http://127.0.0.1:20043", ANVIL.rpc.default]);
  });

  test("viem chains carry ENS's Universal Resolver only where ENS lives", () => {
    expect(viemChain(SEPOLIA, []).contracts?.ensUniversalResolver).toBeDefined();
    expect(viemChain(BASE_SEPOLIA, []).contracts?.ensUniversalResolver).toBeUndefined();
    expect(viemChain(BASE_SEPOLIA, []).rpcUrls.default.http).toEqual([BASE_SEPOLIA.rpc.default]);
  });
});
