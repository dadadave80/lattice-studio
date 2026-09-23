/**
 * Registration discovery. Importing this module evaluates every module's `commands.ts` (contracts §5.3) and
 * `services.ts` (the file where a module calls `provideServices`, `provideStores`, `provideAnalysis`,
 * `provideCatalogLoader`, `provideDeployController`, `provideSheetInteractions`, `registerDialog`, `registerInspectorView`,
 * `registerSheetLayer`, `registerNodeType` or `registerEdgeType`), so their registrations run before the app
 * renders. `main.tsx` and the test harness import it; S2's registry may glob the same files. Files under
 * `src/contracts/` are never discovered.
 *
 * Both files land in the entry chunk and in every browser test: keep them to registration calls and lazy
 * `import()`s. No IndexedDB opens, fetches or heavy imports at module evaluation.
 */
export const registrations: Readonly<Record<string, unknown>> = import.meta.glob(
  ["/src/**/commands.ts", "/src/**/services.ts", "!/src/contracts/**"],
  { eager: true },
);
