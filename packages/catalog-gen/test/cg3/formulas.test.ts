/**
 * The two slot formulas (spec R13; contracts §4): ERC-7201 namespaces and ERC-165 support-map slots. Every
 * expected value below is copied verbatim from the pinned Lattice's own NatSpec comments (never recomputed by
 * hand), so a regression here means the formula itself drifted from what Lattice documents.
 */
import { describe, expect, test } from "bun:test";
import { erc165MapSlot, erc7201Slot } from "../../src/storage";

describe("erc7201Slot", () => {
  test("matches DiamondLib.sol's own namespace", () => {
    expect(erc7201Slot("diamond.lib.storage")).toBe("0x6d5a93fec60e12d72b781fe97b2b5406e385b9eaa23d3ec2fbfa067f9d0dc000");
  });

  test("matches ERC165Lib.sol's shared ERC-165 base", () => {
    expect(erc7201Slot("diamond.lib.storage.ERC165")).toBe(
      "0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200",
    );
  });

  test("matches ERC20Lib.sol's own namespace", () => {
    expect(erc7201Slot("lattice.storage.ERC20")).toBe("0x948387732d07f6e6ec1c3bf1559c10e90e518c5a59f5d2be5a80edb6f2494300");
  });

  test("masks off the low byte", () => {
    expect(erc7201Slot("anything").slice(-2)).toBe("00");
    expect(erc7201Slot("anything")).toHaveLength(66);
  });
});

describe("erc165MapSlot", () => {
  const base = "0x9ca7f3e2e2bfb15fdf072b85dde92837cddacee6cf2f6b38cd06c9457c1c4200";

  test("matches ERC20Lib.sol's IERC20 map entry", () => {
    expect(erc165MapSlot("0x942e8b22", base)).toBe("0xc99f0f757c400475fa5e27e7e237b05409e3b11dbfd9a8930fb35692da3f3a3d");
  });

  test("matches AccessControlLib.sol's IAccessControl map entry", () => {
    expect(erc165MapSlot("0x7965db0b", base)).toBe("0xce317eb1da4e1492e501dc3f63d2206e3e9294a33442f09d99ce09cbbaaeae1f");
  });

  test("the waived bug: keccak256(abi.encode(bytes4(0), base)) is NOT keccak256(bytes32(0))", () => {
    const computed = erc165MapSlot("0x00000000", base);
    expect(computed).toBe("0xfb939cb1ca033f66389071014066e3ba51464fd8ec15c96518ea9663d9c0f494");
    expect(computed).not.toBe("0x290decd9548b62a8d60345a988386fc84ba6bc95484008f6362f93160ef3e563");
  });
});
