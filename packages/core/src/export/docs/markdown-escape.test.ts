// FX8: user text in the agent brief can't form a Markdown link, image, emphasis, code span or autolink (spec
// L857: names are rendered as text). Checked two ways: the exact escapes, and `readInline`, a reading of the
// line as CommonMark's inline parser would read it, which must find no construct and give back the input.
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyze } from "../../analysis";
import type { Catalog } from "../../model/catalog";
import type { Arg, Recipe } from "../../model/recipe";
import { checkProperty, hostileString, makeCatalog, makeFacet, makeInit, makeRecipe } from "../../testing";
import { exportBrief } from "./brief";
import { cell, codeSpans, escapedLine, escapeHtml, formattedLine, oneLine } from "./markdown";
import { readInline } from "./test-support";

const LINKS = ["[x](javascript:alert(1))", "![i](x)", "*b*", "<https://x>", "Claim at https://evil.example"] as const;

const ESCAPED: Record<(typeof LINKS)[number], string> = {
  "[x](javascript:alert(1))": "\\[x\\]\\(javascript:alert\\(1\\)\\)",
  "![i](x)": "\\!\\[i\\]\\(x\\)",
  "*b*": "\\*b\\*",
  "<https://x>": "&lt;https\\://x&gt;",
  "Claim at https://evil.example": "Claim at https\\://evil.example",
};

describe("escapedLine", () => {
  for (const text of LINKS) {
    test(`${text} renders as literal text`, () => {
      expect(escapedLine(text)).toBe(ESCAPED[text]);
      expect(readInline(escapedLine(text))).toEqual({ text, openers: [] });
    });
  }

  test("bare URLs, www. hosts and emails can't become GFM autolinks, and read the same", () => {
    const cases: [string, string][] = [
      ["Claim at https://evil.example", "Claim at https\\://evil.example"],
      ["www.evil.com", "www\\.evil.com"],
      ["WWW.Evil.com", "WWW\\.Evil.com"],
      ["a@b.co", "a\\@b.co"],
      ["mailto:a@b.co", "mailto:a\\@b.co"],
    ];
    for (const [text, escaped] of cases) {
      expect(escapedLine(text)).toBe(escaped);
      expect(readInline(escapedLine(text))).toEqual({ text, openers: [] });
      expect(readInline(escapeHtml(text)).openers).not.toEqual([]);
    }
    expect(formattedLine("‘https://evil.example’ in `a://b`")).toBe("‘https\\://evil.example’ in `a://b`");
  });

  test("the rest of the punctuation that opens a construct, and a leading #", () => {
    expect(escapedLine("_u_ ~~s~~ `c` a|b back\\slash")).toBe("\\_u\\_ \\~\\~s\\~\\~ \\`c\\` a\\|b back\\\\slash");
    expect(escapedLine("# not a heading")).toBe("\\# not a heading");
    expect(escapedLine("C# and #1")).toBe("C# and #1");
  });

  test("ordinary names read exactly as written", () => {
    for (const name of ["GovernedVault", "Grant vault", "gVLT", "DEFAULT_ADMIN_ROLE", "AccessControlInit(admin)", "0xABC Vault", "Vault 🦊"]) {
      expect(readInline(escapedLine(name))).toEqual({ text: name, openers: [] });
    }
  });

  test("without the backslash escapes, the same text would open constructs (the check isn't vacuous)", () => {
    for (const text of LINKS) expect(readInline(escapeHtml(text)).openers).not.toEqual([]);
  });

  test("any hostile text renders as itself on one line, opening nothing (property)", () => {
    checkProperty(
      "escapedLine renders as text",
      fc.property(hostileString(), (text) => {
        expect(readInline(escapedLine(text))).toEqual({ text: oneLine(text), openers: [] });
        expect(readInline(cell(text))).toEqual({ text: oneLine(text), openers: [] });
      }),
    );
  });
});

describe("formattedLine keeps another WP's code spans and escapes the rest", () => {
  test("a problem message's code span is kept; quoted user text around it is escaped", () => {
    expect(formattedLine("`supportsInterface()` won't exist; wallets can't detect interfaces.")).toBe(
      "`supportsInterface()` won't exist; wallets can't detect interfaces.",
    );
    expect(formattedLine("‘[x](javascript:alert(1))’ isn't in `v0.4.0`.")).toBe("‘\\[x\\]\\(javascript:alert\\(1\\)\\)’ isn't in `v0.4.0`.");
  });

  test("a backtick run with no closer of the same length is literal text", () => {
    expect(formattedLine("a ` b")).toBe("a \\` b");
    expect(formattedLine("``a` b``")).toBe("``a` b``");
    expect(formattedLine("` a `` b")).toBe("\\` a \\`\\` b");
    expect(codeSpans("x `a` y ``b`` z")).toEqual([
      { code: false, text: "x " },
      { code: true, text: "`a`" },
      { code: false, text: " y " },
      { code: true, text: "``b``" },
      { code: false, text: " z" },
    ]);
  });

  test("in a table cell, a pipe inside a span is escaped too; outside one, always", () => {
    expect(formattedLine("`a|b` | c", true)).toBe("`a\\|b` \\| c");
    expect(formattedLine("`a|b`")).toBe("`a|b`");
  });

  test("read as CommonMark with code spans, it opens nothing else, in prose or in a table cell (property)", () => {
    checkProperty(
      "formattedLine opens only code spans",
      fc.property(hostileString(), (text) => {
        expect(readInline(formattedLine(text), true).openers).toEqual([]);
        // In a cell, GFM splits the row on any pipe without a backslash before it, spans included.
        expect(formattedLine(text, true)).not.toMatch(/(?<!\\)\|/);
        // Without backticks there's no span to keep, so it's exactly escapedLine.
        if (!text.includes("`")) expect(formattedLine(text)).toBe(escapedLine(text));
      }),
    );
  });
});

describe("the brief", () => {
  const catalog: Catalog = makeCatalog({
    lattice: { tag: "test", commit: "0".repeat(40) },
    facets: [makeFacet({ name: "DiamondLoupeFacet", area: "diamond", selectors: ["facets()"] })],
    inits: [makeInit({ name: "TokenInit", contract: "TokenInit", fn: "init(string)", kind: "step", params: [{ name: "name_", type: "string", doc: "Token name." }] })],
  });

  function briefOf(name: string, arg: Arg): string {
    const recipe: Recipe = makeRecipe(
      { name, facets: ["DiamondLoupeFacet"], init: { kind: "steps", steps: [{ spec: "TokenInit", args: { name_: arg } }] } },
      catalog,
    );
    return exportBrief({ recipe, catalog, analysis: analyze(recipe, catalog), studioVersion: "0.1.0-test" }).text;
  }

  /** The brief without its fenced blocks (the recipe.json carries the text as JSON data, as it should). */
  function outsideFences(markdown: string): string {
    return markdown.replace(/^(`{3,})[^\n]*\n[\s\S]*?\n\1$/gm, "");
  }

  for (const text of LINKS) {
    test(`${text} as the recipe name, an argument value and a field key is literal text`, () => {
      const asName = briefOf(text, "Plain");
      expect(asName.split("\n")[0]).toBe(`# ${ESCAPED[text]} agent brief`);
      const asValue = briefOf("Plain", text);
      expect(asValue).toContain(`(\`name_\`): ${ESCAPED[text]}`);
      const asKey = briefOf("Plain", { [text]: "v" });
      expect(asKey).toContain(`${ESCAPED[text]}: v`);
      for (const brief of [asName, asValue, asKey]) expect(outsideFences(brief)).not.toContain(text);
    });
  }
});
