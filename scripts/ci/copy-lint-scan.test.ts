import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { CORE_TEMPLATE_COPY_FILES, extractAppCopy, extractTemplateCopy, isAppConstCopyFile, parseSource } from "./copy-lint-scan.ts";

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

  // FX44 §13 #18: copy-lint-scan.ts used to miss `log({text})`, `say`/`announce` arguments, `reason:`,
  // `text:` and `description:` props, and a `title: () => "…"` arrow value.
  test("a log call's text property", () => {
    expect(texts(`log({ tag: "Note", text: "Opened Settings." });`, "x.ts")).toEqual(["Opened Settings."]);
  });

  test("a disabled command's reason property", () => {
    expect(texts(`const r = { ok: false, reason: "Place facets first" };`, "x.ts")).toEqual(["Place facets first"]);
  });

  test("a description prop", () => {
    expect(texts(`const X = () => <div description="Arrives in v1.1" />;`)).toEqual(["Arrives in v1.1"]);
  });

  test("say and announce call arguments", () => {
    expect(texts(`say("The App menu isn't showing."); announce("Undo delete");`, "x.ts")).toEqual([
      "The App menu isn't showing.",
      "Undo delete",
    ]);
  });

  test("doesn't match an unrelated identifier that merely contains 'say'", () => {
    expect(texts(`essay("Please fix");`, "x.ts")).toEqual([]);
  });

  test("a title arrow function's literal body", () => {
    expect(texts(`const cmd = { title: () => "Open Settings" };`, "x.ts")).toEqual(["Open Settings"]);
  });

  test("a title arrow function's template-literal body", () => {
    const spans = extractAppCopy(parseSource("x.ts", "const cmd = { title: ({ theme }) => `Set theme to ${theme}` };"));
    expect(spans.map((s) => s.text)).toEqual(["Set theme to ", ""]);
  });

  test("a title arrow function's lookup-table fallback (a `??` default)", () => {
    expect(texts(`const cmd = { title: (a) => TITLES[a.pane] ?? "Show pane" };`, "x.ts")).toEqual(["Show pane"]);
  });
});

describe("isAppConstCopyFile", () => {
  test("matches a copy.ts module at any depth", () => {
    expect(isAppConstCopyFile("apps/studio/src/chain/deploy/copy.ts")).toBe(true);
    expect(isAppConstCopyFile("copy.ts")).toBe(true);
  });

  test("doesn't match a file that merely ends in the word copy, or a .tsx file", () => {
    expect(isAppConstCopyFile("apps/studio/src/ui/copy/copy-text.ts")).toBe(false);
    expect(isAppConstCopyFile("apps/studio/src/panels/console/actions.ts")).toBe(false);
    expect(isAppConstCopyFile("copy.tsx")).toBe(false);
  });
});

// FX44 §13 #18: in core, copy-lint.ts used to scan only narrate/{lines,narrate,problem}.ts, missing the init,
// revert, share and plan modules' labels, refusals and error copy.
describe("CORE_TEMPLATE_COPY_FILES", () => {
  const root = join(import.meta.dir, "..", "..", "packages", "core", "src");

  test("every listed file exists", () => {
    for (const f of CORE_TEMPLATE_COPY_FILES) expect(existsSync(join(root, f)), f).toBe(true);
  });

  test("covers the narrate templates plus init, revert, share and plan modules", () => {
    const groups = ["narrate/", "init/", "revert/", "share/", "plan/"];
    for (const group of groups) expect(CORE_TEMPLATE_COPY_FILES.some((f) => f.startsWith(group)), group).toBe(true);
  });

  test("extractTemplateCopy finds real copy in each listed file", () => {
    for (const f of CORE_TEMPLATE_COPY_FILES) {
      const text = readFileSync(join(root, f), "utf8");
      const spans = extractTemplateCopy(parseSource(f, text));
      expect(spans.length, f).toBeGreaterThan(0);
    }
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
