/**
 * S8b's commands (contracts §5.3): open the deploy review (Deploy…, ⌘/Ctrl+Enter, the palette, `deploy [chain]`),
 * Deploy again… (Flow 13), and the review's own controls: Use a new salt, the path, the CreateX scope, Preview for
 * another account…, Copy address, Remove facets…, Download Transaction Builder batch and Choose another chain.
 *
 * In the entry chunk, like every `commands.ts`, so only what every surface needs before anything loads lives here:
 * ids, titles, keys, console parsing and `enabled` with its reasons. What they do loads on the first run
 * (`command-runs.ts`), and the review itself is a lazy dialog (spec L822).
 */
import type { CommandRef, Problem } from "@lattice-studio/core";
import { isAddress } from "@lattice-studio/core";
import { command, defineCommands, env, type CommandArgsOf, type CommandContext, type Enablement } from "@/contracts";
import { chainFromText, chainName, findChain, pickerChains } from "@/chain/infra/chains";
import { CHOOSE_A_CHAIN, unsupportedChain } from "@/chain/infra/copy";
import { prediction } from "@/state";
import {
  DEPLOY_NEEDS_CONNECTION, IN_FLIGHT_PHASES, PLACE_FACETS_FIRST, fixtureBlock, ON_ITS_WAY, SCOPE_TITLES, WAITING_FOR_SAFE,
  resolveBlockers, tickFirst,
} from "./entry-copy";

const OK: Enablement = { ok: true };
const CATALOG_LOADING = "The catalog hasn't loaded yet";

function no(reason: string, fix?: CommandRef): Enablement {
  return fix ? { ok: false, reason, fix } : { ok: false, reason };
}

/** The run half of each command, loaded on first use. */
function runs(): Promise<typeof import("./lazy")> {
  return import("./lazy");
}

function blockers(ctx: CommandContext): Problem[] {
  return ctx.analysis.problems.filter((p) => p.severity === "blocker");
}

function names(): string[] {
  return pickerChains(env.e2e).map((chain) => chain.name);
}

/**
 * What stops the review from opening at all: offline, the catalog, a fixture catalog (contracts §4, the same test
 * as S8a's `catalogDeployBlock`, kept here so its module stays out of the entry).
 */
function openBlock(ctx: CommandContext): string | null {
  if (!ctx.online) return DEPLOY_NEEDS_CONNECTION;
  if (!ctx.catalog) return CATALOG_LOADING;
  return fixtureBlock(ctx.catalog.lattice.tag);
}

function readOnly(ctx: CommandContext): Enablement | null {
  return ctx.session.readOnly === null ? null : no(ctx.session.readOnly);
}

const open = command<CommandArgsOf<"deploy.open">>({
  id: "deploy.open",
  title: () => "Deploy…",
  category: "Deploy",
  keys: ["Mod+Enter"],
  // Everywhere except text fields and dialogs (IR L13).
  keyContext: ["global", "sheet", "card-rows", "tree", "list"],
  palette: true,
  console: {
    verb: "deploy",
    syntax: "deploy [chain]",
    parse(argv) {
      const text = argv.join(" ").trim();
      if (text === "") return { ok: true, value: {} };
      const chain = chainFromText(text, env.e2e);
      return chain ? { ok: true, value: { chainId: chain.id } } : { ok: false, error: unsupportedChain(text, names()) };
    },
  },
  enabled(ctx, args) {
    const block = openBlock(ctx);
    if (block) return no(block);
    // Spec L389: read-only disables Deploy with the same reason.
    const locked = readOnly(ctx);
    if (locked) return locked;
    // Spec L385: while a Safe proposal waits, Deploy is disabled; the proposal shows in the Deployments list.
    if (ctx.deploy.phase === "proposed") return no(WAITING_FOR_SAFE);
    // Spec L378: an empty sheet says so. Checks still fire on zero facets (CORE-01 among them), but the Empty
    // state's own words are more specific than a blocker count, and this keeps the palette, ⌘Enter and the
    // title block agreeing on them (S4d's CCR 3).
    if (ctx.project.recipe.facets.length === 0) return no(PLACE_FACETS_FIRST);
    const count = blockers(ctx).length;
    // ⌘/Ctrl+Enter jumps to the first blocker instead (spec L561); every other way in is disabled with the reason.
    if (count > 0 && ctx.source !== "keys") return no(resolveBlockers(count), { id: "problem.next" });
    if (typeof args.chainId === "number" && !findChain(args.chainId, env.e2e)) {
      return no(unsupportedChain(chainName(args.chainId, env.e2e), names()));
    }
    return OK;
  },
  run: async (ctx, args) => (await runs()).runOpen(ctx, typeof args.chainId === "number" ? args.chainId : undefined),
});

const again = command({
  id: "deploy.again",
  title: () => "Deploy again…",
  category: "Deploy",
  palette: true,
  enabled(ctx) {
    const block = openBlock(ctx);
    if (block) return no(block);
    if (ctx.deploy.phase === "proposed") return no(WAITING_FOR_SAFE);
    if (ctx.project.recipe.facets.length === 0) return no(PLACE_FACETS_FIRST);
    // Deploy again… draws a new salt before the review opens (spec L584), so the current salt's address being taken
    // (NET-05: the live diamond itself) doesn't hold it back. Deploy… keeps the salt, so it still counts it.
    const count = blockers(ctx).filter((p) => p.code !== "NET-05").length;
    if (count > 0) return no(resolveBlockers(count), { id: "problem.next" });
    return readOnly(ctx) ?? OK;
  },
  run: async (ctx) => (await runs()).runAgain(ctx),
});

