import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import * as core from "../index";
import * as share from "./index";
import { catalog, tokenWithAdmin } from "./test-support";

test("the share functions are C8's and exported from the package root", () => {
  for (const name of ["encodeShareLink", "decodeShareLink", "importFile"] as const) expect(API_OWNERS[name]).toBe("C8");
  expect(core.encodeShareLink).toBe(share.encodeShareLink);
  expect(core.decodeShareLink).toBe(share.decodeShareLink);
  expect(core.importFile).toBe(share.importFile);
});

test("they are built: a link opens and a file imports", () => {
  const link = share.encodeShareLink(tokenWithAdmin());
  expect(share.decodeShareLink(link.fragment, [catalog]).ok).toBe(true);
  expect(share.importFile(JSON.stringify(tokenWithAdmin()), "recipe.json", [catalog]).ok).toBe(true);
});
