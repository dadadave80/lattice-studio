// FX8: a file or share link carrying a `"__proto__"` key anywhere is refused with the key's path, never opened
// with the key silently dropped or turned into a prototype.
import { describe, expect, test } from "bun:test";
import { deflateSync, strToU8 } from "fflate";
import { formatParseIssue } from "../canonical/parse";
import { PROTO_KEY_MESSAGE } from "../canonical/proto-key";
import { textWithProtoKey } from "../canonical/test-support";
import { encodeBase64url } from "./base64url";
import { importFile } from "./import";
import { decodeShareLink, encodeShareLink } from "./link";
import { catalog, governedVault, projectFile, tokenWithAdmin } from "./test-support";

function refused(result: ReturnType<typeof importFile> | ReturnType<typeof decodeShareLink>): string[] {
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.error.map(formatParseIssue);
}

/** A share link whose payload is exactly `text`, deflated as `encodeShareLink` does. */
function linkOfText(text: string): string {
  return `#s=1.${encodeBase64url(deflateSync(strToU8(text), { level: 9 }))}`;
}

const RECIPE_CASES: [string, (string | number)[], () => unknown][] = [
  ["__proto__", [], tokenWithAdmin],
  ["owners.__proto__", ["owners"], governedVault],
  ["init.args.p.__proto__", ["init", "args", "p"], governedVault],
  ["init.steps[0].args.__proto__", ["init", "steps", 0, "args"], tokenWithAdmin],
];

describe("recipe.json with a __proto__ key", () => {
  for (const [path, at, recipe] of RECIPE_CASES) {
    test(`refused at ${path}`, () => {
      expect(refused(importFile(textWithProtoKey(recipe(), at), "recipe.json", [catalog]))).toEqual([`recipe.json: ${path} ${PROTO_KEY_MESSAGE}`]);
    });
  }
});

describe(".lattice.json with a __proto__ key", () => {
  const cases: [string, (string | number)[]][] = [
    ["__proto__", []],
    ["project.layout.__proto__", ["project", "layout"]],
    ["project.recipe.owners.__proto__", ["project", "recipe", "owners"]],
    ["project.recipe.init.args.p.__proto__", ["project", "recipe", "init", "args", "p"]],
  ];
  for (const [path, at] of cases) {
    test(`refused at ${path}`, () => {
      const text = textWithProtoKey(projectFile(governedVault()), at);
      expect(refused(importFile(text, "vault.lattice.json", [catalog]))).toEqual([`vault.lattice.json: ${path} ${PROTO_KEY_MESSAGE}`]);
    });
  }

  test("the same file without it opens", () => {
    expect(importFile(JSON.stringify(projectFile(governedVault())), "vault.lattice.json", [catalog]).ok).toBe(true);
  });
});

describe("share link with a __proto__ key", () => {
  for (const [path, at, recipe] of RECIPE_CASES) {
    test(`refused at ${path}`, () => {
      expect(refused(decodeShareLink(linkOfText(textWithProtoKey(recipe(), at)), [catalog]))).toEqual([`${path} ${PROTO_KEY_MESSAGE}`]);
    });
  }

  test("an encoded recipe that carries the key as an own property is refused on decode, not dropped", () => {
    const recipe = JSON.parse(textWithProtoKey(governedVault(), ["init", "args", "p"])) as ReturnType<typeof governedVault>;
    expect(refused(decodeShareLink(encodeShareLink(recipe).fragment, [catalog]))).toEqual([`init.args.p.__proto__ ${PROTO_KEY_MESSAGE}`]);
  });

  test("the same link without it opens", () => {
    expect(decodeShareLink(encodeShareLink(governedVault()).fragment, [catalog]).ok).toBe(true);
  });
});
