// The checks `bun run check` runs, in order (brief Q6; spec L897 "Type-check, lint, size budgets, schema
// drift"). A plain list so it's testable without spawning anything: `check.ts` runs each `cmd` from the repo
// root and reports pass/fail per step.
export type CheckStep = { readonly name: string; readonly cmd: readonly string[] };

export const CHECK_STEPS: readonly CheckStep[] = [
  { name: "typecheck (TypeScript 7)", cmd: ["bun", "run", "typecheck"] },
  { name: "typecheck:ts6 (TypeScript 6.0)", cmd: ["bun", "run", "typecheck:ts6"] },
  { name: "lint", cmd: ["bun", "run", "lint"] },
  { name: "size budgets", cmd: ["bun", "scripts/ci/size.ts"] },
  { name: "schema drift", cmd: ["bun", "scripts/ci/schema-drift.ts"] },
  { name: "token drift", cmd: ["bun", "run", "tokens:pull", "--", "--check"] },
  { name: "raw-color scan", cmd: ["bun", "scripts/ci/raw-color-scan.ts"] },
  { name: "copy lint", cmd: ["bun", "scripts/ci/copy-lint.ts"] },
  { name: "house rules (spec L902)", cmd: ["bun", "scripts/ci/house-rules-scan.ts"] },
  { name: "network boundary (spec L97)", cmd: ["bun", "scripts/ci/network-boundary-scan.ts"] },
  { name: "React Compiler in dist", cmd: ["bun", "scripts/ci/react-compiler-dist-check.ts"] },
];
