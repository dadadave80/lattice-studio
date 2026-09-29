#!/usr/bin/env bun
// Builds dist/tokens.css, dist/tokens.ts, dist/shiki-dark.json,
// dist/shiki-light.json and README.md from the vendored tokens.json (run
// `bun run tokens:pull` first if design/tokens.json changed upstream).
// Pure and deterministic: two runs produce byte-identical output.

import { resolve } from "node:path";
import { renderCss } from "./render-css.ts";
import { renderReadme } from "./render-readme.ts";
import { renderShikiTheme } from "./render-shiki.ts";
import { renderTokensTs } from "./render-ts.ts";
import { parseTokensJson } from "./tokens-json.ts";

const HERE = new URL(".", import.meta.url).pathname;
const PACKAGE_DIR = resolve(HERE, "..");
const VENDORED_TOKENS_JSON = resolve(PACKAGE_DIR, "tokens.json");
const DIST_DIR = resolve(PACKAGE_DIR, "dist");

async function main(): Promise<void> {
  const source = await Bun.file(VENDORED_TOKENS_JSON).text();
  const json = parseTokensJson(source);

  const outputs: Record<string, string> = {
    [resolve(DIST_DIR, "tokens.css")]: renderCss(json),
    [resolve(DIST_DIR, "tokens.ts")]: renderTokensTs(json),
    [resolve(DIST_DIR, "shiki-dark.json")]: renderShikiTheme("dark"),
    [resolve(DIST_DIR, "shiki-light.json")]: renderShikiTheme("light"),
    [resolve(PACKAGE_DIR, "README.md")]: renderReadme(),
  };

  for (const [path, contents] of Object.entries(outputs)) {
    await Bun.write(path, contents);
  }

  const written = Object.keys(outputs).map((path) => path.replace(`${PACKAGE_DIR}/`, ""));
  console.log(`tokens build · wrote ${written.join(", ")}`);
}

await main();
