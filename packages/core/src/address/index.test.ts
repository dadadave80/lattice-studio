import { describe, expect, test } from "bun:test";
import { concat, encodeAbiParameters, encodePacked, getAddress, keccak256, slice, stringToHex, toFunctionSelector } from "viem";
import { API_OWNERS, type ApiName } from "../model/api";
import type { Address, Hex } from "../model/hex";
import * as mod from "./index";
import {
  ARACHNID_PROXY, ARACHNID_PROXY_CODEHASH, arachnidAddress, assertSaltSender, buildSalt, CREATEX, createxPredict,
  FACTORY_PREDICT_SELECTOR, factoryPredict, newEntropy, sharedSalt,
} from "./index";

const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Anvil account 0
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Anvil account 1
const ENTROPY: Hex = "0x0102030405060708090a0b";
const HASH: Hex = "0x04179f92e2c71e8f53b9b27468a70160d12af5dfa618b53b7a550dcd97e1b6cd";

/** EIP-1014, written out: keccak256(0xff ‖ deployer ‖ salt ‖ initCodeHash)[12:]. */
function create2(deployer: Address, salt: Hex, initCodeHash: Hex): Address {
  return getAddress(slice(keccak256(concat(["0xff", deployer, salt, initCodeHash])), 12));
}

describe("module", () => {
  test("every C5b function is exported and built", () => {
    const owned = (Object.keys(API_OWNERS) as ApiName[]).filter((name) => API_OWNERS[name] === "C5b");
    expect(owned.sort()).toEqual(
      ["arachnidAddress", "assertSaltSender", "buildSalt", "createxPredict", "factoryPredict", "newEntropy", "sharedSalt"],
    );
    for (const name of owned) expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
    expect(() => newEntropy(() => new Uint8Array(11))).not.toThrow();
  });
});

describe("sharedSalt", () => {
  test("LatticeRegistry and LatticeFactory are versionless, as DeployRelease builds them (L93-L97)", () => {
    expect(sharedSalt("LatticeRegistry")).toBe("0xc78231000c48b308a55c9ed0de492d4ee766bc920c611d52ef984a4d9baa3a9c");
    expect(sharedSalt("LatticeFactory")).toBe("0x23ac1297d420218079953740f312f2c5385edfea1f817c984d2e6effea132efe");
    expect(sharedSalt("LatticeFactory", "0.4.0")).toBe(sharedSalt("LatticeFactory"));
    expect(sharedSalt("LatticeRegistry", "0.4.0")).toBe(sharedSalt("LatticeRegistry"));
  });

  test("facets and inits: keccak256(abi.encodePacked(\"lattice.\", name, \".\", version)) (L237-L238)", () => {
    const packed = encodePacked(["string", "string", "string", "string"], ["lattice.", "ERC20", ".", "0.1.0"]);
    expect(sharedSalt("ERC20", "0.1.0")).toBe(keccak256(packed));
    expect(sharedSalt("ERC20", "0.1.0")).toBe(keccak256(stringToHex("lattice.ERC20.0.1.0")));
    expect(sharedSalt("ERC20", "0.1.0")).not.toBe(sharedSalt("ERC20", "0.2.0"));
    expect(sharedSalt("GovernedVaultInit", "0.4.0")).toBe(keccak256(stringToHex("lattice.GovernedVaultInit.0.4.0")));
  });

  test("a versioned name without a version throws: lattice.<name> is the registry name hash, not a salt", () => {
    expect(() => sharedSalt("ERC20")).toThrow(TypeError);
    expect(() => sharedSalt("ERC20", "")).toThrow(TypeError);
  });
});

