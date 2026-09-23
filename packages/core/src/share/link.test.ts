import { describe, expect, test } from "bun:test";
import { deflateSync, inflateSync, strToU8 } from "fflate";
import { canonicalJson } from "../canonical/json";
import { recipeHash } from "../canonical/hash";
import { normalizeRecipe } from "../canonical/normalize";
import { formatParseIssue } from "../canonical/parse";
import type { Catalog } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { loadFixtureCatalog, makeRecipe } from "../testing";
import { decodeBase64url, encodeBase64url } from "./base64url";
import { decodeShareLink, encodeShareLink, SHARE_MAX_BYTES } from "./link";
import { ADMIN, catalog, governedVault, SAFE, safeCut, templatedCatalog, tokenWithAdmin } from "./test-support";

const CUT_SHORT = "This link is cut short: its recipe ends early. Copy the whole link again.";

/** A fragment carrying `bytes` as its deflated payload. */
function linkOf(bytes: Uint8Array): string {
  return `#s=1.${encodeBase64url(deflateSync(bytes, { level: 9 }))}`;
}

function messages(fragment: string, catalogs: readonly Catalog[] = [catalog]): string[] {
  const decoded = decodeShareLink(fragment, catalogs);
  expect(decoded.ok).toBe(false);
  return decoded.ok ? [] : decoded.error.map(formatParseIssue);
}

/** The recipe a template loads as: the live catalog hash stamped in (contracts §3.1), then normalized. */
function loaded(recipe: Recipe, on: Catalog): Recipe {
  const stamped: Recipe = { ...recipe, catalog: { ...recipe.catalog, hash: on.hash } };
  if (stamped.template !== undefined) stamped.template = { ...stamped.template, catalogHash: on.hash };
  return normalizeRecipe(stamped, on);
}

function expectRoundTrip(recipe: Recipe, on: Catalog): number {
  const link = encodeShareLink(recipe);
  const decoded = decodeShareLink(link.fragment, [on]);
  if (!decoded.ok) throw new Error(decoded.error.map(formatParseIssue).join("\n"));
  expect(decoded.value.recipe).toEqual(recipe);
  expect(decoded.value.hash).toBe(recipeHash(recipe, on));
  expect(decoded.value.catalog).toBe(on);
  expect(decoded.value.unknownFields).toEqual([]);
  return link.length;
}

describe("encodeShareLink", () => {
  test("writes #s=1. and base64url of the deflated canonical recipe without $schema", () => {
    const recipe: Recipe = { ...tokenWithAdmin(), $schema: "https://studio.example/recipe.schema.json" };
    const link = encodeShareLink(recipe);
    expect(link.fragment.startsWith("#s=1.")).toBe(true);
    expect(link.fragment.slice(5)).toMatch(/^[A-Za-z0-9_-]+$/);
    const bytes = decodeBase64url(link.fragment.slice(5));
    if (!bytes.ok) throw new Error("not base64url");
    const { $schema: _schema, ...rest } = recipe;
    expect(new TextDecoder().decode(inflateSync(bytes.value))).toBe(canonicalJson(rest));
    expect(link.length).toBe(link.fragment.length);
    expect(link.tooLong).toBe(false);
  });

  test("is deterministic and ignores key order", () => {
    const recipe = tokenWithAdmin();
    const shuffled = Object.fromEntries(Object.entries(recipe).reverse()) as Recipe;
    expect(encodeShareLink(shuffled)).toEqual(encodeShareLink(recipe));
  });

  test("flags links over 2,000 characters", () => {
    // Random-looking text doesn't compress, so the fragment grows with it.
    let seed = 1;
    const noise = Array.from({ length: 1600 }, () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return String.fromCharCode(((seed >> 16) % 94) + 33);
    }).join("");
    const long = encodeShareLink({ ...tokenWithAdmin(), name: noise });
    expect(long.length).toBeGreaterThan(2000);
    expect(long.tooLong).toBe(true);
  });
});

