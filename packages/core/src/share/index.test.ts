import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import * as core from "../index";
import * as share from "./index";
import { catalog, tokenWithAdmin } from "./test-support";

/** Beyond C8's API: the provenance helpers S1 and S7a use, and the limits the app shows. */
const EXTRAS = ["SHARE_MAX_BYTES", "SHARE_VERSION", "SHARE_WARN_LENGTH", "argProvenance", "unconfirmedPaths"];

test("the barrel exports exactly C8's API and the deliberate extras", () => {
  const owned = Object.entries(API_OWNERS).filter(([, wp]) => wp === "C8").map(([name]) => name);
  expect(owned.toSorted()).toEqual(["decodeShareLink", "encodeShareLink", "importFile"]);
  expect(Object.keys(share).toSorted()).toEqual([...owned, ...EXTRAS].toSorted());
});

test("the package root re-exports them", () => {
  expect(core.encodeShareLink).toBe(share.encodeShareLink);
  expect(core.decodeShareLink).toBe(share.decodeShareLink);
  expect(core.importFile).toBe(share.importFile);
  expect(core.argProvenance).toBe(share.argProvenance);
  expect(core.unconfirmedPaths).toBe(share.unconfirmedPaths);
  expect(core.SHARE_WARN_LENGTH).toBe(2000);
});

test("they are built: a link opens and a file imports", () => {
  const link = share.encodeShareLink(tokenWithAdmin());
  expect(share.decodeShareLink(link.fragment, [catalog]).ok).toBe(true);
  expect(share.importFile(JSON.stringify(tokenWithAdmin()), "recipe.json", [catalog]).ok).toBe(true);
});
