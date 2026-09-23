/**
 * What S8b's commands do when they run. `commands.ts` keeps only what the entry chunk must have (ids, titles, keys,
 * console parsing and `enabled` with its reasons) and loads this module on the first run, so the review's actions
 * never weigh on the first load (spec L822).
 */
import type { Address, DeployPath, Scope } from "@lattice-studio/core";
import { formatAddress, newEntropy, toChecksum } from "@lattice-studio/core";
import {
  announce, commandRef, deployState, doc, listDeployments, log, openDialog, randomBytes, runCommand, session,
  type CommandContext,
} from "@/contracts";
import { predict, prediction } from "@/state";
import { copyText } from "@/ui/copy/copy-text";
import { IN_FLIGHT_PHASES, SCOPE_TITLES, pathName } from "./entry-copy";
import { requestPickerFocus, setPreview } from "./review-state";
import { downloadSafeBatch } from "./safe-batch";

function say(text: string, tag: "Note" | "Deploy" | "Error" = "Note"): void {
  log({ tag, text });
  announce(text, tag === "Error" ? { politeness: "assertive" } : {});
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

/** "This diamond would deploy to 0x…" after a salt, path or scope change, or nothing to say without a wallet. */
function whereNow(): string {
  const p = prediction();
  return p.status === "ready" ? ` This diamond would deploy to ${p.address}.` : "";
}

export async function runOpen(ctx: CommandContext, chainId: number | undefined): Promise<void> {
  const first = ctx.analysis.problems.find((p) => p.severity === "blocker");
  if (first) {
    // ⌘/Ctrl+Enter with blockers jumps to the first one, as F8 does (spec L561).
    announce(first.message);
    await runCommand({ id: "problem.focus", args: { problemId: first.id } }, "keys");
    return;
  }
  if (chainId !== undefined && chainId !== ctx.session.chainId) {
    await runCommand(commandRef("chain.select", { chainId }), "api");
  }
  openReview();
}

export async function runAgain(ctx: CommandContext): Promise<void> {
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
}

export function runNewSalt(): void {
  if (!drawEntropy("Drew a new salt")) return;
  say(`Drew a new salt.${whereNow()}`);
}

export function runUsePath(ctx: CommandContext, target: DeployPath): void {
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
}

export function runSetScope(ctx: CommandContext, target: Scope): void {
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
}

export function runPreviewFor(ctx: CommandContext, address: Address, chain: string): void {
  // Spec L565: any address, such as a Safe, without connecting it. The prediction isn't recorded: it isn't this diamond's.
  const account: Address = toChecksum(address);
  const p = predict({ deploy: ctx.project.deploy, catalog: ctx.catalog, chainId: ctx.session.chainId, account: { address: account } });
  if (p.status !== "ready") {
    setPreview({ account, result: { ok: false, reason: p.reason } });
    say(p.reason);
    return;
  }
  setPreview({ account, result: { ok: true, address: p.address, chainId: p.chainId } });
  say(`Deployed by ${formatAddress(account)}, this diamond would be at ${p.address} on ${chain}.`);
}

export async function runCopyAddress(): Promise<void> {
  const p = prediction();
  if (p.status === "ready") await copyText(p.address);
}

export function runRemoveFacets(ctx: CommandContext): void {
  openDialog("remove-facets", ctx.session.chainId === null ? {} : { chainId: ctx.session.chainId });
}

export async function runDownloadSafeBatch(ctx: CommandContext): Promise<void> {
  await downloadSafeBatch(ctx);
}

export function runFocusPicker(ctx: CommandContext): void {
  requestPickerFocus();
  // The review's picker is the one to move to; outside the review, open it first (never over a deploy's progress).
  if (!ctx.session.dialogs.some((d) => d.id === "deploy-review")) openReview();
}
