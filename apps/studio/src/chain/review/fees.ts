/**
 * The Cost section's fees (spec L571): an "about" and a "max" fee for the deploy's gas, and the L1 data fee on OP
 * Stack chains. Neither `ChainState` nor `DeployState` carries fee data, so the review reads it from the chain
 * module's viem client itself (S8a's `ChainRuntime.publicClient`). Tests replace the reader with `provideFeeReader`.
 */
import type { Result, TxRequest } from "@lattice-studio/core";
import { parseAbi, serializeTransaction } from "viem";
import { estimateFeesPerGas, getBlock, readContract } from "viem/actions";
import { chainService } from "@/contracts";
import type { ChainRuntime } from "@/chain/infra/service";

/** Fees in wei for the deploy's gas. */
export type FeeQuote = {
  /** gas × (base fee + priority fee): what the deploy likely costs. */
  about: bigint;
  /** gas × max fee per gas: the most it can cost. */
  max: bigint;
  /** The L1 data fee an OP Stack chain adds (spec L571). */
  l1?: bigint;
};

export type FeeReader = (chainId: number, tx: TxRequest, gas: bigint) => Promise<Result<FeeQuote, string>>;

/** OP Stack chains, whose GasPriceOracle charges an L1 data fee (Optimism, Base and their Sepolia testnets). */
export const OP_STACK_CHAINS: ReadonlySet<number> = new Set([10, 8453, 11155420, 84532]);

const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F";
const ORACLE_ABI = parseAbi(["function getL1Fee(bytes _data) view returns (uint256)"]);

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error);
}

async function readFromChain(chainId: number, tx: TxRequest, gas: bigint): Promise<Result<FeeQuote, string>> {
  try {
    const service = (await chainService()) as Partial<ChainRuntime>;
    // S8a's runtime carries each chain's viem client; a test's fake service has none.
    if (typeof service.publicClient !== "function") return { ok: false, error: "The chain service in use has no viem clients." };
    const client = service.publicClient(chainId);
    const [fees, block] = await Promise.all([estimateFeesPerGas(client), getBlock(client)]);
    const priority = fees.maxPriorityFeePerGas ?? 0n;
    const base = block.baseFeePerGas ?? 0n;
    const quote: FeeQuote = { about: gas * (base + priority), max: gas * (fees.maxFeePerGas ?? base + priority) };
    if (OP_STACK_CHAINS.has(chainId)) {
      const unsigned = serializeTransaction({
        chainId, to: tx.to, data: tx.data, value: tx.value, gas, type: "eip1559", nonce: 0,
        maxFeePerGas: fees.maxFeePerGas ?? base + priority, maxPriorityFeePerGas: priority,
      });
      quote.l1 = await readContract(client, { address: GAS_PRICE_ORACLE, abi: ORACLE_ABI, functionName: "getL1Fee", args: [unsigned] });
    }
    return { ok: true, value: quote };
  } catch (error) {
    return { ok: false, error: reasonOf(error) };
  }
}

let reader: FeeReader = readFromChain;

export function readFees(chainId: number, tx: TxRequest, gas: bigint): Promise<Result<FeeQuote, string>> {
  return reader(chainId, tx, gas);
}

/** Replaces the fee reader (tests); returns a disposer that puts the previous one back. */
export function provideFeeReader(next: FeeReader): () => void {
  const previous = reader;
  reader = next;
  return () => {
    if (reader === next) reader = previous;
  };
}
