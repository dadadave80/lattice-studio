import { describe, expect, test } from "bun:test";
import * as s8a from "@/chain/infra/copy";
import { FIXTURE_CATALOG as S8A_FIXTURE, catalogDeployBlock } from "@/chain/infra";
import * as review from "./copy";
import { FIXTURE_CATALOG, fixtureBlock } from "./entry-copy";

describe("the review's mirror of S8a's words stays equal to them", () => {
  test("sentences", () => {
    expect(review.LOADING_WALLET_SUPPORT).toBe(s8a.LOADING_WALLET_SUPPORT);
    expect(review.CHAIN_CHECKS_NEED_CONNECTION).toBe(s8a.CHAIN_CHECKS_NEED_CONNECTION);
    expect(review.NO_WALLET).toBe(s8a.NO_WALLET);
    expect(review.CANCELED_IN_WALLET).toBe(s8a.CANCELED_IN_WALLET);
    expect(review.CONNECT_A_WALLET).toBe(s8a.CONNECT_A_WALLET);
    expect(review.CHOOSE_A_CHAIN).toBe(s8a.CHOOSE_A_CHAIN);
    expect(review.checking("Sepolia")).toBe(s8a.checking("Sepolia"));
    expect(review.walletOn("Base Sepolia")).toBe(s8a.walletOn("Base Sepolia"));
    expect(review.needsFunds(12n * 10n ** 15n, 4n * 10n ** 15n)).toBe(s8a.needsFunds(12n * 10n ** 15n, 4n * 10n ** 15n));
  });

  test("the fixture-catalog block", () => {
    expect(FIXTURE_CATALOG).toBe(S8A_FIXTURE);
    for (const tag of ["fixture", "fixture-next", "v0.4.0", "dev-f4a32c8"]) {
      expect(fixtureBlock(tag)).toBe(catalogDeployBlock({ lattice: { tag, commit: "" } }));
    }
  });
});
