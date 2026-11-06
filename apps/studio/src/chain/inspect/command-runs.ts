import { sameAddress, type Address } from "@lattice-studio/core";
import { announce, log, openDialog, session, type CommandArgsOf } from "@/contracts";
import { downloadFile } from "@/panels/console/download";
import { requestInspectorFocus } from "@/panels/inspector/focus-request";
import { copyText } from "@/ui/copy/copy-text";
import { closeInspection, getInspectionEngine, openInspection } from "./app";
import type { InspectionTarget } from "./engine";

function say(text: string, error = false): void {
  log({ tag: error ? "Error" : "Note", text });
  announce(text, error ? { politeness: "assertive" } : {});
}

export async function runOpen(args: CommandArgsOf<"inspect.open">): Promise<void> {
  if (args.target === undefined) {
    openDialog("open-diamond", args.chainId === undefined ? {} : { chainId: args.chainId });
    say("Opened the deployed diamond dialog.");
    return;
  }
  const result = await openInspection({ target: args.target, ...(args.chainId === undefined ? {} : { chainId: args.chainId }) });
  if (!result.ok) { say(result.error, true); return; }
  say("Opened the deployed diamond for inspection.");
}

export function runClose(): void { closeInspection(); say("Returned to the composition."); }

export async function runRefresh(target: InspectionTarget): Promise<void> {
  const engine = getInspectionEngine();
  await engine.refresh(target);
  const state = engine.get(target);
  if (state.status === "error") say(state.reason, true);
  else if ("value" in state) say(`Refreshed inspection at block ${state.value.snapshot.block}.`);
  else say("Inspection was canceled.");
}

export async function runCopyAddress(target: InspectionTarget): Promise<void> {
  const copied = await copyText(target.address);
  say(copied.ok ? `Copied ${copied.text}.` : "The diamond address is ready to copy.");
}

export function runExportPassport(target: InspectionTarget): void {
  const state = getInspectionEngine().get(target);
  if (!("value" in state)) { say("Inspect the diamond before downloading its passport.", true); return; }
  try {
    downloadFile({
      filename: `passport-${target.chainId}-${target.address.toLowerCase()}.json`, mime: "application/json",
      text: `${JSON.stringify(state.value.passport, null, 2)}\n`,
    });
    say("Downloaded the diamond passport.");
  } catch { say("The passport couldn't be downloaded. Retry the download.", true); }
}

export function runSelectFacet(args: InspectionTarget & { facetAddress?: Address; focus?: boolean }): void {
  const state = getInspectionEngine().get(args);
  if (!("value" in state)) { say("Inspect the diamond before selecting a facet.", true); return; }
  if (args.facetAddress !== undefined && !state.value.facets.some((facet) => sameAddress(facet.address, args.facetAddress!))) {
    say("That facet isn't routed by this diamond.", true); return;
  }
  session.set((current) => ({ panes: { ...current.panes, inspector: { ...current.panes.inspector, open: true, view: { kind: "deployed", ...state.value.target, ...(args.facetAddress === undefined ? {} : { facetAddress: args.facetAddress }) } } } }));
  if (args.focus !== false) requestInspectorFocus({ kind: "heading" });
  say(args.facetAddress === undefined ? "Selected the deployed diamond." : `Selected deployed facet ${args.facetAddress}.`);
}
