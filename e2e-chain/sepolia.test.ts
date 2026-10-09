/**
 * Where the Sepolia fork comes from (Q7): the public RPCs in order, SEPOLIA_RPC_URL only when they all fail, and
 * the log names each endpoint by host and the secret only by its variable name. No network: the probe and the node
 * start are stand-ins.
 */
import { describe, expect, test } from "bun:test";
import type { Node, NodeOptions } from "./harness/node";
import { URL_PLACEHOLDER } from "./harness/scrub";
import { PUBLIC_SEPOLIA_RPCS, forkSources, startSepoliaFork, type ForkDeps } from "./harness/sepolia";

const KEY = "s3cr3tK3yAbCdEf0123456789";
const SECRET = `https://sepolia.keyed-provider.test/v2/${KEY}`;
const PUBLIC = ["https://rpc-a.example.org", "https://rpc-b.example.net/sepolia"] as const;

/** Deps where `failing` URLs reject at the probe (quoting the URL, as fetch errors do), and the rest start. */
function deps(failing: readonly string[]) {
  const lines: string[] = [];
  const started: NodeOptions[] = [];
  const probed: string[] = [];
  const d: ForkDeps = {
    probe: async (url) => {
      probed.push(url);
      if (failing.includes(url)) throw new Error(`Unable to connect to ${url}`);
      return 9_000_000n;
    },
    start: async (options) => {
      started.push(options);
      return { url: "http://127.0.0.1:1", chainId: 11155111 } as Node;
    },
    log: (line) => lines.push(line),
  };
  return { d, lines, started, probed };
}

describe("forkSources", () => {
  test("lists the public RPCs by host, then the secret last, by name only", () => {
    expect(forkSources(SECRET, PUBLIC)).toEqual([
      { url: PUBLIC[0], label: "rpc-a.example.org", secret: false },
      { url: PUBLIC[1], label: "rpc-b.example.net", secret: false },
      { url: SECRET, label: "SEPOLIA_RPC_URL", secret: true },
    ]);
  });

  test("leaves the secret out when it isn't set", () => {
    expect(forkSources(undefined, PUBLIC).map((s) => s.label)).toEqual(["rpc-a.example.org", "rpc-b.example.net"]);
    expect(forkSources("", PUBLIC).some((s) => s.secret)).toBe(false);
  });

  test("the default list is public Sepolia RPCs only", () => {
    expect(forkSources(undefined).map((s) => s.url)).toEqual([...PUBLIC_SEPOLIA_RPCS]);
  });
});

describe("startSepoliaFork", () => {
  test("forks the first public RPC that answers, at its finalized block, and never touches the secret", async () => {
    const { d, lines, started, probed } = deps([PUBLIC[0]]);
    const fork = await startSepoliaFork(5500, forkSources(SECRET, PUBLIC), d);
    expect(fork.label).toBe("rpc-b.example.net");
    expect(fork.block).toBe(9_000_000n);
    expect(probed).toEqual([...PUBLIC]);
    expect(started).toEqual([{ port: 5500, forkUrl: PUBLIC[1], forkBlockNumber: 9_000_000n, forkUrlPublic: true }]);
    expect(lines.at(-1)).toBe("Sepolia fork: block 9000000 (finalized) from rpc-b.example.net.");
  });

  test("falls back to SEPOLIA_RPC_URL only when every public RPC fails, and never prints it", async () => {
    const { d, lines, started } = deps(PUBLIC);
    const fork = await startSepoliaFork(5500, forkSources(SECRET, PUBLIC), d);
    expect(fork.label).toBe("SEPOLIA_RPC_URL");
    expect(started).toEqual([{ port: 5500, forkUrl: SECRET, forkBlockNumber: 9_000_000n, forkUrlPublic: false }]);
    expect(fork.failures.map((f) => f.split(":")[0])).toEqual(["rpc-a.example.org", "rpc-b.example.net"]);
    expect(lines.at(-1)).toBe("Sepolia fork: block 9000000 (finalized) from SEPOLIA_RPC_URL.");
  });

  test("a node that won't start counts as a failure, and the next endpoint is tried", async () => {
    const { d, started } = deps([]);
    let calls = 0;
    const start = d.start;
    d.start = async (options) => {
      calls += 1;
      if (calls === 1) throw new Error("fork error: pruned history unavailable");
      return start(options);
    };
    const fork = await startSepoliaFork(5500, forkSources(undefined, PUBLIC), d);
    expect(fork.label).toBe("rpc-b.example.net");
    expect(fork.failures).toEqual(["rpc-a.example.org: fork error: pruned history unavailable"]);
    expect(started.map((s) => s.forkUrl)).toEqual([PUBLIC[1]]);
  });

  test("when every endpoint fails it throws, listing each by label, with the secret's URL scrubbed", async () => {
    const { d, lines } = deps([...PUBLIC, SECRET]);
    let message = "";
    try {
      await startSepoliaFork(5500, forkSources(SECRET, PUBLIC), d);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("no endpoint served a fork; tried every public Sepolia RPC and SEPOLIA_RPC_URL");
    expect(message).toContain("rpc-a.example.org: Unable to connect to https://rpc-a.example.org");
    expect(message).toContain(`SEPOLIA_RPC_URL: Unable to connect to ${URL_PLACEHOLDER}`);
    for (const text of [message, ...lines]) expect(text).not.toContain(KEY);
    for (const text of [message, ...lines]) expect(text).not.toContain("keyed-provider.test");
  });

  test("without the secret, the failure says it isn't set", async () => {
    const { d } = deps(PUBLIC);
    await expect(startSepoliaFork(5500, forkSources(undefined, PUBLIC), d)).rejects.toThrow("SEPOLIA_RPC_URL isn't set");
  });
});
