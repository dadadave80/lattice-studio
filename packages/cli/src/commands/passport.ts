/**
 * `passport <address> --chain <id>`: what a deployed diamond runs, whether it matches a recipe, and its cut history,
 * read at one block. Reads only; never signs. Exit 0 when no claim fails, 1 when one does, 2 for invalid input or a
 * chain that can't be read, 3 when the recipe's catalog isn't bundled.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type Address, type Catalog, CREATEX, type Hex, sameAddress } from "@lattice-studio/core";
import { createPublicClient, http, keccak256, parseAbiItem, type Transport } from "viem";
import type { Parsed } from "../args";
import { parseAddress, parseChainId } from "../deploy";
import type { Deps } from "../deps";
import { EXIT, errorMessage, invalid } from "../failure";
import { readInput } from "../input";
import { fail, note, writeJson, writeLines } from "../output";
import { buildPassport, failed } from "../passport/build";
import { compareRouting } from "../passport/compare";
import { summarizeHistory } from "../passport/history";
import { identifyFacets } from "../passport/identify";
import type { CatalogPin, ChainFacts, CutAction, CutEvent, Deployment, LoupeFacet, RecipeFacts } from "../passport/types";
import { chainName, chooseRpc, httpTransport, readingNote, scrub } from "../probe";
import { analyzeInput, loadCatalogs } from "../session";

/** The EIP-2535 loupe's `facets()` and EIP-173's `owner()`. */
export const LOUPE_ABI = [
  {
    type: "function",
    name: "facets",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "facets_",
        type: "tuple[]",
        components: [
          { name: "facetAddress", type: "address" },
          { name: "functionSelectors", type: "bytes4[]" },
        ],
      },
    ],
  },
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;

/** EIP-2535's cut event, as diamond-lib emits it. Only the parameter types decide its topic. */
const DIAMOND_CUT = parseAbiItem(
  "event DiamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata)",
);

const OWNER_SELECTOR = "0x8da5cb5b";
/** Chains Envio HyperRPC serves among Studio's: Monad Testnet and mainnet, Sepolia, Base Sepolia. */
const ENVIO_CHAINS: ReadonlySet<number> = new Set([10143, 143, 11155111, 84532]);
const ACTIONS: readonly CutAction[] = ["add", "replace", "remove"];
const ZERO: Address = "0x0000000000000000000000000000000000000000";

type Client = ReturnType<typeof createPublicClient>;

/** HyperRPC gets one request at a time: no batching. */
function envioTransport(url: string): Transport {
  return http(url, { retryCount: 1, timeout: 30_000 });
}

