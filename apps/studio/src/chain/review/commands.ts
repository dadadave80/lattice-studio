/**
 * S8b's commands (contracts §5.3): open the deploy review (Deploy…, ⌘/Ctrl+Enter, the palette, `deploy [chain]`),
 * Deploy again… (Flow 13), and the review's own controls: Use a new salt, the path, the CreateX scope, Preview for
 * another account…, Copy address, Remove facets…, Download Transaction Builder batch and Choose another chain.
 * Light: in the entry chunk, like every `commands.ts`. The review itself and the Safe batch load lazily.
 */
import type { Address, CommandRef, DeployPath, Problem, Scope } from "@lattice-studio/core";
import { formatAddress, isAddress, newEntropy, toChecksum } from "@lattice-studio/core";
import {
  announce, command, commandRef, defineCommands, deployState, doc, env, listDeployments, log, openDialog,
  randomBytes, runCommand, session, type CommandArgsOf, type CommandContext, type Enablement,
} from "@/contracts";
import { catalogDeployBlock } from "@/chain/infra";
import { chainFromText, chainName, findChain, pickerChains } from "@/chain/infra/chains";
import { CHOOSE_A_CHAIN, unsupportedChain } from "@/chain/infra/copy";
import { predict, prediction } from "@/state";
import { copyText } from "@/ui/copy/copy-text";
import { DEPLOY_NEEDS_CONNECTION, IN_FLIGHT_PHASES, WAITING_FOR_SAFE, pathName, resolveBlockers, tickFirst } from "./entry-copy";
import { requestPickerFocus, setPreview } from "./review-state";

const OK: Enablement = { ok: true };
const CATALOG_LOADING = "The catalog hasn't loaded yet";

function no(reason: string, fix?: CommandRef): Enablement {
  return fix ? { ok: false, reason, fix } : { ok: false, reason };
}

function say(text: string, tag: "Note" | "Deploy" | "Error" = "Note"): void {
  log({ tag, text });
  announce(text, tag === "Error" ? { politeness: "assertive" } : {});
}

function blockers(ctx: CommandContext): Problem[] {
  return ctx.analysis.problems.filter((p) => p.severity === "blocker");
}

function names(): string[] {
  return pickerChains(env.e2e).map((chain) => chain.name);
}

/** Opens the review, or brings it to its progress while a deploy is in flight (IR L207). */
export function openReview(): void {
  const open = session.get().dialogs.some((d) => d.id === "deploy-review");
  if (open) {
    say("The deploy review is already open.");
    return;
  }
  openDialog("deploy-review", IN_FLIGHT_PHASES.has(deployState().phase) ? { at: "progress" } : { at: "review" });
}

/** What stops the review from opening at all: offline, the catalog, a fixture catalog (contracts §4). */
function openBlock(ctx: CommandContext): string | null {
  if (!ctx.online) return DEPLOY_NEEDS_CONNECTION;
  if (!ctx.catalog) return CATALOG_LOADING;
  return catalogDeployBlock(ctx.catalog);
}

function readOnly(ctx: CommandContext): Enablement | null {
  return ctx.session.readOnly === null ? null : no(ctx.session.readOnly);
}

/** Draws new salt entropy through `doc.record` (no undo step, contracts §5.1). False when the document refused. */
function drawEntropy(label: string): boolean {
  const entropy = newEntropy(randomBytes);
  const result = doc.record(label, (project) => ({
    project: { ...project, deploy: { ...project.deploy, entropy } },
    changed: true,
    summary: label,
  }));
  return result.changed;
}

/** "this diamond would deploy to 0x…" after a salt, path or scope change, or nothing to say without a wallet. */
function whereNow(): string {
  const p = prediction();
  return p.status === "ready" ? ` This diamond would deploy to ${p.address}.` : "";
}

type OpenArgs = CommandArgsOf<"deploy.open">;

const open = command<OpenArgs>({
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
    // Spec L385: while a Safe proposal waits, Deploy is disabled; the proposal shows in the Deployments list.
    if (ctx.deploy.phase === "proposed") return no(WAITING_FOR_SAFE);
    const count = blockers(ctx).length;
    // ⌘/Ctrl+Enter jumps to the first blocker instead (spec L561); every other way in is disabled with the reason.
    if (count > 0 && ctx.source !== "keys") return no(resolveBlockers(count), { id: "problem.next" });
    if (typeof args.chainId === "number" && !findChain(args.chainId, env.e2e)) {
      return no(unsupportedChain(chainName(args.chainId, env.e2e), names()));
    }
    return OK;
  },
  async run(ctx, args) {
    const first = blockers(ctx)[0];
    if (first) {
      announce(first.message);
      await runCommand({ id: "problem.focus", args: { problemId: first.id } }, "keys");
      return;
    }
    if (typeof args.chainId === "number" && args.chainId !== ctx.session.chainId) {
      await runCommand(commandRef("chain.select", { chainId: args.chainId }), "api");
    }
    openReview();
  },
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
    const count = blockers(ctx).length;
    if (count > 0) return no(resolveBlockers(count), { id: "problem.next" });
    return readOnly(ctx) ?? OK;
  },
  async run(ctx) {
    // Flow 13, spec L286: only Deploy again after a confirmed deploy draws new entropy; "This diamond" follows it.
    const records = await listDeployments(ctx.project.id);
    // "confirmed" covers verified and live records too: Deployment.status has no "live" (core model/project.ts).
    if (records.some((d) => d.status === "confirmed")) {
      if (!drawEntropy("Drew a new salt for a new diamond")) return;
      say(`Drew a new salt for a new diamond.${whereNow()}`);
    } else {
      say("Nothing is live yet, so the salt stays as it is.");
    }
    openReview();
  },
});

