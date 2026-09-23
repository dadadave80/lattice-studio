/**
 * A local Anvil for the generator (CG1, CG2): start it on a free port from `ANVIL_PORT_BASE`, deploy creation code
 * through Arachnid's deterministic deployment proxy (on Anvil by default), `eth_call`, stop. Local only: nothing
 * here takes an RPC URL.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, err, type Hex, type Hex4, ok, type Result } from "@lattice-studio/core";
import { concat, getContractAddress, pad } from "viem";
import { decodeExportSelectors, SELF_SELECTOR } from "./artifacts";

/** Arachnid's deterministic deployment proxy: calldata is `salt ++ creationCode`, CREATE2 from this address. */
export const ARACHNID_DEPLOYER: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
/** Default salt for deployments whose address doesn't matter (reading selectors), and Forge's library salt. */
export const ZERO_SALT: Hex = pad("0x", { size: 32 });

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DEFAULT_ANVIL_PORT = 8545;

/**
 * A setting from the environment, else from the repo root's `.env.local` (which `bun test` doesn't load), else
 * undefined (contracts §2 "Ports and environment").
 */
export function studioEnv(name: string, root: string = REPO_ROOT): string | undefined {
  const fromEnv = process.env[name];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  const file = join(root, ".env.local");
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && m[1] === name) return (m[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  }
  return undefined;
}

/** A JSON-RPC error from Anvil. */
export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(method: string, code: number, message: string, data: unknown) {
    super(`${method}: ${message}`);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

/** A running Anvil. Call `stop()` when done; it's safe to call twice. */
export type AnvilHandle = {
  port: number;
  url: string;
  request<T = unknown>(method: string, params?: unknown[]): Promise<T>;
  stop(): Promise<void>;
};

export type StartAnvilOptions = {
  /** First port to try; defaults to `ANVIL_PORT_BASE`, then 8545. */
  portBase?: number;
  /** How many consecutive ports to try (default 16). */
  attempts?: number;
  /** Extra anvil arguments. */
  args?: string[];
  /** The anvil binary (default `anvil` on PATH). */
  bin?: string;
  /** How long to wait for it to answer (default 15 s). */
  timeoutMs?: number;
};

async function portFree(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

function rpc(url: string): AnvilHandle["request"] {
  let id = 0;
  return async <T>(method: string, params: unknown[] = []): Promise<T> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = (await res.json()) as { result?: T; error?: { code: number; message: string; data?: unknown } };
    if (body.error) throw new RpcError(method, body.error.code, body.error.message, body.error.data);
    return body.result as T;
  };
}

/**
 * Starts Anvil on the first free port at or above the base and waits until it answers. Anvil's defaults
 * include Arachnid's proxy, its ten funded accounts and automine.
 */
export async function startAnvil(options: StartAnvilOptions = {}): Promise<Result<AnvilHandle, string>> {
  const base = options.portBase ?? Number(studioEnv("ANVIL_PORT_BASE") ?? DEFAULT_ANVIL_PORT);
  const attempts = options.attempts ?? 16;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const bin = options.bin ?? "anvil";
  if (Bun.which(bin) === null && !existsSync(bin)) return err(`${bin} isn't installed. Install Foundry 1.8.3.`);

  for (let port = base; port < base + attempts; port++) {
    if (!(await portFree(port))) continue;
    const proc = Bun.spawn([bin, "--host", "127.0.0.1", "--port", String(port), ...(options.args ?? [])], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const url = `http://127.0.0.1:${port}`;
    const request = rpc(url);
    let stopped = false;
    const stop = async (): Promise<void> => {
      if (stopped) return;
      stopped = true;
      proc.kill();
      await proc.exited;
    };
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && proc.exitCode === null) {
      try {
        await request("eth_chainId");
        return ok({ port, url, request, stop });
      } catch {
        await Bun.sleep(50);
      }
    }
    await stop();
    if (Date.now() >= deadline) return err(`anvil didn't answer on port ${port} within ${timeoutMs} ms.`);
  }
  return err(`no free port for anvil in ${base}-${base + attempts - 1}.`);
}

/** `eth_getCode` at the latest block. */
export async function getCode(anvil: AnvilHandle, address: Address): Promise<Hex> {
  return anvil.request<Hex>("eth_getCode", [address, "latest"]);
}

/** `eth_call` at the latest block; a revert or RPC failure comes back as the error. */
export async function ethCall(anvil: AnvilHandle, to: Address, data: Hex): Promise<Result<Hex, string>> {
  try {
    return ok(await anvil.request<Hex>("eth_call", [{ to, data }, "latest"]));
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

const RECEIPT_TIMEOUT_MS = 10_000;

/** Polls for a receipt: Anvil automines, but the receipt can lag the `eth_sendTransaction` answer. */
async function waitForReceipt(anvil: AnvilHandle, hash: Hex): Promise<{ status: Hex } | null> {
  const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const receipt = await anvil.request<{ status: Hex } | null>("eth_getTransactionReceipt", [hash]);
    if (receipt !== null) return receipt;
    await Bun.sleep(10);
  }
  return null;
}

/** Where Arachnid's proxy puts `creationCode` under `salt`. */
export function arachnidTarget(creationCode: Hex, salt: Hex = ZERO_SALT): Address {
  return getContractAddress({ opcode: "CREATE2", from: ARACHNID_DEPLOYER, salt, bytecode: creationCode });
}

/**
 * Deploys creation code (constructor arguments already appended, libraries linked) through Arachnid's proxy from
 * Anvil's first account, and returns the CREATE2 address once code is there. Code already at that address is the
 * same contract by construction, so it's reused.
 */
export async function deployViaArachnid(
  anvil: AnvilHandle,
  creationCode: Hex,
  salt: Hex = ZERO_SALT,
): Promise<Result<Address, string>> {
  try {
    if ((await getCode(anvil, ARACHNID_DEPLOYER)) === "0x") {
      return err(`Arachnid's deployment proxy isn't at ${ARACHNID_DEPLOYER} on this chain.`);
    }
    const target = arachnidTarget(creationCode, salt);
    if ((await getCode(anvil, target)) !== "0x") return ok(target);
    const [from] = await anvil.request<Address[]>("eth_accounts");
    if (from === undefined) return err("anvil has no unlocked account.");
    const hash = await anvil.request<Hex>("eth_sendTransaction", [
      { from, to: ARACHNID_DEPLOYER, data: concat([salt, creationCode]) },
    ]);
    const receipt = await waitForReceipt(anvil, hash);
    if (receipt === null) return err(`no receipt for ${hash} after ${RECEIPT_TIMEOUT_MS} ms.`);
    if (receipt.status !== "0x1") return err(`deployment through Arachnid's proxy reverted (tx ${hash}).`);
    if ((await getCode(anvil, target)) === "0x") return err(`no code at ${target} after deploying.`);
    return ok(target);
  } catch (e) {
    return err(`deployment through Arachnid's proxy failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Calls `exportSelectors()` on a deployed facet and decodes the packed selectors, in the facet's own order. */
export async function readExportSelectors(anvil: AnvilHandle, facet: Address): Promise<Result<Hex4[], string>> {
  const res = await ethCall(anvil, facet, SELF_SELECTOR);
  if (!res.ok) return err(`exportSelectors() reverted: ${res.error}`);
  return decodeExportSelectors(res.value);
}
