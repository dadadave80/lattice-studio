import { describe, expect, test } from "bun:test";
import { makeInit } from "../../testing/builders";
import { facetModule, mainModule } from "./specs";

describe("facetModule", () => {
  test("the entry named after the facet, when the init has one", () => {
    const spec = makeInit({ name: "ERC20Init", initializes: [{ module: "ERC20" }] });
    expect(facetModule("ERC20", spec)).toBe("ERC20");
  });

  test("ERC20VotesInit ends with AccessControl, but ERC20Votes is still its own module (spec L330, FX23)", () => {
    const spec = makeInit({
      name: "ERC20VotesInit",
      initializes: [{ module: "EIP712" }, { module: "Nonces" }, { module: "Votes" }, { module: "ERC20Votes" }, { module: "AccessControl" }],
    });
    expect(facetModule("ERC20Votes", spec)).toBe("ERC20Votes");
    expect(mainModule(spec)).toBe("AccessControl");
  });

  test("falls back to mainModule when no entry is named after the facet, as a bundle's own facet isn't (GovernedVaultInit has no \"GovernedVault\" entry)", () => {
    const spec = makeInit({ name: "GovernedVaultInit", kind: "bundle", initializes: [{ module: "AccessControl" }, { module: "Governor" }] });
    expect(facetModule("GovernedVault", spec)).toBe(mainModule(spec));
    expect(facetModule("GovernedVault", spec)).toBe("Governor");
  });

  test("falls back for a facet whose module is named differently, e.g. OwnableFacet -> Ownable", () => {
    const spec = makeInit({ name: "OwnableInit", initializes: [{ module: "Ownable" }] });
    expect(facetModule("OwnableFacet", spec)).toBe("Ownable");
    expect(facetModule("DiamondCutFacet", spec)).toBe("Ownable");
  });
});