const newSalt = command({
  id: "deploy.newSalt",
  title: () => "Use a new salt",
  category: "Deploy",
  palette: true,
  enabled: (ctx) => readOnly(ctx) ?? OK,
  run: async () => (await runs()).runNewSalt(),
});

const usePath = command<CommandArgsOf<"deploy.usePath">>({
  id: "deploy.usePath",
  // IR L229: Use CreateX instead · Use LatticeFactory.
  title: ({ path }) => (path === "createx" ? "Use CreateX instead" : "Use LatticeFactory"),
  category: "Deploy",
  enabled(ctx, { path }) {
    if (path !== "factory" && path !== "createx") return no("Name a path: factory or createx");
    return readOnly(ctx) ?? OK;
  },
  run: async (ctx, { path }) => (await runs()).runUsePath(ctx, path),
});

const setScope = command<CommandArgsOf<"deploy.setScope">>({
  id: "deploy.setScope",
  title: ({ scope }) => SCOPE_TITLES[scope] ?? "Set the salt's scope",
  category: "Deploy",
  enabled(ctx, { scope }) {
    if (scope !== "every-chain" && scope !== "this-chain") return no("Name a scope: every-chain or this-chain");
    // IR L231: the scope applies on the CreateX path only (contracts §3.1 salt ruling).
    if (ctx.project.deploy.path !== "createx") return no("The scope applies only on the CreateX path");
    return readOnly(ctx) ?? OK;
  },
  run: async (ctx, { scope }) => (await runs()).runSetScope(ctx, scope),
});

const previewFor = command<CommandArgsOf<"deploy.previewFor">>({
  id: "deploy.previewFor",
  title: () => "Preview for another account…",
  category: "Deploy",
  enabled(ctx, { address }) {
    if (!isAddress(address)) return no("Enter an address to preview, such as a Safe");
    if (ctx.session.chainId === null) return no(CHOOSE_A_CHAIN);
    if (!ctx.catalog) return no(CATALOG_LOADING);
    return OK;
  },
  run: async (ctx, { address }) => (await runs()).runPreviewFor(ctx, address, chainName(ctx.session.chainId ?? 0, env.e2e)),
});

const copyAddress = command({
  id: "deploy.copyAddress",
  title: () => "Copy address",
  category: "Deploy",
  enabled() {
    const p = prediction();
    return p.status === "ready" ? OK : no(p.reason);
  },
  run: async () => (await runs()).runCopyAddress(),
});

const removeFacets = command({
  id: "deploy.removeFacets",
  title: () => "Remove facets…",
  category: "Deploy",
  enabled(ctx) {
    const locked = readOnly(ctx);
    if (locked) return locked;
    if (!ctx.catalog) return no(CATALOG_LOADING);
    if (ctx.analysis.plan.length === 0) return no("No facets are cut yet");
    return OK;
  },
  run: async (ctx) => (await runs()).runRemoveFacets(ctx),
});

const downloadSafeBatch = command({
  id: "deploy.downloadSafeBatch",
  title: () => "Download Transaction Builder batch",
  category: "Deploy",
  enabled(ctx) {
    const block = openBlock(ctx);
    if (block && block !== DEPLOY_NEEDS_CONNECTION) return no(block);
    const locked = readOnly(ctx);
    if (locked) return locked;
    const count = blockers(ctx).length;
    if (count > 0) return no(resolveBlockers(count), { id: "problem.next" });
    // The review's ticks are the person's consent however the deploy goes out, a Safe batch included (spec L573).
    const acked = ctx.session.acks[ctx.analysis.recipeHash] ?? [];
    const unticked = ctx.analysis.problems.filter((p) => p.ack === true && p.severity === "warning" && !acked.includes(p.id)).length;
    if (unticked > 0) return no(tickFirst(unticked));
    if (ctx.session.chainId === null) return no(CHOOSE_A_CHAIN);
    return OK;
  },
  run: async (ctx) => (await runs()).runDownloadSafeBatch(ctx),
});

const focusPicker = command({
  id: "chain.focusPicker",
  // NET-01, NET-02, NET-04 and NET-08's fix (IR L235).
  title: () => "Choose another chain",
  category: "Chain",
  enabled(ctx) {
    if (ctx.session.dialogs.some((d) => d.id === "deploy-review")) return OK;
    // Outside the review it opens one, so deploy.open's gates apply, except blockers: NET-01, 02, 04 and 08 are
    // blockers or warnings whose very fix this is.
    const block = openBlock(ctx);
    if (block) return no(block);
    const locked = readOnly(ctx);
    if (locked) return locked;
    if (ctx.deploy.phase === "proposed") return no(WAITING_FOR_SAFE);
    // A deploy on its way opens the review at its progress, where there's no picker to move to.
    if (IN_FLIGHT_PHASES.has(ctx.deploy.phase)) return no(ON_ITS_WAY);
    return OK;
  },
  run: async (ctx) => (await runs()).runFocusPicker(ctx),
});

/** In registration order. */
export const REVIEW_COMMANDS = [open, again, newSalt, usePath, setScope, previewFor, copyAddress, removeFacets, downloadSafeBatch, focusPicker];

defineCommands(REVIEW_COMMANDS);
