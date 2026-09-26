# End-to-end kit

Shared plumbing for the Playwright suites under `apps/studio/e2e/<group>/` (Q1a-e, Q2, Q3, Q4). Suites write flows;
this folder builds and serves the app, seeds state, runs Anvil and holds the helpers. Run it with
`bun run e2e apps/studio/e2e/_support`.

## How a run works

- **Global setup** (`global-setup.ts`) builds the app with `VITE_STUDIO_E2E=1` in `--mode e2e` into
  `apps/studio/dist-e2e-<PLAYWRIGHT_PORT>` and serves it with `vite preview` on this worktree's `PLAYWRIGHT_PORT`
  (the config's `baseURL`). The e2e build adds the Anvil chain (31337) and wagmi's mock connector (contracts §5.5).
  While writing a spec, `STUDIO_E2E_REUSE_BUILD=1 bun run e2e …` skips the build when one is there.
- **Headers**: production's, except that in `--mode e2e` `connect-src` also allows `http://127.0.0.1:*` so the page
  can reach the kit's Anvil nodes (`build/headers.ts`). Everything else, CSP included, is what the host sends.
- **Network**: every request to a host other than the loopback is aborted and listed in `blockedRequests`. Nothing
  reaches a public RPC, Sourcify or ENS; a suite that needs an answer stubs it with its own `page.route`.
- **WebSockets** to non-loopback hosts are closed before they connect and listed in `blockedRequests` too (the CSP
  allows `wss:`, so the WalletConnect relay or a wss RPC would otherwise be reachable).
- **Service workers** are blocked, so routes see every request. A suite about offline or updates opts in with
  `test.use({ serviceWorkers: "allow" })`, and that weakens the guard: requests the worker makes itself, and
  responses it serves from its cache, bypass `page.route` and `blockedRequests`. Such a suite asserts on the network
  itself.

## Writing a suite

```ts
import { expect, test } from "../_support/fixtures.ts";
import { recipeProject } from "../_support/projects.ts";
import { seedProject } from "../_support/seed.ts";
import { SheetPage } from "./pages/sheet-page.ts";

test("resolves a collision from the note @smoke", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault") });
  const sheet = new SheetPage(page);
  await sheet.note("Selector collision").getByRole("button", { name: "Route to ERC20Votes" }).click();
  await expect(sheet.log).toContainText("Resolved");
});
```

- Import `test` and `expect` from `fixtures.ts`, never from `@playwright/test`.
- Tag the tests the WebKit smoke project should run with `@smoke` in the title (the config's `webkit-smoke`
  project runs only those).
- Quote the spec's copy exactly in assertions: console lines, announcements, disabled reasons.
- A test that needs a work package that hasn't landed calls `skipUnlessBuilt(page, "S6")` (`built.ts`): it skips with
  "Not built yet · WP-S6" and runs as soon as S6 lands. Never skip without a reason.

## Page objects

Each suite keeps its own page objects in `e2e/<group>/pages/`, so a suite can start as soon as its own regions have
landed.

- **One class per region**: title bar, left pane (catalog, Structure), sheet, inspector, console, and one per dialog
  or overlay (palette, deploy review, Settings). The constructor takes the `Page` and finds its root once:
  `this.root = page.getByRole("region", { name: "Inspector" })` (region names are contracts `REGION_LABELS`; `region()`
  in `keys.ts` returns one).
- **Roles and accessible names only**: `getByRole`, `getByLabel`, `getByText` for copy the spec quotes. No CSS
  selectors, no test ids, no class names. If a control can't be found by role and name, that's an accessibility
  bug to report to the owning work package, not a reason for a selector. The only attribute hooks are the stable
  ones the shell publishes: `data-layout` on the shell root (`expectTier`) and `data-theme` on `<html>`.
- **Methods are user actions and queries** named in the spec's words (`placeFacet("ERC20")`, `routeTo("ERC20Votes")`,
  `summary()`), each with a keyboard path. Assertions stay in the spec file, not the page object.
- **Keyboard-only variants** use `keys.ts` (below) and `page.keyboard`; after the page loads they never click. Use
  `modifierKey(page)` for ⌘/Ctrl, not the exported `MOD` constant: Playwright's `ControlOrMeta` resolves from the
  host running the test, not the page, so it presses ⌘ on a macOS host even against a project (Desktop Chrome) whose
  `navigator.platform` reports Windows, where Studio binds Ctrl.

## Helpers

