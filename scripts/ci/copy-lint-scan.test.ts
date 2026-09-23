import { describe, expect, test } from "bun:test";
import { extractAppCopy, extractTemplateCopy, parseSource } from "./copy-lint-scan.ts";

function texts(source: string, fileName = "x.tsx"): string[] {
  return extractAppCopy(parseSource(fileName, source)).map((s) => s.text);
}

describe("extractAppCopy", () => {
  test("JSX text", () => {
    expect(texts(`const X = () => <button>Deploy now</button>;`)).toEqual(["Deploy now"]);
  });

  test("skips whitespace-only JSX text", () => {
    expect(texts(`const X = () => <div>\n  <span>Hi</span>\n</div>;`)).toEqual(["Hi"]);
  });

  test("title, aria-label, label and placeholder attributes, but not others", () => {
    const src = `const X = () => <input title="Recipe name" aria-label="Search catalog" placeholder="Type a name" data-id="ignored" />;`;
    expect(texts(src)).toEqual(["Recipe name", "Search catalog", "Type a name"]);
  });

  test("a JSX-expression string attribute", () => {
    expect(texts(`const X = () => <button aria-label={"Copy address"} />;`)).toEqual(["Copy address"]);
  });

  test("skips a JSX-expression attribute that isn't a literal", () => {
    expect(texts(`const X = () => <button aria-label={dynamicLabel} />;`)).toEqual([]);
  });

  test("a matching object property outside JSX", () => {
    const src = `const row = { id: "x", label: "Facet card", data: 1 };`;
    expect(texts(src, "x.ts")).toEqual(["Facet card"]);
  });

  test("toast and banner call arguments", () => {
    const src = `toast("Copied 0x1234…abcd"); showBanner("Missing shared contracts");`;
    expect(texts(src, "x.ts")).toEqual(["Copied 0x1234…abcd", "Missing shared contracts"]);
  });

  test("a member-access toast call", () => {
    expect(texts(`Toasts.push("Undo delete");`, "x.ts")).toEqual(["Undo delete"]);
  });

  test("an unrelated call is left alone", () => {
    expect(texts(`console.log("Please fix"); track("Please fix");`, "x.ts")).toEqual([]);
  });

  test("a template literal attribute splits into its literal spans, not the interpolation", () => {
    const spans = extractAppCopy(parseSource("x.tsx", `const X = () => <div title={\`Saved \${name}\`} />;`));
    expect(spans.map((s) => s.text)).toEqual(["Saved ", ""]);
  });

  test("line numbers are 1-based and point at each finding", () => {
    const src = `const X = () => (\n  <div>\n    <span>Deploy</span>\n  </div>\n);`;
    const spans = extractAppCopy(parseSource("x.tsx", src));
    expect(spans).toEqual([{ line: 3, text: "Deploy" }]);
  });
});

describe("extractTemplateCopy", () => {
  test("a template literal in a returned object property", () => {
    const src = `export const lines = { placed: ({ facet }) => ({ tag: "Placed", text: \`Placed \${facet}.\` }) };`;
    const spans = extractTemplateCopy(parseSource("x.ts", src));
    expect(spans.map((s) => s.text)).toContain("Placed ");
  });

  test("a plain returned template literal", () => {
    const src = `function renderSel01(p) { return \`\${p.selector} is exported by \${p.who}. Choose one owner.\`; }`;
    const spans = extractTemplateCopy(parseSource("x.ts", src));
    expect(spans.some((s) => s.text.includes("Choose one owner"))).toBe(true);
  });

  test("skips import and export module specifiers", () => {
    const src = `import { plural } from "../format/format"; export * from "./narrate";`;
    expect(extractTemplateCopy(parseSource("x.ts", src))).toEqual([]);
  });

  test("skips object property keys but keeps their string values", () => {
    const src = `const x = { "SEL-01": "please fix this" };`;
    const spans = extractTemplateCopy(parseSource("x.ts", src));
    expect(spans.map((s) => s.text)).toEqual(["please fix this"]);
  });
});