describe("round trip", () => {
  test.each(templatedCatalog.recipes.map((template) => [template.name, template.recipe] as const))(
    "is the identity for the %s template",
    (_name, recipe) => {
      expectRoundTrip(loaded(recipe, templatedCatalog), templatedCatalog);
    },
  );

  test("a GovernedVault link is under 2,000 characters", () => {
    const length = expectRoundTrip(governedVault(), catalog);
    // Recorded for the report: 14 facets, 14 owners and the nine-field init, on this test catalog.
    expect(length).toBeLessThan(2000);
    expect(length).toBeGreaterThan(300);
  });

  const fixture = loadFixtureCatalog();
  const fixtureTemplates = fixture.ok ? fixture.value.recipes.map((template) => [template.name, template.recipe] as const) : [];
  test.skipIf(!fixture.ok)("the fixture catalog has templates", () => {
    expect(fixtureTemplates.length).toBeGreaterThan(0);
  });
  test.skipIf(!fixture.ok).each(fixtureTemplates)("is the identity for the fixture's %s template", (name, recipe) => {
    if (!fixture.ok) return;
    const length = expectRoundTrip(loaded(recipe, fixture.value), fixture.value);
    if (name === "GovernedVault") expect(length).toBeLessThan(2000);
  });

  test("keeps unknown fields and lists them", () => {
    const recipe = { ...tokenWithAdmin(), studioNote: "kept" } as Recipe;
    const decoded = decodeShareLink(encodeShareLink(recipe).fragment, [catalog]);
    expect(decoded.ok && decoded.value.unknownFields).toEqual(["studioNote"]);
    expect(decoded.ok && decoded.value.hash).toBe(recipeHash(tokenWithAdmin()));
  });

  test("reads a whole URL, a fragment without #, and surrounding whitespace", () => {
    const { fragment } = encodeShareLink(tokenWithAdmin());
    for (const input of [`https://studio.lattice.dev/${fragment}`, fragment.slice(1), `  ${fragment}\n`]) {
      expect(decodeShareLink(input, [catalog]).ok).toBe(true);
    }
  });
});

describe("unconfirmed authority addresses", () => {
  test("lists authority paths holding literal addresses, never references", () => {
    const token = decodeShareLink(encodeShareLink(tokenWithAdmin()).fragment, [catalog]);
    expect(token.ok && token.value.unconfirmed).toEqual(["steps[0].admin"]);
    const safe = decodeShareLink(encodeShareLink(safeCut()).fragment, [catalog]);
    expect(safe.ok && safe.value.unconfirmed).toEqual(["steps[0].safe"]);
    const vault = decodeShareLink(encodeShareLink(governedVault()).fragment, [catalog]);
    expect(vault.ok && vault.value.unconfirmed).toEqual([]);
  });

  test("opens a link on a catalog this build doesn't bundle, read-only, with every literal address unconfirmed", () => {
    const decoded = decodeShareLink(encodeShareLink(governedVault()).fragment, []);
    if (!decoded.ok) throw new Error("expected the link to open");
    expect(decoded.value.catalog).toBeNull();
    expect(decoded.value.unconfirmed).toEqual(["bundle.p.asset"]);
    expect(decoded.value.hash).toBe(recipeHash(governedVault()));
  });
});