// Literals from the Anvil run in anvil.test.ts, which asserts the EVM produces these same addresses.
describe("vectors pinned from Anvil", () => {
  const entropy: Hex = "0xc5b0c5b0c5b0c5b0c5b0c5";

  test("Arachnid's proxy deploys 0x6001600c60003960016000f32a with salt lattice.ERC20.0.4.0 here", () => {
    expect(arachnidAddress(sharedSalt("ERC20", "0.4.0"), keccak256("0x6001600c60003960016000f32a"))).toBe(
      "0xfae5C553f52bB00C2f965bdD299d159A5b78f11d",
    );
  });

  test("LatticeFactory at 0x5FbD…0aa3 (pin f4a32c8) predicts this for Alice, every chain", () => {
    const salt = buildSalt(ALICE, "every-chain", entropy);
    expect(factoryPredict({ factory: "0x5FbDB2315678afecb367f032d93F642f64180aa3", proxyInitCodeHash: HASH, from: ALICE, salt })).toBe(
      "0x7E6EDbe7eC66DC17D0aebd572FaF9e3F75510631",
    );
  });

  test("CreateX deployCreate3 on chain 31337 for Alice, both flags", () => {
    expect(createxPredict({ from: ALICE, salt: buildSalt(ALICE, "every-chain", entropy), chainId: 31337 })).toBe(
      "0xCC01deC73922ed62B57f9f0d73fC4F733578Fe77",
    );
    expect(createxPredict({ from: ALICE, salt: buildSalt(ALICE, "this-chain", entropy), chainId: 31337 })).toBe(
      "0x45A0595f1a42CD051B20905dF00Dc227031fD786",
    );
  });
});

describe("arachnidAddress", () => {
  test("is CREATE2 from Arachnid's proxy, checksummed", () => {
    const salt = sharedSalt("LatticeFactory");
    expect(ARACHNID_PROXY).toBe(getAddress("0x4e59b44847b379578588920ca78fbf26c0b4956c"));
    expect(arachnidAddress(salt, HASH)).toBe(create2(ARACHNID_PROXY, salt, HASH));
    expect(arachnidAddress(salt, HASH)).toBe(getAddress(arachnidAddress(salt, HASH)));
  });

  test("commits to the bytecode and the salt", () => {
    const salt = sharedSalt("ERC20", "0.1.0");
    const other: Hex = `0x${"11".repeat(32)}`;
    expect(arachnidAddress(salt, HASH)).not.toBe(arachnidAddress(salt, other));
    expect(arachnidAddress(salt, HASH)).not.toBe(arachnidAddress(sharedSalt("ERC20", "0.2.0"), HASH));
  });

  test("the runtime codehash is the published one for S8a's probe", () => {
    expect(ARACHNID_PROXY_CODEHASH).toBe("0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989");
  });

  test("rejects a salt or hash that isn't 32 bytes", () => {
    expect(() => arachnidAddress("0x01", HASH)).toThrow(TypeError);
    expect(() => arachnidAddress(sharedSalt("ERC20", "0.1.0"), "0x1234")).toThrow(TypeError);
  });
});

describe("factoryPredict", () => {
  const factory: Address = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
  const salt = buildSalt(ALICE, "every-chain", ENTROPY);

  test("CREATE2(factory, keccak256(abi.encode(from, salt)), proxyInitCodeHash), LatticeFactory.sol L169-L177", () => {
    const folded = keccak256(concat([`0x${"00".repeat(12)}`, ALICE.toLowerCase() as Hex, salt]));
    expect(folded).toBe(keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [ALICE, salt])));
    expect(factoryPredict({ factory, proxyInitCodeHash: HASH, from: ALICE, salt })).toBe(create2(factory, folded, HASH));
  });

  test("folds with the 64-byte ABI encoding, not the packed one", () => {
    const packedFold = keccak256(encodePacked(["address", "bytes32"], [ALICE, salt]));
    expect(factoryPredict({ factory, proxyInitCodeHash: HASH, from: ALICE, salt })).not.toBe(create2(factory, packedFold, HASH));
  });

  test("is bound to the sender: the same salt from another account lands elsewhere (R8, L856)", () => {
    const a = factoryPredict({ factory, proxyInitCodeHash: HASH, from: ALICE, salt });
    const b = factoryPredict({ factory, proxyInitCodeHash: HASH, from: BOB, salt });
    expect(a).not.toBe(b);
  });

  test("letter case of the inputs doesn't change the address", () => {
    const lower = factoryPredict({ factory: factory.toLowerCase() as Address, proxyInitCodeHash: HASH, from: ALICE.toLowerCase() as Address, salt: salt.toUpperCase().replace("0X", "0x") as Hex });
    expect(lower).toBe(factoryPredict({ factory, proxyInitCodeHash: HASH, from: ALICE, salt }));
  });

  test("predict(address,bytes32) is 0x64fb6f5e", () => {
    expect(toFunctionSelector("predict(address,bytes32)")).toBe(FACTORY_PREDICT_SELECTOR);
  });
});

