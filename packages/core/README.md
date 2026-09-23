# @lattice-studio/core

The pure TypeScript core of Lattice Studio: the data model and its schemas, the analysis and checks, the cut
plan, init encoding, address prediction, exporters, the share-link codec, layout and copy. The web app, the CLI
and the tests all run it, so the sheet, the script and CI can't disagree.

Core has no DOM, React, network, clock or randomness. Where a function needs the time or random bytes, the
caller passes them in. It depends on `viem` (utilities only), `zod` and `fflate`, nothing else.

## Layout

| Path | Holds | Owner |
| --- | --- | --- |
| `src/model/` | Types, Zod schemas, the problem and command registries, the API's function types. Frozen | K1 |
| `src/index.ts` | Re-exports every module barrel. Frozen | K1 |
| `src/checks/index.ts` | The ordered check registry and `runChecks`. Frozen | K1 |
| `src/checks/<name>.ts` | One check each: sel, sem (C2) · core, dep, sto (C3) · init (C4a) · auth, link (C4c) · net (C6) | per file |
| `src/canonical/` | Canonical JSON, recipe hash, parsing, migrations | C1 |
| `src/analysis/` | `analyze`, routing, problem order | C2 |
| `src/init/plan/`, `src/init/encode/` | The init plan and fields; init calldata and references | C4a, C4b |
| `src/authority/` | Authority table and upgrade mechanisms | C4c |
| `src/plan/` | Cut plan, templates, project status | C5a |
| `src/address/`, `src/deploy/` | Address prediction and salts; deploy transactions | C5b, C5c |
| `src/revert/` | Revert decoding | C6 |
| `src/export/` | Foundry script and escaping (C7a), brief, recipe.json and JSON Schema (C7b), Safe batch (C7c) | C7a-c |
| `src/share/` | Share links and file import | C8 |
| `src/layout/` | Card sizes, free slots, Tidy, traces, notes | C9 |
| `src/narrate/`, `src/format/` | Problem messages, console lines, formats, copy lint | C10 |
| `src/edit/` | Edit ops returning `EditResult` | C11 |
| `src/testing/` | Builders and fixture loaders, exported as `@lattice-studio/core/testing` only | K1, then C12 |

## Conventions

- **Types come from `model/`.** Every public function has a type in `model/api.ts`; its implementation is
  `export const fn: FnType = …`, so a signature can't drift from the contract.
- **Stubs.** Until its owner lands, a function throws `NotImplemented`, whose message is exactly
  `Not built yet · WP-<id>`. A boundary that must not crash catches it with `isNotImplemented` and shows the
  message. Check files return no problems instead of throwing.
- **Results, not throws.** Expected failures return `Result<T, E>` (`ok` / `err`). Only programmer errors and
  `NotImplemented` throw.
- **Hex.** `Hex`, `Hex4` and `Address` are plain template-literal types, never branded. Stored and hashed hex is
  lowercase and addresses are EIP-55; parsing accepts either case and `normalizeRecipe` fixes it. Compare
  addresses with `sameAddress`.
- **Schemas.** `model/schema.ts` validates everything read from outside. Objects are loose, so unknown fields
  survive and `listUnknownFields` names them; issues come back as `{ path, message }` with paths like
  `facets[3]` and messages that read after the path ("is 3; expected text."). No transforms, so
  `z.toJSONSchema(RecipeSchema, { io: "input" })` works.
- **Problem ids** are `CODE:anchor` from `problemId`: `SEL-01:0xcdfe7f5c`, `DEP-01:VaultCore`,
  `INIT-01:bundle.p.asset`, `CORE-02:diamond`, `NET-03:11155111`; several anchors join with `+`.
- **Console lines.** `narrate` and `lines.*` return `LineDraft`s (a `ConsoleLine` without `at`); the caller
  stamps the time.

## Tests

`bun test packages/core` runs everything here. `model/spec-types.test.ts` pastes the spec's data-model block
verbatim and asserts, under `bun run typecheck`, that the model matches it field for field plus the additions
in contracts §3.1. Each module's `index.test.ts` checks its stubs name their owner; the owner replaces it.

Fixture catalogs load with `loadFixtureCatalog(id = "fixture")` from `@lattice-studio/core/testing`. It returns
a `Result`, so a test can `test.skipIf(!fixture.ok)` until the fixture exists.