| File | What it gives you |
| --- | --- |
| `fixtures.ts` | `test` with `blockedRequests` (automatic) and `anvil` (a fresh node on the prepared chain for this test, wired to the page) |
| `seed.ts` | `openEmpty(page)`, `seedProject(page, { project, deployments })`, `seedSettings(context, settings)`, `expectProject(page, name)` |
| `projects.ts` | Projects to seed, built with core against the real catalog: `recipeProject("GovernedVault", { filled })`, `collisionsProject()` (30 cards, SEL-01), `projectFile()` and `importedProject(file)` (From file records), `filePayload(file)` for a file chooser, `shareLink(recipe)` (`page.goto("/" + link)`), `deploymentFor(project)` |
| `anvil.ts` | `startAnvil(port)`, `acquireAnvil(port)`, `loadPrepared(node)`, `prepareAnvil(node, { recipes })`, `deployShared`, `etchVendored`, `etchSafe`, `sweepAnvils(port)`; `ALICE`, `BOB`, `SAFE` |
| `wallet.ts` | `seedAnvilRpc(context, node)`, `connectMockWallet(page)` (console `chain anvil`, palette Connect wallet, Switch network), `MOCK_ACCOUNT` |
| `keys.ts` | `nextRegion` / `previousRegion` (F6, Ctrl+F6), `focusRegion`, `focusedRegion`, `nextProblem` / `previousProblem` (F8), `openPalette`, `runInPalette(page, "Connect wallet")`, `runConsole(page, "place erc20")`, `pagePlatform`, `modifierKey(page)` (⌘ or Ctrl, from the page's own platform), `region(page, name)` |
| `axe.ts` | `expectNoAxeViolations(page, { include, disable })` and `runAxe`: the `wcag2a` to `wcag22aa` tags with `target-size` on (spec L797) |
| `viewports.ts` | `NARROW_WIDTHS` (768, 375), `viewportAt(width)` for `test.use`, `tierAt(width)`, `expectTier(page, tier)` |
| `built.ts` | `skipUnlessBuilt(page, …wps)`, `showsNotBuilt(page, wp)` |
| `catalog.ts` | The built catalog in Node, `v1Recipes()`, `neededFor(recipe)`, `sharedContracts()`, `creationCode(names)` |

### Seeding

Seeding never clicks through the UI. Settings go into localStorage before the app's first script runs;
`seedProject` writes the project and its records into the app's IndexedDB database from a same-origin page that
runs no app code, then opens the app, which lands in it the way a returning visitor lands in their last project.
Seed before anything else in the test; `seedProject` works from any page and ends on `/` (or the path you pass).

### Anvil and the wallet

Asking for the `anvil` fixture starts a fresh node for that test on `ANVIL_PORT_BASE`, 127.0.0.1 and chain 31337.
That is the only Anvil port this worktree's line owns: the ports after it belong to your helpers' lines and to the
next worktree's slot, so the kit never uses them. The port is also the lock: whatever `--workers` says, tests that ask
for `anvil` run one at a time, each waiting (up to two minutes) for the one before to stop its node. Keep Anvil flows
in few, focused tests; if Q1a-e ever need Anvil in parallel, that's a per-worktree Anvil range in `claim.ts` and
contracts §2 first.

The node holds the prepared chain: CreateX and Multicall3 (Q5's vendored runtimes, hash-checked), a stand-in Safe at
`SAFE` that answers `getThreshold()` with 2, and every v1 recipe's shared contracts deployed through Arachnid's proxy.
The first node of a run prepares it and saves `anvil_dumpState`; later ones load it in milliseconds. The fixture
points `settings.rpc[31337]` at the node and stops it after the test. The kit records each node's PID; global setup
and teardown kill any that a hard-killed worker left behind. Suites that never ask for `anvil` never start Anvil.

The mock connector connects Anvil's account 0 on the picker's first chain (Sepolia), so `connectMockWallet` selects
Anvil and switches the wallet there before anything is sent. The network guard aborts anything that would leave
the machine regardless.

### Narrow layouts

The Playwright config is frozen with two projects, so narrow widths are presets a `describe` applies:

```ts
for (const width of NARROW_WIDTHS) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: viewportAt(width) });
    test("…", async ({ page }) => {
      await openEmpty(page);
      await expectTier(page, tierAt(width)); // 768 → narrow, 375 → phone
    });
  });
}
```

## Rules

- Ports come from `.env.local` through `local-env.ts` and `env.ts`; never bind a fixed one.
- Only local Anvil. Never fork, never send to a public network, never put an RPC URL with a key in a file.
- Playwright runs under Node: nothing here may use Bun's APIs.
- Tests never read `.handoff/`.