describe("createxPredict", () => {
  test("the CREATE3 proxy's init-code hash is CreateX's constant", () => {
    expect(keccak256("0x67363d3d37363d34f03d5260086018f3")).toBe("0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f");
    expect(CREATEX).toBe(getAddress("0xba5ed099633d3b313e4d5f7bdc1305d3c28ba5ed"));
  });

  test("flag 0x01: _guard is keccak256(abi.encode(from, chainid, salt)), then computeCreate3Address", () => {
    const salt = buildSalt(ALICE, "this-chain", ENTROPY);
    const guarded = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "bytes32" }], [ALICE, 11155111n, salt]));
    const proxy = create2(CREATEX, guarded, "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f");
    const child = getAddress(slice(keccak256(concat(["0xd694", proxy, "0x01"])), 12));
    expect(createxPredict({ from: ALICE, salt, chainId: 11155111 })).toBe(child);
  });

  test("flag 0x00: _guard is keccak256(bytes32(from) ‖ salt)", () => {
    const salt = buildSalt(ALICE, "every-chain", ENTROPY);
    const guarded = keccak256(concat([`0x${"00".repeat(12)}`, ALICE.toLowerCase() as Hex, salt]));
    const proxy = create2(CREATEX, guarded, "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f");
    const child = getAddress(slice(keccak256(concat(["0xd694", proxy, "0x01"])), 12));
    expect(createxPredict({ from: ALICE, salt, chainId: 1 })).toBe(child);
  });

  test("this chain only: two chain ids give two addresses", () => {
    const salt = buildSalt(ALICE, "this-chain", ENTROPY);
    expect(createxPredict({ from: ALICE, salt, chainId: 1 })).not.toBe(createxPredict({ from: ALICE, salt, chainId: 11155111 }));
  });

  test("every chain: two chain ids give the same address", () => {
    const salt = buildSalt(ALICE, "every-chain", ENTROPY);
    expect(createxPredict({ from: ALICE, salt, chainId: 1 })).toBe(createxPredict({ from: ALICE, salt, chainId: 11155111 }));
  });

  test("scope, sender and entropy each move the address", () => {
    const base = createxPredict({ from: ALICE, salt: buildSalt(ALICE, "every-chain", ENTROPY), chainId: 1 });
    expect(createxPredict({ from: ALICE, salt: buildSalt(ALICE, "this-chain", ENTROPY), chainId: 1 })).not.toBe(base);
    expect(createxPredict({ from: BOB, salt: buildSalt(BOB, "every-chain", ENTROPY), chainId: 1 })).not.toBe(base);
    expect(createxPredict({ from: ALICE, salt: buildSalt(ALICE, "every-chain", "0x0102030405060708090a0c"), chainId: 1 })).not.toBe(base);
  });

  test("a salt that isn't sender-prefixed follows CreateX's other _guard branches", () => {
    const create3 = (guarded: Hex): Address => {
      const proxy = create2(CREATEX, guarded, "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f");
      return getAddress(slice(keccak256(concat(["0xd694", proxy, "0x01"])), 12));
    };
    const foreign = buildSalt(BOB, "this-chain", ENTROPY);
    expect(createxPredict({ from: ALICE, salt: foreign, chainId: 1 })).toBe(create3(keccak256(foreign)));
    const zeroThisChain: Hex = `0x${"00".repeat(20)}01${ENTROPY.slice(2)}`;
    expect(createxPredict({ from: ALICE, salt: zeroThisChain, chainId: 5 })).toBe(
      create3(keccak256(concat([`0x${"00".repeat(31)}05`, zeroThisChain]))),
    );
    const zeroEveryChain: Hex = `0x${"00".repeat(20)}00${ENTROPY.slice(2)}`;
    expect(createxPredict({ from: ALICE, salt: zeroEveryChain, chainId: 5 })).toBe(create3(keccak256(zeroEveryChain)));
  });

  test("throws where CreateX reverts InvalidSalt", () => {
    const senderFlag2: Hex = `${ALICE.toLowerCase()}02${ENTROPY.slice(2)}` as Hex;
    expect(() => createxPredict({ from: ALICE, salt: senderFlag2, chainId: 1 })).toThrow("InvalidSalt");
    const zeroFlag2: Hex = `0x${"00".repeat(20)}02${ENTROPY.slice(2)}`;
    expect(() => createxPredict({ from: ALICE, salt: zeroFlag2, chainId: 1 })).toThrow("InvalidSalt");
  });

  test("rejects a bad chain id", () => {
    const salt = buildSalt(ALICE, "this-chain", ENTROPY);
    expect(() => createxPredict({ from: ALICE, salt, chainId: 0 })).toThrow(RangeError);
    expect(() => createxPredict({ from: ALICE, salt, chainId: 1.5 })).toThrow(RangeError);
  });
});

