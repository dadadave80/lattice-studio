import { parseAbi } from "viem";
import type { AbiItem } from "../model/catalog";

/**
 * Errors Studio declares by hand, per module, because no catalog shard carries them (or a catalog may not):
 *
 * - CreateX (not a Lattice contract): `FailedContractInitialisation(address,bytes)` 0xa57ca239 and
 *   `FailedContractCreation(address)` 0xc05cee7a, both with CreateX's own address as the emitter, plus the rest of
 *   CreateX's custom errors.
 * - MultiInit (lattice/lib/diamond-lib/src/initializers/MultiInit.sol L6-L8).
 * - Lattice, the proxy: DiamondLib's errors (lattice/lib/diamond-lib/src/libraries/DiamondLib.sol L19-L64), which
 *   `Lattice.initialize` raises while it cuts and runs the init. `catalog.proxy.detail`, when a catalog has it,
 *   declares the same errors under the same module name.
 * - Initializable: `InvalidInitialization()` 0xf92ee8a9 and `NotInitializing()` 0xd7e6bcf8
 *   (lattice/src/utils/libraries/InitializableLib.sol L9-L12). They're raised in assembly, so no ABI lists them.
 */
export const KNOWN_ERRORS: Readonly<Record<string, readonly AbiItem[]>> = {
  Lattice: parseAbi([
    "error NoSelectorsGivenToAdd()",
    "error NoSelectorsProvidedForFacetCut(address facetAddress)",
    "error CannotAddSelectorsToZeroAddress(bytes4[] selectors)",
    "error NoBytecodeAtAddress(address contractAddress)",
    "error CannotAddFunctionToDiamondThatAlreadyExists(bytes4 selector)",
    "error CannotReplaceFunctionWithTheSameFunctionFromTheSameFacet(bytes4 selector)",
    "error RemoveFacetAddressMustBeZeroAddress(address facetAddress)",
    "error CannotRemoveFunctionThatDoesNotExist(bytes4 selector)",
    "error CannotAddThisAddress()",
    "error CannotRemoveImmutableFunction(bytes4 selector)",
    "error InitializeDiamondCutReverted(address initAddress, bytes data)",
    "error FunctionDoesNotExist(bytes4 functionSelector)",
  ]),
  CreateX: parseAbi([
    "error FailedContractCreation(address emitter)",
    "error FailedContractInitialisation(address emitter, bytes revertData)",
    "error InvalidSalt(address emitter)",
    "error InvalidNonceValue(address emitter)",
    "error FailedEtherTransfer(address emitter, bytes revertData)",
  ]),
  MultiInit: parseAbi([
    "error AddressAndCalldataLengthMismatch()",
    "error NoBytecodeAtAddress(address initAddress)",
    "error InitializeReverted(address initAddress, bytes initCalldata)",
  ]),
  Initializable: parseAbi(["error InvalidInitialization()", "error NotInitializing()"]),
};

/** Selectors the decoder treats specially. */
export const SELECTORS = {
  failedContractInitialisation: "0xa57ca239",
  failedContractCreation: "0xc05cee7a",
  initializeDiamondCutReverted: "0x2087c443",
  initializeReverted: "0x294a8420",
  noBytecodeAtAddress: "0xd94e3bbf",
  invalidInitialization: "0xf92ee8a9",
  notInitializing: "0xd7e6bcf8",
  error: "0x08c379a0",
  panic: "0x4e487b71",
} as const;

/** Solidity's built-in `Error(string)` and `Panic(uint256)`, which belong to no module. */
export const BUILTIN_ERRORS: readonly AbiItem[] = parseAbi(["error Error(string message)", "error Panic(uint256 code)"]);

/** Panic codes (Solidity docs, "Panic via assert and Error via require"). */
export const PANIC_REASONS: Readonly<Record<string, string>> = {
  "0x00": "generic panic",
  "0x01": "assertion failed",
  "0x11": "arithmetic overflow or underflow",
  "0x12": "division or modulo by zero",
  "0x21": "invalid enum value",
  "0x22": "invalid storage byte array",
  "0x31": "pop on an empty array",
  "0x32": "array index out of bounds",
  "0x41": "out of memory",
  "0x51": "call to an uninitialized function",
};
