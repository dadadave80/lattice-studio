import { describe, expect, test } from "bun:test";
import { hasCompilerRuntime } from "./react-compiler-dist-check-logic.ts";

describe("hasCompilerRuntime", () => {
  test("finds the compiler's memo_cache_sentinel, double-quoted", () => {
    expect(hasCompilerRuntime(['t[3]===Symbol.for("react.memo_cache_sentinel")?(s=1):s=t[3];'])).toBe(true);
  });

  test("finds it backtick-quoted, as a minifier may rewrite it", () => {
    expect(hasCompilerRuntime(["t[3]===Symbol.for(`react.memo_cache_sentinel`)?(s=1):s=t[3];"])).toBe(true);
  });

  test("false when no built file mentions it", () => {
    expect(hasCompilerRuntime(["console.log('hello');", "export const x = 1;"])).toBe(false);
  });

  // A regression this check exists to catch: react/react-dom's own bundles reference __COMPILER_RUNTIME
  // regardless of whether the app's Babel preset ran, so that string alone must never make this pass.
  test("doesn't pass on react's own __COMPILER_RUNTIME re-export, which says nothing about the app's own code", () => {
    expect(hasCompilerRuntime(["var __COMPILER_RUNTIME={c:function(e){return T.H.useMemoCache(e)}};"])).toBe(false);
  });

  test("checks across every file, not just the first", () => {
    expect(hasCompilerRuntime(["const a = 1;", "const b = 2;", 'Symbol.for("react.memo_cache_sentinel")'])).toBe(true);
  });
});