describe("refusals", () => {
  const good = encodeShareLink(tokenWithAdmin()).fragment;

  test("every truncation of a link is cut short", () => {
    for (let keep = 6; keep < good.length; keep++) {
      expect([keep, messages(good.slice(0, keep))]).toEqual([keep, [CUT_SHORT]]);
    }
  });

  test("an empty payload has no recipe", () => {
    expect(messages("#s=1.")).toEqual(["This link has no recipe after #s=1."]);
    expect(messages("#s=1.==")).toEqual([CUT_SHORT]);
  });

  test("characters outside base64url are named with their position", () => {
    const at = 20;
    for (const char of ["!", "+", "/", " ", "é"]) {
      const broken = `${good.slice(0, 5 + at - 1)}${char}${good.slice(5 + at)}`;
      expect(messages(broken)).toEqual([`This link is damaged: ‘${char}’ at character ${at} of its recipe can't appear in a share link.`]);
    }
  });

  test("bytes that aren't deflate data don't decompress", () => {
    const junk = `#s=1.${encodeBase64url(new Uint8Array([0xff, 0xff, 0xff, 0x00, 0x12, 0x34]))}`;
    expect(messages(junk)).toEqual(["This link is damaged: its recipe doesn't decompress (invalid block type)."]);
  });

  test("decompressed bytes must be UTF-8 JSON", () => {
    expect(messages(linkOf(new Uint8Array([0x7b, 0xc3, 0x28, 0x7d])))).toEqual(["This link is damaged: its recipe isn't UTF-8 text."]);
    expect(messages(linkOf(strToU8("{\"schemaVersion\":1,")))).toEqual(["This link is damaged: its recipe isn't valid JSON."]);
  });

  test("a payload over 256 KB fails even when its first 256 KB would parse", () => {
    const json = canonicalJson(tokenWithAdmin());
    const text = json + " ".repeat(1024 * 1024 - json.length);
    expect(() => JSON.parse(text.slice(0, SHARE_MAX_BYTES))).not.toThrow();
    const fragment = linkOf(strToU8(text));
    expect(fragment.length).toBeLessThan(2000);
    expect(messages(fragment)).toEqual([
      "This link's recipe is over 256 KB once decompressed, far more than any recipe needs, so Studio didn't open it.",
    ]);
  });

  test("the cap is inclusive: exactly 256 KB opens, one byte more doesn't", () => {
    const json = canonicalJson(tokenWithAdmin());
    const at = (size: number): string => linkOf(strToU8(json + " ".repeat(size - json.length)));
    expect(decodeShareLink(at(SHARE_MAX_BYTES), [catalog]).ok).toBe(true);
    expect(decodeShareLink(at(SHARE_MAX_BYTES + 1), [catalog]).ok).toBe(false);
  });

  test("a newer share format is refused with the version it needs", () => {
    const payload = good.slice(5);
    expect(messages(`#s=2.${payload}`)).toEqual(["This link needs Studio share format v2. This Studio reads v1."]);
    expect(messages(`#s=0.${payload}`)).toEqual(["This link's format version is 0; share formats start at v1."]);
    expect(messages(`#s=x.${payload}`)).toEqual(["This link's format version is ‘x’; expected 1."]);
  });

  test("a newer recipe schema is refused with the version it needs", () => {
    const recipe = { ...tokenWithAdmin(), schemaVersion: 2 };
    expect(messages(linkOf(strToU8(JSON.stringify(recipe))))).toEqual(["This link needs Studio schema v2. This Studio reads v1."]);
  });

  test("something that isn't a share link says so", () => {
    for (const input of ["", "#", "#view=sheet", "https://studio.lattice.dev/", "s1.abc"]) {
      expect(messages(input)).toEqual(["This isn't a Studio share link: it should start with #s=1."]);
    }
  });

  test("names the catalog it pins lacks are refused with the path", () => {
    const wrong = makeRecipe({ facets: ["ERC20", "AccessControl", "DiamondLoupeFacet", "ERC20X"], init: { kind: "steps", steps: [{ spec: "OwnableInit", args: {} }] } }, catalog);
    expect(messages(encodeShareLink(wrong).fragment)).toEqual([
      "facets[3] ‘ERC20X’ isn't in Lattice 0.4.0.",
      "init.steps[0].spec ‘OwnableInit’ isn't in Lattice 0.4.0.",
    ]);
  });

  test("schema errors come back with their paths", () => {
    const bad = { ...tokenWithAdmin(), facets: "ERC20" };
    const found = messages(linkOf(strToU8(JSON.stringify(bad))));
    expect(found.length).toBe(1);
    expect(found[0]?.startsWith("facets ")).toBe(true);
  });
});

describe("hostile links", () => {
  test("script-like names stay text", () => {
    const recipe = { ...tokenWithAdmin(), name: "<img src=x onerror=alert(1)>" };
    const decoded = decodeShareLink(encodeShareLink(recipe).fragment, [catalog]);
    expect(decoded.ok && decoded.value.recipe.name).toBe("<img src=x onerror=alert(1)>");
  });

  test("deep nesting is refused, not thrown", () => {
    const depth = 100_000;
    const text = `{"schemaVersion":1,"catalog":{"tag":"v0.4.0","hash":"${catalog.hash}"},"facets":[],"owners":{},"exclude":[],"init":{"kind":"bundle","spec":"GovernedVaultInit","args":{"p":${"[".repeat(depth)}${"]".repeat(depth)}}}}`;
    expect(() => decodeShareLink(linkOf(strToU8(text)), [catalog])).not.toThrow();
    expect(decodeShareLink(linkOf(strToU8(text)), [catalog]).ok).toBe(false);
  });

  test("never throws on arbitrary input", () => {
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let round = 0; round < 500; round++) {
      const bytes = Uint8Array.from({ length: next() % 64 }, () => next() % 256);
      const inputs = [`#s=1.${encodeBase64url(bytes)}`, `#s=1.${encodeBase64url(deflateSync(bytes))}`, String.fromCharCode(...bytes)];
      for (const input of inputs) {
        const decoded = decodeShareLink(input, [catalog]);
        expect(decoded.ok ? true : decoded.error.every((issue) => issue.message.length > 0)).toBe(true);
      }
    }
  });

  test("an address in a non-authority field isn't unconfirmed, but a literal admin and Safe are", () => {
    const recipe = makeRecipe(
      {
        facets: ["DiamondLoupeFacet", "SafeDiamondCut"],
        init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: ADMIN, safe: SAFE } }] },
      },
      catalog,
    );
    const decoded = decodeShareLink(encodeShareLink(recipe).fragment, [catalog]);
    expect(decoded.ok && decoded.value.unconfirmed).toEqual(["steps[0].admin", "steps[0].safe"]);
  });
});
