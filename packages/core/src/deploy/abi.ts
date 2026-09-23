import type { Address, Hex } from "../model/hex";

/**
 * Multicall3, the same address on every chain where its keyless deploy landed. Its deployer key is compromised
 * and at least one chain holds a different contract here (spec L842), so Studio batches through it only when
 * the chain module found the canonical codehash.
 */
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

/** `FacetCut` from diamond-lib's DiamondLib.sol (L102-L106): `(address facetAddress, uint8 action, bytes4[] functionSelectors)`. */
const FACET_CUT = {
  type: "tuple[]",
  components: [
    { name: "facetAddress", type: "address" },
    { name: "action", type: "uint8" },
    { name: "functionSelectors", type: "bytes4[]" },
  ],
} as const;

/**
 * LatticeFactory at the pin (lattice/src/LatticeFactory.sol, ILatticeFactory.sol): `deploy`, `predict` and the
 * `DiamondDeployed` event. `deploy` returns the existing diamond for a repeat `(sender, salt)` without emitting
 * `DiamondDeployed` (LatticeFactory.sol `if (diamond.code.length != 0) return diamond;`).
 */
export const LATTICE_FACTORY_ABI = [
  {
    type: "function",
    name: "deploy",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "nameHash", type: "bytes32" },
          { name: "version", type: "uint64" },
        ],
      },
      { name: "customCuts", ...FACET_CUT },
      { name: "init", type: "address" },
      { name: "initCalldata", type: "bytes" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "diamond", type: "address" }],
  },
  {
    type: "function",
    name: "predict",
    stateMutability: "view",
    inputs: [
      { name: "deployer", type: "address" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "diamond", type: "address" }],
  },
  {
    type: "event",
    name: "DiamondDeployed",
    anonymous: false,
    inputs: [
      { name: "diamond", type: "address", indexed: true },
      { name: "deployer", type: "address", indexed: true },
      { name: "salt", type: "bytes32", indexed: false },
    ],
  },
] as const;

/** `Lattice.initialize(FacetCut[], address, bytes)` (lattice/src/Lattice.sol): first-caller-wins (R6). */
export const LATTICE_INITIALIZE_ABI = [
  {
    type: "function",
    name: "initialize",
    stateMutability: "payable",
    inputs: [
      { name: "_facetCuts", ...FACET_CUT },
      { name: "_init", type: "address" },
      { name: "_calldata", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

/**
 * CreateX `deployCreate3AndInit(bytes32 salt, bytes initCode, bytes data, Values values)` without a refund
 * address (CreateX refunds `msg.sender`). `Values` is `(uint256 constructorAmount, uint256 initCallAmount)`.
 */
export const CREATEX_ABI = [
  {
    type: "function",
    name: "deployCreate3AndInit",
    stateMutability: "payable",
    inputs: [
      { name: "salt", type: "bytes32" },
      { name: "initCode", type: "bytes" },
      { name: "data", type: "bytes" },
      {
        name: "values",
        type: "tuple",
        components: [
          { name: "constructorAmount", type: "uint256" },
          { name: "initCallAmount", type: "uint256" },
        ],
      },
    ],
    outputs: [{ name: "newContract", type: "address" }],
  },
] as const;

/**
 * Multicall3 `aggregate3((address target, bool allowFailure, bytes callData)[])`, returning
 * `(bool success, bytes returnData)[]`. For an Arachnid call, `returnData` is the 20 raw address bytes the proxy
 * returns, not an ABI-encoded address.
 */
export const MULTICALL3_ABI = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "payable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

/** `LatticeFactory.deploy((bytes32,uint64)[],(address,uint8,bytes4[])[],address,bytes,bytes32)`. */
export const FACTORY_DEPLOY_SELECTOR: Hex = "0x533677de";
/** `CreateX.deployCreate3AndInit(bytes32,bytes,bytes,(uint256,uint256))`. */
export const CREATEX_DEPLOY_SELECTOR: Hex = "0x00d84acb";
/** `Multicall3.aggregate3((address,bool,bytes)[])`. */
export const AGGREGATE3_SELECTOR: Hex = "0x82ad56cb";
