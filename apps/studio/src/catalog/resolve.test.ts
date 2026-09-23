import { describe, expect, test } from "bun:test";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { resolveRelease, shardRef } from "./resolve";

const fixture = loadFixtureCatalog();

describe("resolveRelease", () => {
  test.skipIf(!fixture.ok)("LatticeRegistry and LatticeFactory resolve to the catalog's own releases", () => {
    if (!fixture.ok) return;
    expect(resolveRelease(fixture.value, "LatticeRegistry")).toEqual({ release: fixture.value.registry });
    expect(resolveRelease(fixture.value, "LatticeFactory")).toEqual({ release: fixture.value.factory });
  });

  test.skipIf(!fixture.ok)("a library resolves by name (PoseidonT3)", () => {
    if (!fixture.ok) return;
    const library = fixture.value.libraries?.find((entry) => entry.name === "PoseidonT3");
    if (!library) throw new Error("fixture has no PoseidonT3 library");
    expect(resolveRelease(fixture.value, "PoseidonT3")).toEqual({ release: library.release });
  });

  test.skipIf(!fixture.ok)("a facet resolves by name, with its detail shard", () => {
    if (!fixture.ok) return;
    const facet = fixture.value.facets.find((entry) => entry.name === "AccessControl");
    if (!facet) throw new Error("fixture has no AccessControl facet");
    expect(resolveRelease(fixture.value, "AccessControl")).toEqual({ release: facet.release, detail: facet.detail });
  });

  test.skipIf(!fixture.ok)("an init with two entry points resolves by contract (DiamondIntrospectionInit)", () => {
    if (!fixture.ok) return;
    const upgradeable = fixture.value.inits.find((entry) => entry.name === "DiamondIntrospectionInit.initUpgradeable");
    if (!upgradeable?.release) throw new Error("fixture has no DiamondIntrospectionInit.initUpgradeable release");
    // Two specs share one contract; resolving by the contract name finds the first one, same as missing.ts.
    expect(resolveRelease(fixture.value, "DiamondIntrospectionInit")).toEqual({ release: upgradeable.release });
  });

  test.skipIf(!fixture.ok)("an init also resolves by its own spec name", () => {
    if (!fixture.ok) return;
    const immutable = fixture.value.inits.find((entry) => entry.name === "DiamondIntrospectionInit.initImmutable");
    if (!immutable?.release) throw new Error("fixture has no DiamondIntrospectionInit.initImmutable release");
    expect(resolveRelease(fixture.value, "DiamondIntrospectionInit.initImmutable")).toEqual({ release: immutable.release });
  });

  test.skipIf(!fixture.ok)("an unknown name resolves to nothing", () => {
    if (!fixture.ok) return;
    expect(resolveRelease(fixture.value, "NoSuchThing")).toBeUndefined();
  });
});

describe("shardRef", () => {
  test.skipIf(!fixture.ok)("\"Lattice\" is the proxy, not a facet or shared contract", () => {
    if (!fixture.ok) return;
    expect(shardRef(fixture.value, "Lattice", "code")).toEqual(fixture.value.proxy.creationCode);
    expect(shardRef(fixture.value, "Lattice", "detail")).toEqual(fixture.value.proxy.detail);
  });

  test.skipIf(!fixture.ok)("a library's code is its release's creation code; it has no detail shard", () => {
    if (!fixture.ok) return;
    const library = fixture.value.libraries?.find((entry) => entry.name === "PoseidonT3");
    if (!library) throw new Error("fixture has no PoseidonT3 library");
    expect(shardRef(fixture.value, "PoseidonT3", "code")).toEqual(library.release.creationCode);
    expect(shardRef(fixture.value, "PoseidonT3", "detail")).toBeUndefined();
  });

  test.skipIf(!fixture.ok)("a facet's detail is its own shard, not its release's", () => {
    if (!fixture.ok) return;
    const facet = fixture.value.facets.find((entry) => entry.name === "AccessControl");
    if (!facet) throw new Error("fixture has no AccessControl facet");
    expect(shardRef(fixture.value, "AccessControl", "detail")).toEqual(facet.detail);
    expect(shardRef(fixture.value, "AccessControl", "code")).toEqual(facet.release.creationCode);
  });
});
