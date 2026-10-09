/**
 * Where the Sepolia fork suite forks from (Q7): a recent finalized block, read from the first public Sepolia RPC
 * that answers and serves the fork. Public RPCs prune old state, so the fork never pins a historical block. The
 * `SEPOLIA_RPC_URL` secret is the last resort, tried only when every public endpoint fails, and it never shows in
 * a message: a public endpoint is named by its host, the secret only as "SEPOLIA_RPC_URL".
 */
import { startNode, type Node, type NodeOptions } from "./node";
import { registerSecretUrl, scrub } from "./scrub";

export const SEPOLIA = 11155111;

/** Public Sepolia RPCs that served a recent finalized block's state without a key on 2026-10-06, tried in order. */
export const PUBLIC_SEPOLIA_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.gateway.tenderly.co",
  "https://1rpc.io/sepolia",
  "https://rpc.sepolia.ethpandaops.io",
  "https://sepolia.rpc.thirdweb.com",
  "https://eth-sepolia.api.onfinality.io/public",
] as const;

export type ForkSource = { url: string; label: string; secret: boolean };

export type SepoliaFork = { node: Node; block: bigint; label: string; failures: string[] };

/** The endpoints in the order they're tried: the public ones, then the secret when it's set. */
export function forkSources(secretUrl: string | undefined, publicUrls: readonly string[] = PUBLIC_SEPOLIA_RPCS): ForkSource[] {
  const sources = publicUrls.map((url) => ({ url, label: new URL(url).host, secret: false }));
  return secretUrl === undefined || secretUrl === "" ? sources : [...sources, { url: secretUrl, label: "SEPOLIA_RPC_URL", secret: true }];
}

async function rpc<T>(url: string, method: string, params: unknown[], timeoutMs: number): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error !== undefined) throw new Error(`${method}: ${body.error.message}`);
  if (body.result === undefined || body.result === null) throw new Error(`${method}: no result`);
  return body.result;
}

/** The endpoint's finalized block number, after checking it serves Sepolia. */
export async function finalizedBlock(url: string, timeoutMs = 15_000): Promise<bigint> {
  const chainId = Number(BigInt(await rpc<string>(url, "eth_chainId", [], timeoutMs)));
  if (chainId !== SEPOLIA) throw new Error(`chain ${chainId}, not Sepolia`);
  const block = await rpc<{ number: string }>(url, "eth_getBlockByNumber", ["finalized", false], timeoutMs);
  return BigInt(block.number);
}

export type ForkDeps = {
  probe: (url: string) => Promise<bigint>;
  start: (options: NodeOptions) => Promise<Node>;
  log: (line: string) => void;
};

/**
 * Starts a local Anvil node forking Sepolia at a recent finalized block, trying each source in order: one whose
 * probe or fork start fails is logged by its label and the next is tried. Throws, listing every failure, when
 * none works. Logs the block and the source it used.
 */
export async function startSepoliaFork(
  port: number,
  sources: readonly ForkSource[],
  deps: ForkDeps = { probe: (url) => finalizedBlock(url), start: startNode, log: (line) => console.log(line) },
): Promise<SepoliaFork> {
  for (const source of sources) if (source.secret) registerSecretUrl(source.url);
  const failures: string[] = [];
  for (const source of sources) {
    try {
      const block = await deps.probe(source.url);
      const node = await deps.start({ port, forkUrl: source.url, forkBlockNumber: block, forkUrlPublic: !source.secret });
      deps.log(`Sepolia fork: block ${block} (finalized) from ${source.label}.`);
      return { node, block, label: source.label, failures };
    } catch (error) {
      const reason = scrub(error instanceof Error ? error.message : String(error)).split("\n")[0]?.slice(0, 200) ?? "";
      failures.push(`${source.label}: ${reason}`);
      deps.log(`Sepolia fork: ${source.label} failed (${reason}).`);
    }
  }
  const tried = sources.some((source) => source.secret) ? "every public Sepolia RPC and SEPOLIA_RPC_URL" : "every public Sepolia RPC (SEPOLIA_RPC_URL isn't set)";
  throw new Error(`Sepolia fork: no endpoint served a fork; tried ${tried}.\n${failures.join("\n")}`);
}