/** An error's first line with every URL and every secret removed, without its final period. */
function clean(error: unknown, url: string, secrets: readonly string[]): string {
  let text = scrub(errorMessage(error), url);
  for (const secret of secrets) if (secret !== "") text = text.split(secret).join("<redacted>");
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

/** A read at the pinned block, else at latest: some RPCs refuse an explicit block number. */
async function pinned<T>(atBlock: () => Promise<T>, atLatest: () => Promise<T>): Promise<T> {
  try {
    return await atBlock();
  } catch {
    return await atLatest();
  }
}

/** DiamondCut logs at `address` from `from` to `to` in windows of `size` blocks, halving a window the provider refuses. */
async function readCuts(client: Client, address: Address, from: bigint, to: bigint, size: bigint, minSize: bigint, out: CutEvent[] = []): Promise<CutEvent[]> {
  if (from > to) return out;
  const end = from + size - 1n < to ? from + size - 1n : to;
  const result = await client.getLogs({ address, event: DIAMOND_CUT, fromBlock: from, toBlock: end }).then(
    (logs) => ({ ok: true as const, logs }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  if (!result.ok) {
    if (size <= minSize) throw result.error instanceof Error ? result.error : new Error(String(result.error));
    return readCuts(client, address, from, to, size / 2n < minSize ? minSize : size / 2n, minSize, out);
  }
  for (const log of result.logs) {
    out.push({
      block: Number(log.blockNumber ?? 0n),
      logIndex: log.logIndex ?? 0,
      txHash: (log.transactionHash ?? "0x") as Hex,
      init: (log.args._init ?? ZERO) as Address,
      cuts: (log.args._diamondCut ?? []).map((cut) => ({
        facet: cut.facetAddress as Address,
        action: ACTIONS[cut.action] ?? "unknown",
        selectors: cut.functionSelectors.map((selector) => selector.toLowerCase() as Hex),
      })),
    });
  }
  return readCuts(client, address, end + 1n, to, size, minSize, out);
}

/** Cut history: through HyperRPC with ENVIO_API_TOKEN, else through the RPC from --from-block, else not read. */
async function readHistory(
  client: Client,
  deps: Deps,
  address: Address,
  chainId: number,
  block: bigint,
  fromBlock: bigint | undefined,
  rpcUrl: string,
): Promise<{ history: CutEvent[] | null; source: ChainFacts["historySource"] }> {
  const token = deps.env["ENVIO_API_TOKEN"] ?? "";
  if (token !== "" && ENVIO_CHAINS.has(chainId)) {
    const url = `https://${chainId}.rpc.hypersync.xyz/${token}`;
    note(deps, "Reading cut history through Envio HyperRPC.");
    try {
      const envio = createPublicClient({ transport: (deps.transport ?? envioTransport)(url) });
      const head = await envio.getBlockNumber();
      const to = head < block ? head : block;
      const start = fromBlock ?? 0n;
      return { history: await readCuts(envio, address, start, to, to - start + 1n, 1_000_000n), source: "hyperrpc" };
    } catch (error) {
      note(deps, `Envio HyperRPC didn't answer (${clean(error, url, [token])}). History not read.`);
      return { history: null, source: null };
    }
  }
  if (fromBlock === undefined) return { history: null, source: null };
  try {
    return { history: await readCuts(client, address, fromBlock, block, 1_000n, 100n), source: "rpc" };
  } catch (error) {
    note(deps, `The RPC refused the log reads (${clean(error, rpcUrl, [])}). History not read.`);
    return { history: null, source: null };
  }
}

/** The earliest cut's transaction, and whether it went through LatticeFactory, CreateX or something else. */
async function findDeployment(client: Client, history: readonly CutEvent[], chainId: number, catalog: Catalog | undefined): Promise<Deployment | null> {
  const { deploymentTx, initial } = summarizeHistory(history);
  const first = initial[0];
  if (deploymentTx === null || first === undefined) return null;
  const tx = await client.getTransaction({ hash: deploymentTx });
  const to = (tx.to ?? null) as Address | null;
  const factory = catalog === undefined ? undefined : (catalog.chains.find((entry) => entry.chainId === chainId)?.factory?.address ?? catalog.factory.address);
  let via: Deployment["via"] = "other";
  if (to !== null && factory !== undefined && sameAddress(to, factory)) via = "LatticeFactory";
  else if (to !== null && sameAddress(to, CREATEX)) via = "CreateX";
  return { txHash: deploymentTx, block: first.block, from: tx.from as Address, to, via };
}

/** Every chain fact the passport needs, read at one block. */
async function readFacts(
  client: Client,
  deps: Deps,
  address: Address,
  chainId: number,
  name: string,
  fromBlock: bigint | undefined,
  catalog: Catalog | undefined,
  rpcUrl: string,
): Promise<ChainFacts> {
  const reported = await client.getChainId();
  if (reported !== chainId) throw new Error(`The RPC serves chain ${reported}, not ${chainId}. Pass an RPC for ${name}`);
  const block = await client.getBlockNumber();
  const code = await pinned(
    () => client.getCode({ address, blockNumber: block }),
    () => client.getCode({ address }),
  );
  const hasCode = code !== undefined && code !== "0x";

  let loupe: LoupeFacet[] | null = null;
  if (hasCode) {
    try {
      const rows = await pinned(
        () => client.readContract({ address, abi: LOUPE_ABI, functionName: "facets", blockNumber: block }),
        () => client.readContract({ address, abi: LOUPE_ABI, functionName: "facets" }),
      );
      loupe = rows.map((row) => ({
        address: row.facetAddress as Address,
        selectors: row.functionSelectors.map((selector) => selector.toLowerCase() as Hex),
      }));
    } catch {
      loupe = null;
    }
  }

  const facetAddresses = [...new Set((loupe ?? []).map((row) => row.address.toLowerCase()))].filter((key) => key !== address.toLowerCase());
  const codes = await Promise.all(
    facetAddresses.map((key) =>
      pinned(
        () => client.getCode({ address: key as Address, blockNumber: block }),
        () => client.getCode({ address: key as Address }),
      ),
    ),
  );
  const codehashes: Record<string, Hex> = {};
  for (const [i, key] of facetAddresses.entries()) {
    const facetCode = codes[i];
    if (facetCode !== undefined && facetCode !== "0x") codehashes[key] = keccak256(facetCode);
  }

  const ownerRouted = (loupe ?? []).some((row) => row.selectors.some((selector) => selector === OWNER_SELECTOR));
  let owner: Address | null = null;
  if (ownerRouted) {
    try {
      owner = (await pinned(
        () => client.readContract({ address, abi: LOUPE_ABI, functionName: "owner", blockNumber: block }),
        () => client.readContract({ address, abi: LOUPE_ABI, functionName: "owner" }),
      )) as Address;
    } catch {
      owner = null;
    }
  }

  const { history, source } = await readHistory(client, deps, address, chainId, block, fromBlock, rpcUrl);
  let deployment: Deployment | null = null;
  if (history !== null) {
    try {
      deployment = await findDeployment(client, history, chainId, catalog);
    } catch (error) {
      note(deps, `The deployment transaction couldn't be read (${clean(error, rpcUrl, [])}).`);
    }
  }
  return { chainId, chainName: name, address, block: Number(block), hasCode, loupe, codehashes, history, historySource: source, deployment, ownerRouted, owner };
}

export async function runPassport(parsed: Parsed, deps: Deps): Promise<number> {
  const { values } = parsed;
  const json = values.json === true;
  if (parsed.args.length !== 1) {
    return fail(deps, json, invalid("passport takes one address, for example: lattice-studio passport 0x… --chain 10143."));
  }
  const address = parseAddress(parsed.args[0], "passport");
  if (!address.ok) return fail(deps, json, address.error);
  const chainId = parseChainId(values.chain?.[0]);
  if (!chainId.ok) return fail(deps, json, chainId.error);
  const fromFlag = values["from-block"];
  if (fromFlag !== undefined && !/^[0-9]+$/.test(fromFlag)) return fail(deps, json, invalid(`--from-block ${fromFlag} isn't a block number.`));
  const fromBlock = fromFlag === undefined ? undefined : BigInt(fromFlag);

  const set = await loadCatalogs(values, deps);
  if (!set.ok) return fail(deps, json, set.error);
  const catalogs: Catalog[] = set.value.catalogs.map((entry) => entry.catalog);

  // --recipe is validated (exit 2) and its catalog required (exit 3) before anything is read from the chain.
  let input: Awaited<ReturnType<typeof readInput>> | undefined;
  if (values.recipe !== undefined) {
    input = await readInput(values.recipe, deps.cwd, set.value);
    if (!input.ok) return fail(deps, json, input.error);
  }
  const catalog = input?.ok === true ? input.value.loaded.catalog : catalogs[0];

  const name = chainName(chainId.value);
  const rpc = chooseRpc(values.rpc, deps.env["LATTICE_STUDIO_RPC_URL"], chainId.value);
  if (rpc === undefined) return fail(deps, json, invalid(`${name} has no public RPC Studio knows. Pass --rpc <url> or set LATTICE_STUDIO_RPC_URL.`));
  note(deps, readingNote(chainId.value, rpc));
  const client = createPublicClient({ transport: (deps.transport ?? httpTransport)(rpc.url) });

  let facts: ChainFacts;
  try {
    facts = await readFacts(client, deps, address.value, chainId.value, name, fromBlock, catalog, rpc.url);
  } catch (error) {
    return fail(deps, json, invalid(`Reading ${name} (${chainId.value}) failed: ${clean(error, rpc.url, [deps.env["ENVIO_API_TOKEN"] ?? ""])}.`));
  }

  let recipe: RecipeFacts | null = null;
  let pin: CatalogPin | null = catalog === undefined ? null : { tag: catalog.lattice.tag, hash: catalog.hash };
  if (input?.ok === true) {
    const analyzed = analyzeInput(input.value, values);
    if (!analyzed.ok) return fail(deps, json, analyzed.error);
    const { plan, recipeHash } = analyzed.value.analysis;
    pin = { tag: input.value.recipe.catalog.tag, hash: input.value.recipe.catalog.hash };
    recipe = {
      recipeHash,
      catalog: pin,
      diff: compareRouting(plan, facts.loupe ?? []),
      selectors: plan.reduce((sum, entry) => sum + entry.selectors.length, 0),
      facets: plan.length,
    };
  }

  const identified = identifyFacets(facts.loupe ?? [], facts.codehashes, catalogs, address.value);
  const passport = buildPassport(facts, identified, recipe, pin);

  if (values.out !== undefined) {
    try {
      await writeFile(resolve(deps.cwd, values.out), `${JSON.stringify(passport, null, 2)}\n`);
    } catch (error) {
      return fail(deps, json, invalid(`${values.out} can't be written: ${errorMessage(error)}`));
    }
    note(deps, `Wrote passport to ${values.out} · digest ${passport.digest.slice(0, 6)}…${passport.digest.slice(-4)}`);
  }
  if (json) writeJson(deps, passport);
  else writeLines(deps, passport.claims.map((item) => `${item.status.toUpperCase().padEnd(4)} ${item.id}  ${item.message}`));
  return failed(passport) ? EXIT.blockers : EXIT.ok;
}
