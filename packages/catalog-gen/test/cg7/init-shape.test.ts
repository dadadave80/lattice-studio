/**
 * The InitSpec shape both catalogs carry: no key `InitSpecSchema` doesn't name (WP-FX48). The schema is loose on
 * purpose (a newer catalog may add fields), so it accepts an `afterSource` citation instead of refusing it; this
 * is the check that nothing outside the pinned shape reaches a catalog file.
 *
 * K3's `fixtures/gen/build.ts` spreads each overlay init but drops only `path` and `source`, so the fixture
 * catalogs still carry the overlay's `afterSource` on VaultCoreInit and GovernedDiamondCutInit (FX36's dropped
 * regeneration had the one-line fix, `afterSource: _after` in `buildInits`). That file and `fixtures/catalog/**`
 * are outside this package's scope (FX48's CCR). `FIXTURE_LEAKS` names exactly that; the built catalog has none.
 */
import { describe, expect, test } from "bun:test";
import { InitSpecSchema } from "@lattice-studio/core";
import type { InitSpec } from "@lattice-studio/core";
import { loadBuiltCatalog, loadFixtureCatalog } from "@lattice-studio/core/testing";

const built = loadBuiltCatalog();
const KNOWN = new Set(Object.keys(InitSpecSchema.shape));
const ENTRY_KNOWN = new Set(["module", "with"]);

/** The keys the fixture generator lets through today, by init: what the CCR removes (then this is `{}`). */
const FIXTURE_LEAKS: Record<string, string[]> = { GovernedDiamondCutInit: ["afterSource"], VaultCoreInit: ["afterSource"] };

function unknownKeys(inits: readonly InitSpec[]): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const init of inits) {
    const extra = [
      ...Object.keys(init).filter((key) => !KNOWN.has(key)),
      ...init.initializes.flatMap((entry) => Object.keys(entry).filter((key) => !ENTRY_KNOWN.has(key)).map((key) => `initializes.${key}`)),
    ];
    if (extra.length > 0) found[init.name] = extra;
  }
  return found;
}

describe("InitSpec keys", () => {
  test("the schema names the keys the shape has (a rename or a new key fails here first)", () => {
    expect([...KNOWN].sort()).toEqual(
      ["after", "contract", "ctorArgs", "fn", "initializes", "kind", "name", "params", "registersInterfaces", "release", "sameCall", "sequence"].sort(),
    );
  });

  for (const id of ["fixture", "fixture-next"]) {
    test(`${id}: the only keys beyond the shape are the known afterSource leak on two inits (FX48 CCR); any other fails`, () => {
      const catalog = loadFixtureCatalog(id);
      if (!catalog.ok) throw new Error(catalog.error);
      expect(unknownKeys(catalog.value.inits)).toEqual(FIXTURE_LEAKS);
    });
  }

  test.skipIf(!built.ok)("the built catalog: no unknown key at all", () => {
    if (!built.ok) return;
    expect(unknownKeys(built.value.inits)).toEqual({});
  });
});

describe("ERC20VotesInit (FX36's note)", () => {
  const real = built.ok ? built.value.inits.find((init) => init.name === "ERC20VotesInit") : undefined;

  test.skipIf(!real)("the built catalog's: ERC20Votes is its own module though AccessControl comes last, and ERC20, EIP712, Nonces and Votes share one call", () => {
    expect(real?.initializes.map((entry) => entry.module)).toEqual(["EIP712", "Nonces", "Votes", "ERC20Votes", "AccessControl"]);
    expect(real?.sameCall).toEqual(["ERC20", "EIP712", "Nonces", "Votes"]);
    expect(real?.after).toEqual([]);
  });

  for (const id of ["fixture", "fixture-next"]) {
    test.skipIf(!real)(`${id}: when the fixture has one, everything a check reads matches the built catalog's (parameter docs may be worded differently)`, () => {
      const fixture = loadFixtureCatalog(id);
      if (!fixture.ok) throw new Error(fixture.error);
      const own = fixture.value.inits.find((init) => init.name === "ERC20VotesInit");
      if (!own || !real) return;
      const shape = (init: InitSpec) => ({
        fn: init.fn,
        kind: init.kind,
        params: init.params.map((p) => [p.name, p.type, p.rule, p.authority, p.role]),
        initializes: init.initializes,
        after: init.after,
        sameCall: init.sameCall,
      });
      expect(shape(own)).toEqual(shape(real));
    });
  }
});