describe("buildSalt", () => {
  test("from ‖ flag ‖ entropy, 20 + 1 + 11 bytes, lowercase (L286, R15)", () => {
    const every = buildSalt(ALICE, "every-chain", ENTROPY);
    const here = buildSalt(ALICE, "this-chain", "0x0102030405060708090A0B");
    expect(every).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266000102030405060708090a0b");
    expect(here).toBe("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266010102030405060708090a0b");
    expect(every.length).toBe(66);
  });

  test("rejects entropy that isn't 11 bytes and a from that isn't an address", () => {
    expect(() => buildSalt(ALICE, "every-chain", "0x0102")).toThrow(TypeError);
    expect(() => buildSalt(ALICE, "every-chain", `0x${"00".repeat(12)}`)).toThrow(TypeError);
    expect(() => buildSalt("0x1234", "every-chain", ENTROPY)).toThrow(TypeError);
  });
});

describe("assertSaltSender", () => {
  test("ok when bytes20(salt) == from, whatever the letter case", () => {
    const salt = buildSalt(ALICE, "this-chain", ENTROPY);
    expect(assertSaltSender(salt, ALICE)).toEqual({ ok: true, value: salt });
    expect(assertSaltSender(salt, ALICE.toLowerCase() as Address)).toEqual({ ok: true, value: salt });
  });

  test("an error naming both accounts when the salt belongs to someone else", () => {
    const result = assertSaltSender(buildSalt(BOB, "every-chain", ENTROPY), ALICE);
    expect(result).toEqual({ ok: false, error: `The salt starts with ${BOB}, not the sending account ${ALICE}.` });
  });

  test("an error for a scope byte CreateX would reject, a short salt or a bad account", () => {
    const flag2 = `${ALICE.toLowerCase()}02${ENTROPY.slice(2)}` as Hex;
    expect(assertSaltSender(flag2, ALICE)).toEqual({ ok: false, error: "The salt's scope byte is 0x02; it must be 0x00 or 0x01." });
    expect(assertSaltSender("0x1234", ALICE).ok).toBe(false);
    expect(assertSaltSender(buildSalt(ALICE, "every-chain", ENTROPY), "0x1234").ok).toBe(false);
  });
});

describe("newEntropy", () => {
  test("11 bytes from the injected source, lowercase hex", () => {
    const calls: number[] = [];
    const random = (bytes: number): Uint8Array => {
      calls.push(bytes);
      return Uint8Array.from({ length: bytes }, (_, i) => 0xa0 + i);
    };
    expect(newEntropy(random)).toBe("0xa0a1a2a3a4a5a6a7a8a9aa");
    expect(calls).toEqual([11]);
  });

  test("deterministic for a deterministic source; round-trips through buildSalt", () => {
    const random = (bytes: number): Uint8Array => new Uint8Array(bytes).fill(7);
    expect(newEntropy(random)).toBe(newEntropy(random));
    expect(slice(buildSalt(ALICE, "every-chain", newEntropy(random)), 21)).toBe(newEntropy(random));
  });

  test("throws when the source returns the wrong length", () => {
    expect(() => newEntropy(() => new Uint8Array(10))).toThrow(TypeError);
  });
});
