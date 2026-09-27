import { encodeAbiParameters, getContractAddress, keccak256 } from "viem";
import type { CreatexPredictFn, FactoryPredictFn } from "../model/api";
import { isAddress, sameAddress, type Address, type Hex } from "../model/hex";
import { assertBytes } from "./bytes";

/** The canonical CreateX singleton, the same on every chain (Lattice's script/lib/CreateXDeployer.sol L25). */
export const CREATEX: Address = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";

/**
 * The CREATE3 proxy CreateX CREATE2-deploys before the child (CreateX `_PROXY_CHILD_BYTECODE`; Lattice's
 * test/helpers/MockCreateX.sol L19). Its keccak256 is `0x21c35dbe…497c1f`.
 */
const CREATE3_PROXY_CHILD: Hex = "0x67363d3d37363d34f03d5260086018f3";
const CREATE3_PROXY_CHILD_HASH = keccak256(CREATE3_PROXY_CHILD);

/** `LatticeFactory.predict(address,bytes32)`, the view `factoryPredict` must agree with. */
export const FACTORY_PREDICT_SELECTOR: Hex = "0x64fb6f5e";

const ADDRESS_BYTES32 = [{ type: "address" }, { type: "bytes32" }] as const;
const ADDRESS_UINT256_BYTES32 = [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }] as const;
const UINT256_BYTES32 = [{ type: "uint256" }, { type: "bytes32" }] as const;
const BYTES32 = [{ type: "bytes32" }] as const;

function assertAddress(value: string, label: string): void {
  if (!isAddress(value)) throw new TypeError(`${label} must be an address, got ${JSON.stringify(value)}`);
}

/**
 * The address `LatticeFactory.deploy` gives a diamond, checksummed. Mirrors lattice/src/LatticeFactory.sol at the
 * pin: `_saltFor` (L169-L171) folds the sender in with the 64-byte ABI encoding,
 * `keccak256(abi.encode(deployer, salt))`, not the packed one; `_predict` (L174-L177) is plain CREATE2 from the
 * factory with `_diamondInitCodeHash = keccak256(type(Lattice).creationCode)` (L34-L35, L47). The result equals
 * `predict(from, salt)` (0x64fb6f5e) on that factory.
 */
export const factoryPredict: FactoryPredictFn = ({ factory, proxyInitCodeHash, from, salt }) => {
  assertAddress(factory, "factory");
  assertAddress(from, "from");
  assertBytes(salt, 32, "salt");
  assertBytes(proxyInitCodeHash, 32, "proxyInitCodeHash");
  const folded = keccak256(encodeAbiParameters(ADDRESS_BYTES32, [from, salt]));
  return getContractAddress({ opcode: "CREATE2", from: factory, salt: folded, bytecodeHash: proxyInitCodeHash });
};

/**
 * CreateX `_guard` with `msg.sender = from` and `block.chainid = chainId`: the salt CreateX actually hands to
 * CREATE2. Mirrors Lattice's faithful mock, test/helpers/MockCreateX.sol L30-L49, which reproduces upstream
 * CreateX.sol `_guard` and `_parseSalt`:
 * - first 20 bytes `from`, flag 0x01: `keccak256(abi.encode(from, chainid, salt))` (this chain only)
 * - first 20 bytes `from`, flag 0x00: `keccak256(bytes32(from) ‖ salt)`, which is `keccak256(abi.encode(from, salt))`
 * - first 20 bytes `from`, any other flag: CreateX reverts `InvalidSalt`
 * - first 20 bytes zero, flag 0x01: `keccak256(bytes32(chainid) ‖ salt)`
 * - first 20 bytes zero, a flag above 0x01: CreateX reverts `InvalidSalt`
 * - anything else: `keccak256(abi.encode(salt))`
 * Upstream leaves the salt unhashed in the last case only when it equals `_generateSalt()`, a value drawn from the
 * block being built; no prediction can hit it on purpose, so it isn't modeled. Studio only builds the first two.
 */
function guard(from: Address, salt: Hex, chainId: number): Hex {
  const prefix = `0x${salt.slice(2, 42)}`;
  const flag = salt.slice(42, 44).toLowerCase();
  if (sameAddress(prefix, from)) {
    if (flag === "01") return keccak256(encodeAbiParameters(ADDRESS_UINT256_BYTES32, [from, BigInt(chainId), salt]));
    if (flag === "00") return keccak256(encodeAbiParameters(ADDRESS_BYTES32, [from, salt]));
    throw new RangeError(`CreateX reverts InvalidSalt: the salt's flag byte is 0x${flag}, not 0x00 or 0x01`);
  }
  if (/^0x0{40}$/.test(prefix)) {
    if (flag === "01") return keccak256(encodeAbiParameters(UINT256_BYTES32, [BigInt(chainId), salt]));
    if (flag !== "00") throw new RangeError(`CreateX reverts InvalidSalt: a zero prefix with flag byte 0x${flag}`);
  }
  return keccak256(encodeAbiParameters(BYTES32, [salt]));
}

/**
 * The address `CreateX.deployCreate3(salt, initCode)` gives a diamond when `from` sends it on `chainId`,
 * checksummed. Studio always sends CreateX the raw `from ‖ flag ‖ entropy` salt; the guarded salt exists only
 * inside this prediction (spec R15). Then CreateX `computeCreate3Address(guarded, CREATEX)` (MockCreateX.sol
 * L85-L91): the CREATE3 proxy at CREATE2(CREATEX, guarded, keccak256(proxy child)), and the diamond at the proxy's
 * first CREATE (nonce 1), `keccak256(0xd694 ‖ proxy ‖ 0x01)[12:]`.
 * Throws for the two salt shapes CreateX rejects with `InvalidSalt` (see `guard`); `buildSalt` never makes them.
 */
export const createxPredict: CreatexPredictFn = (args) => {
  return getContractAddress({ opcode: "CREATE", from: createxProxy(args), nonce: 1n });
};

/**
 * The CREATE3 proxy CreateX makes for this `(from, salt, chainId)` before it creates the diamond, checksummed. After
 * a `FailedContractCreation` Studio reads code here and at the diamond's address (spec L75): code at the proxy means
 * the salt was used before. Throws as `createxPredict` does.
 */
export function createxProxy({ from, salt, chainId }: { from: Address; salt: Hex; chainId: number }): Address {
  assertAddress(from, "from");
  assertBytes(salt, 32, "salt");
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new RangeError(`chainId must be a positive integer, got ${chainId}`);
  return getContractAddress({ opcode: "CREATE2", from: CREATEX, salt: guard(from, salt, chainId), bytecodeHash: CREATE3_PROXY_CHILD_HASH });
}
