/**
 * S8c's commands (contracts §5.3): Deploy missing contracts…, Sign & deploy (Sign again after a rejection), Keep
 * waiting, Check wallet and Review again once a transaction is stale, Discard proposal, and Show deploy progress (the
 * banner's action, IR L207). Each is enabled from the mirrored deploy state and says why not; each runs through the
 * controller, which loads the deploy chunk. Definitions only; `commands.ts` registers them. Light: entry chunk.
 */
import type { Analysis } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import {
  command, deployController, deployState, dialogComponent, log, openDialog, type CommandArgsOf, type CommandContext,
  type DeployController, type DeployState, type Enablement,
} from "@/contracts";
import { CANCELED_IN_WALLET, CANT_SIMULATE_HERE, DEPLOY_NEEDS_CONNECTION, DEPLOY_NOT_BUILT } from "./command-copy";

type MissingArgs = CommandArgsOf<"deploy.missingContracts">;

const OK: Enablement = { ok: true };

/** Runs a controller call; a chunk that can't load is said, not swallowed. */
async function withController(run: (controller: DeployController) => void | Promise<void>): Promise<void> {
  let controller: DeployController;
  try {
    controller = await deployController();
  } catch (error) {
    log({ tag: "Error", text: `The deploy engine couldn't load. ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  await run(controller);
}

/** NET-03's names: the shared contracts to deploy, dependencies first (its fix carries them). */
export function missingNames(analysis: Analysis): string[] {
  const problem = analysis.problems.find((p) => p.code === "NET-03");
  const fix = problem?.fixes.find((f) => f.id === "deploy.missingContracts");
  const names = fix?.args?.["names"];
  if (Array.isArray(names)) return names.filter((n): n is string => typeof n === "string");
  const params = problem?.params as { core?: unknown; missing?: unknown } | undefined;
  return [params?.core, params?.missing].flatMap((list) => (Array.isArray(list) ? list.filter((n): n is string => typeof n === "string") : []));
}

function stale(ctx: CommandContext): Enablement {
  return ctx.deploy.phase === "stale" ? OK : { ok: false, reason: "No transaction is waiting past its receipt timeout." };
}

export const missingContractsCommand = command<MissingArgs>({
  id: "deploy.missingContracts",
  title: () => "Deploy missing contracts…",
  category: "Deploy",
  // Reached from NET-03's fix and the review's Network section; in the palette it would sort before Deploy….
  palette: false,
  enabled(ctx, args) {
    const chainId = ctx.session.chainId;
    if (ctx.session.readOnly !== null) return { ok: false, reason: ctx.session.readOnly };
    if (chainId === null) return { ok: false, reason: "Choose a chain first." };
    if (!ctx.online) return { ok: false, reason: DEPLOY_NEEDS_CONNECTION };
    const names = args.names ?? missingNames(ctx.analysis);
    if (names.length === 0) return { ok: false, reason: "Nothing this recipe needs is missing on this chain." };
    return OK;
  },
  run(ctx, args) {
    const chainId = ctx.session.chainId;
    if (chainId === null) return;
    const names = args.names ?? missingNames(ctx.analysis);
    openDialog("missing-contracts", { chainId, names });
  },
});

export const signCommand = command({
  id: "deploy.sign",
  title: (): string => signTitle(deployState()),
  category: "Deploy",
  enabled(ctx) {
    const { phase, simulation } = ctx.deploy;
    // The second tab is read-only (spec L503): it keeps tracking, but it doesn't sign.
    if (ctx.session.readOnly !== null) return { ok: false, reason: ctx.session.readOnly };
    if (phase === "idle") return { ok: false, reason: "Open the deploy review first." };
    if (phase === "simulating") return { ok: false, reason: "Simulating…" };
    if (phase === "review" && simulation?.unavailable === true) {
      // The machine's own sentence names the chain (spec L575): the RPC can't simulate; the review asks for one more tick.
      return { ok: false, reason: ctx.deploy.error ?? CANT_SIMULATE_HERE };
    }
    if (phase !== "ready" && !(phase === "review" && simulation?.ok === true)) {
      return { ok: false, reason: phase === "review" ? "The simulation has to pass first." : "A deploy is already in flight." };
    }
    if (!ctx.online) return { ok: false, reason: DEPLOY_NEEDS_CONNECTION };
    const blockers = ctx.analysis.problems.filter((p) => p.severity === "blocker").length;
    if (blockers > 0) return { ok: false, reason: `Resolve ${plural(blockers, "blocker")} to deploy.` };
    const acked = new Set(ctx.session.acks[ctx.analysis.recipeHash] ?? []);
    const open = ctx.analysis.problems.filter((p) => p.ack === true && !acked.has(p.id)).length;
    if (open > 0) return { ok: false, reason: `Tick ${plural(open, "acknowledgement")} in the review first.` };
    return OK;
  },
  run: () => withController((c) => c.sign()),
});

/** "Sign again" after a rejection (Flow 12 step 5); "Sign & deploy" otherwise. */
export function signTitle(state: DeployState): string {
  return state.phase === "review" && state.error === CANCELED_IN_WALLET ? "Sign again" : "Sign & deploy";
}

export const keepWaitingCommand = command({
  id: "deploy.keepWaiting",
  title: () => "Keep waiting",
  category: "Deploy",
  palette: true,
  enabled: stale,
  run: () => withController((c) => c.keepWaiting()),
});

export const checkWalletCommand = command({
  id: "deploy.checkWallet",
  title: () => "Check wallet",
  category: "Deploy",
  // Reached from the stale deploy's own buttons; in the palette it would sort before Deploy….
  palette: false,
  enabled: stale,
  run: () => withController((c) => c.checkWallet()),
});

export const reviewAgainCommand = command({
  id: "deploy.reviewAgain",
  title: () => "Review again",
  category: "Deploy",
  palette: true,
  enabled: stale,
  run: () => withController((c) => c.reviewAgain()),
});

export const discardProposalCommand = command({
  id: "deploy.discardProposal",
  title: () => "Discard proposal",
  category: "Deploy",
  palette: true,
  enabled: (ctx) => (ctx.deploy.phase === "proposed" ? OK : { ok: false, reason: "There's no proposal to discard." }),
  run: () => withController((c) => c.discardProposal()),
});

export const showProgressCommand = command({
  id: "deploy.showProgress",
  title: () => "Show deploy progress",
  category: "Deploy",
  palette: true,
  enabled: (ctx) => (ctx.deploy.phase === "idle" ? { ok: false, reason: "No deploy is in progress." } : OK),
  run(ctx) {
    if (!dialogComponent("deploy-review")) {
      log({ tag: "Note", text: DEPLOY_NOT_BUILT });
      return;
    }
    openDialog("deploy-review", { at: "progress", ...(ctx.deploy.chainId === undefined ? {} : { chainId: ctx.deploy.chainId }) });
  },
});

/** In registration order. */
export const DEPLOY_COMMANDS = [
  missingContractsCommand,
  signCommand,
  keepWaitingCommand,
  checkWalletCommand,
  reviewAgainCommand,
  discardProposalCommand,
  showProgressCommand,
];
