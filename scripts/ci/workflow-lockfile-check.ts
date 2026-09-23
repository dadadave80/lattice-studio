// Pure logic behind workflows.test.ts's lockfile-pin check: a `bunx`/`bun x`/`npx` invocation that pins an
// exact `pkg@version` must be a version bun.lock actually resolved, so a workflow step can never quietly fetch
// an unreviewed package version from the registry at run time (spec "Compromised npm dependency": frozen
// lockfile, reviewed dependencies). An unversioned `bun x <tool>` (no `@version`) is unaffected: it resolves
// whatever bun.lock already pins for that package, exactly like `bun x lhci` or `bun x playwright`.
export type PinnedRunner = { readonly pkg: string; readonly version: string };

const RUNNER_PATTERN = /\b(?:bunx|bun\s+x|npx)\s+((?:@[^\s@/]+\/)?[^\s@]+)@([\w.-]+)/g;

/** Every `pkg@version` a `bunx`/`bun x`/`npx` invocation pins, in one shell command string. */
export function findPinnedRunners(command: string): PinnedRunner[] {
  return [...command.matchAll(RUNNER_PATTERN)].map((m) => ({ pkg: m[1] ?? "", version: m[2] ?? "" }));
}

/** True when bun.lock records `pkg` resolved at exactly `version`: its packages section holds entries like
 * `"@lhci/cli": ["@lhci/cli@0.15.1", ...]`, so the resolved spec is a `"pkg@version"` quoted substring. */
export function isLockfilePinned(runner: PinnedRunner, bunLockText: string): boolean {
  return bunLockText.includes(`"${runner.pkg}@${runner.version}"`);
}
