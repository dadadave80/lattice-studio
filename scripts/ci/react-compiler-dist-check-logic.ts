// Pure logic behind `bun scripts/ci/react-compiler-dist-check.ts` (spec L902, §17 audit #14: "no test or build
// check finds react/compiler-runtime in dist"): true once the built app's JS carries proof that the React
// Compiler ran, so a config regression (the Babel plugin dropped from vite.config.ts, or a preset mismatch) fails
// the build instead of only being caught by eye.
//
// The literal import specifier `"react/compiler-runtime"` doesn't survive a production build: it names a module
// inside the same `react` package the app already bundles, so Vite/Rolldown resolves and inlines it. Worse,
// react's own `react.js` re-exports a `__COMPILER_RUNTIME` binding regardless of whether anything ever imports
// `react/compiler-runtime` (`grep -c __COMPILER_RUNTIME node_modules/react/cjs/react.production.js` is 1 even
// with the compiler removed), so that name proves nothing either.
//
// What only compiled output carries is `Symbol.for("react.memo_cache_sentinel")`: the Babel React Compiler
// preset writes this exact expression inline, once per memoized value, into every component it transforms.
// Neither `react` nor `react-dom`'s own bundles mention it at all — it's purely the preset's own signature — so
// finding it in a lazy component chunk (not just the shared react/react-dom chunk) is direct evidence the
// preset ran on the app's own source, not just that the app depends on a react version that supports it.
const SENTINEL_PATTERN = /Symbol\.for\(\s*["'`]react\.memo_cache_sentinel["'`]\s*\)/;

export function hasCompilerRuntime(jsFiles: readonly string[]): boolean {
  return jsFiles.some((text) => SENTINEL_PATTERN.test(text));
}
