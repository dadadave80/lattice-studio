/**
 * Registration discovery. Importing this module evaluates every module's `commands.ts` (contracts §5.3) and
 * `services.ts` (the file where a module calls `provideServices`, `provideStores`, `provideAnalysis`,
 * `provideCatalogLoader`, `provideDeployController` or `registerDialog`), so their registrations run before
 * the app renders. `main.tsx` and the test harness import it; S2's registry may glob the same files.
 *
 * Keep both files light: import heavy code lazily from inside `run` or a loader.
 */
export const registrations: Readonly<Record<string, unknown>> = import.meta.glob(
  ["/src/**/commands.ts", "/src/**/services.ts", "!/src/contracts/**"],
  { eager: true },
);
