// Core is pure (spec L95, L102; contracts §6): no network, clock, randomness or timers. `lib: ["ES2023"]` keeps DOM
// names out at typecheck and index.test.ts keeps React, idb and `node:` imports out; this scan covers the globals
// that `types: ["bun"]` still lets through.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../src");

const FORBIDDEN: readonly [string, RegExp][] = [
  ["network", /\bfetch\s*\(|\bWebSocket\b|\bXMLHttpRequest\b|\bEventSource\b/],
  ["clock", /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)|\bperformance\.now\s*\(/],
  ["randomness", /\bMath\.random\s*\(|\bgetRandomValues\s*\(|\brandomUUID\s*\(/],
  ["timers", /\bsetTimeout\s*\(|\bsetInterval\s*\(|\bsetImmediate\s*\(|\bqueueMicrotask\s*\(/],
  ["runtime", /\bprocess\.|\bBun\./],
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "testing" ? [] : sources(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

/** Drops comments, so a doc comment may name what the code doesn't do. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("core purity", () => {
  test("no source file reaches the network, the clock, randomness, timers or the runtime", () => {
    const found: string[] = [];
    const files = sources(SRC);
    expect(files.length).toBeGreaterThan(50);
    for (const file of files) {
      const text = code(readFileSync(file, "utf8"));
      for (const [kind, pattern] of FORBIDDEN) {
        const match = pattern.exec(text);
        if (match) found.push(`${relative(SRC, file)}: ${kind} (${match[0].trim()})`);
      }
    }
    expect(found).toEqual([]);
  });

  test("the scan catches each kind", () => {
    for (const sample of ["await fetch(url)", "Date.now()", "new Date()", "Math.random()", "setTimeout(f, 1)", "Bun.file(x)"]) {
      expect([sample, FORBIDDEN.some(([, pattern]) => pattern.test(code(sample)))]).toEqual([sample, true]);
    }
    expect(FORBIDDEN.some(([, pattern]) => pattern.test(code("new Date(at) // Date.now() is the caller's")))).toBe(false);
  });
});
