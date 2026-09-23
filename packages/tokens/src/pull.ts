#!/usr/bin/env bun
// Vendors `.handoff/design/tokens.json` into this package so the package
// builds without `.handoff` present (CI, published consumers). `--check`
// reports drift instead of writing. See pull-logic.ts for the pure logic.

import { resolve } from "node:path";
import { fileIo, pullTokens } from "./pull-logic.ts";

const HERE = new URL(".", import.meta.url).pathname;
const PACKAGE_DIR = resolve(HERE, "..");
const VENDORED_PATH = resolve(PACKAGE_DIR, "tokens.json");
const SOURCE_PATH = resolve(PACKAGE_DIR, "../../.handoff/design/tokens.json");

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const result = await pullTokens(fileIo(SOURCE_PATH, VENDORED_PATH), {
    check,
    sourcePath: SOURCE_PATH,
    vendoredPath: VENDORED_PATH,
  });
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}

await main();
