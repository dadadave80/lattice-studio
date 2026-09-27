import { describe, expect, test } from "bun:test";
import { catalogNotesLine, defaultCatalogHash, withCatalogNotesLine } from "./catalog-hash-logic.ts";

const MANIFEST = {
  default: "dev-f4a32c8",
  catalogs: [{ id: "dev-f4a32c8", hash: "0x2ab4" }, { id: "old-tag", hash: "0xdead" }],
};

describe("defaultCatalogHash", () => {
  test("finds the default catalog's hash", () => {
    expect(defaultCatalogHash(MANIFEST)).toBe("0x2ab4");
  });

  test("null when the manifest's default doesn't match any catalog", () => {
    expect(defaultCatalogHash({ default: "missing", catalogs: MANIFEST.catalogs })).toBeNull();
  });
});

describe("catalogNotesLine", () => {
  test("names the catalog id and hash", () => {
    expect(catalogNotesLine("dev-f4a32c8", "0x2ab4")).toBe("Catalog: `dev-f4a32c8` (hash `0x2ab4`).");
  });
});

describe("withCatalogNotesLine", () => {
  test("appends the line to a non-empty body", () => {
    expect(withCatalogNotesLine("## What's changed\n- a fix", "dev-f4a32c8", "0x2ab4")).toBe(
      "## What's changed\n- a fix\n\nCatalog: `dev-f4a32c8` (hash `0x2ab4`).\n",
    );
  });

  test("doesn't duplicate the line on a second run", () => {
    const once = withCatalogNotesLine("## What's changed\n- a fix", "dev-f4a32c8", "0x2ab4");
    expect(withCatalogNotesLine(once, "dev-f4a32c8", "0x2ab4")).toBe(once);
  });

  test("handles an empty body", () => {
    expect(withCatalogNotesLine("", "dev-f4a32c8", "0x2ab4")).toBe("Catalog: `dev-f4a32c8` (hash `0x2ab4`).\n");
  });
});