const newSalt = command({
  id: "deploy.newSalt",
  title: () => "Use a new salt",
  category: "Deploy",
  palette: true,
  enabled: (ctx) => readOnly(ctx) ?? OK,
  run() {
    if (!drawEntropy("Drew a new salt")) return;
    say(`Drew a new salt.${whereNow()}`);
  },
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
  run(ctx, { path }) {
    const target: DeployPath = path;
    if (ctx.project.deploy.path === target) {
      say(`The diamond already deploys through ${pathName(target)}.`);
      return;
    }
    const label = `Deploy through ${pathName(target)}`;
    const result = doc.record(label, (project) => ({
      project: { ...project, deploy: { ...project.deploy, path: target } },
      changed: true,
      summary: label,
    }));
    if (result.changed) say(`The diamond deploys through ${target === "createx" ? "CreateX CREATE3" : "LatticeFactory"} now.${whereNow()}`);
  },
});

const SCOPE_TITLES: Record<Scope, string> = { "every-chain": "Same address on every chain", "this-chain": "This chain only" };

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
  run(ctx, { scope }) {
    const target: Scope = scope;
    if (ctx.project.deploy.scope === target) {
      say(`The salt's scope is already ${SCOPE_TITLES[target].toLowerCase()}.`);
      return;
    }
    const label = SCOPE_TITLES[target];
    const result = doc.record(label, (project) => ({
      project: { ...project, deploy: { ...project.deploy, scope: target } },
      changed: true,
      summary: label,
    }));
    if (result.changed) say(`Salt scope: ${label.toLowerCase()}.${whereNow()}`);
  },
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
  run(ctx, { address }) {
    // Spec L565: any address, such as a Safe, without connecting it. The prediction isn't recorded: it isn't this diamond's.
    const account: Address = toChecksum(address);
    const p = predict({ deploy: ctx.project.deploy, catalog: ctx.catalog, chainId: ctx.session.chainId, account: { address: account } });
    if (p.status !== "ready") {
      setPreview({ account, result: { ok: false, reason: p.reason } });
      say(p.reason);
      return;
    }
    setPreview({ account, result: { ok: true, address: p.address, chainId: p.chainId } });
    say(`Deployed by ${formatAddress(account)}, this diamond would be at ${p.address} on ${chainName(p.chainId, env.e2e)}.`);
  },
});

const copyAddress = command({
  id: "deploy.copyAddress",
  title: () => "Copy address",
  category: "Deploy",
  enabled() {
    const p = prediction();
    return p.status === "ready" ? OK : no(p.reason);
  },
  async run() {
    const p = prediction();
    if (p.status !== "ready") return;
    await copyText(p.address);
  },
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
  run(ctx) {
    openDialog("remove-facets", ctx.session.chainId === null ? {} : { chainId: ctx.session.chainId });
  },
});

const downloadSafeBatch = command({
  id: "deploy.downloadSafeBatch",
  title: () => "Download Transaction Builder batch",
  category: "Deploy",
  enabled(ctx) {
    if (!ctx.catalog) return no(CATALOG_LOADING);
    const block = catalogDeployBlock(ctx.catalog);
    if (block) return no(block);
    const count = blockers(ctx).length;
    if (count > 0) return no(resolveBlockers(count), { id: "problem.next" });
    // The review's ticks are the person's consent however the deploy goes out, a Safe batch included (spec L573).
    const acked = ctx.session.acks[ctx.analysis.recipeHash] ?? [];
    const unticked = ctx.analysis.problems.filter((p) => p.ack === true && p.severity === "warning" && !acked.includes(p.id)).length;
    if (unticked > 0) return no(tickFirst(unticked));
    if (ctx.session.chainId === null) return no(CHOOSE_A_CHAIN);
    return OK;
  },
  async run(ctx) {
    const { downloadSafeBatch: download } = await import("./safe-batch");
    await download(ctx);
  },
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
    if (ctx.deploy.phase === "proposed") return no(WAITING_FOR_SAFE);
    return OK;
  },
  run(ctx) {
    requestPickerFocus();
    // The review's picker is the one to move to; outside the review, open it first (never over a deploy's progress).
    if (!ctx.session.dialogs.some((d) => d.id === "deploy-review")) openReview();
  },
});

/** In registration order. */
export const REVIEW_COMMANDS = [open, again, newSalt, usePath, setScope, previewFor, copyAddress, removeFacets, downloadSafeBatch, focusPicker];

defineCommands(REVIEW_COMMANDS);

