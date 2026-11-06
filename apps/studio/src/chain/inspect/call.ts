import { isAddress, isHexAnyCase, type Address, type Hex, type Result } from "@lattice-studio/core";
import { BaseError, ContractFunctionRevertedError, ExecutionRevertedError } from "viem";
import { call, getChainId } from "viem/actions";
import type { ChainCallError, ChainCallOptions } from "@/contracts/chain";
import type { ChainClient } from "../infra/clients";
import { revertData } from "../deploy/viem-port";

/** Raw chain-only call. Explicit pins are never replaced with latest, and revert bytes survive decoding later. */
export async function readOnchainCall(client: ChainClient, to: Address, data: Hex, options: ChainCallOptions = {}): Promise<Result<Hex, ChainCallError>> {
  const fail = (reason: string, bytes: Hex | null = null): Result<never, ChainCallError> => ({ ok: false, error: { reason, data: bytes } });
  if (!isAddress(to) || !isHexAnyCase(data) || (options.from !== undefined && !isAddress(options.from))) return fail("Enter a valid contract address, caller and calldata.");
  if (options.block !== undefined && (!Number.isSafeInteger(options.block) || options.block < 0)) return fail("Enter a valid block number.");
  if (options.blockHash !== undefined && !/^0x[\da-f]{64}$/i.test(options.blockHash)) return fail("Enter a valid block hash.");
  if (options.block !== undefined && options.blockHash !== undefined) return fail("Choose a block number or block hash, not both.");
  if (options.value !== undefined && (typeof options.value !== "bigint" || options.value < 0n)) return fail("Enter a nonnegative value in wei.");
  try {
    const chainId = await getChainId(client);
    if (chainId !== client.chain.id) return fail(`The RPC serves chain ${chainId}, not chain ${client.chain.id}.`);
    const pin = options.blockHash !== undefined ? { blockHash: options.blockHash, requireCanonical: true as const }
      : options.block !== undefined ? { blockNumber: BigInt(options.block) } : {};
    const result = await call({ ...client, ccipRead: false }, {
      to, data, ...pin,
      ...(options.from === undefined ? {} : { account: options.from }),
      ...(options.value === undefined ? {} : { value: options.value }),
    });
    const value = result.data ?? "0x";
    return isHexAnyCase(value) ? { ok: true, value } : fail("The RPC returned malformed call data.");
  } catch (error) {
    if (error instanceof BaseError && error.walk((cause) => cause instanceof ExecutionRevertedError || cause instanceof ContractFunctionRevertedError) !== null) {
      const bytes = revertData(error);
      return fail("The call reverted.", bytes !== null && isHexAnyCase(bytes) ? bytes : null);
    }
    return fail("The RPC couldn't finish the contract call.");
  }
}
