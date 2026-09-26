/**
 * What S4e's commands do (`commands.ts` registers them with their keys, titles and `enabled`): part of the
 * interactions runtime, loaded with the layer (`runtime.ts`), not the first load. Every run says what it did or
 * why it didn't (contracts §6); `enabled` has already refused what it can.
 */
import type { Hex4, Point } from "@lattice-studio/core";
import { formatSelector, plural } from "@lattice-studio/core";
import {
  announce, commandRef, doc, layoutMetrics, log, runCommand, session, type CommandArgsOf, type CommandContext,
  type Direction,
} from "@/contracts";
import { focusAfterDelete, focusCard } from "@/a11y/focus";
import { describeMove, readingOrder } from "@/a11y/positions";
import { ensureVisible, panSheet } from "@/sheet/canvas/sheet-view";
import { directionVector, nearestInDirection } from "./geometry";
import { activeCard, cardOf, enterRows, leaveRows } from "./focus";
import { cancelMoveTo, startMoveTo } from "./move-to";
import { moveLabel, nudged } from "./moves";
import { placedSelection, select } from "./selection";
import { currentSizes, viewCenter } from "./sheet-space";

type NudgeArgs = CommandArgsOf<"sheet.nudge">;
type FocusDirectionArgs = CommandArgsOf<"sheet.focusDirection">;
type AddHereArgs = CommandArgsOf<"sheet.addFacetHere">;
type CopyArgs = CommandArgsOf<"selector.copy">;
type ShowOwnerArgs = CommandArgsOf<"selector.showOwner">;

export const NO_FOCUSED_CARD = "Focus a card first";

/** Screen px an arrow pans the view when no card is selected (spec L766); Shift pans four times as far. */
export const ARROW_PAN = 48;

const DIRECTION_WORDS: Readonly<Record<Direction, string>> = {
  left: "to the left of", right: "to the right of", up: "above", down: "below",
};

/** Says why a command that passed `enabled()` still did nothing, the way `runCommand` says a reason. */
function sayReason(reason: string): void {
  log({ tag: "Note", text: reason });
  announce(reason);
}

function selected(ctx: CommandContext): string[] {
  return placedSelection(ctx.project.layout, ctx.session.selection);
}

/** Moves focus and selection to `facet`, panning it into view first (spec L755). */
async function goTo(facet: string): Promise<void> {
  if (session.get().modes.rows !== null) leaveRows(false);
  select([facet]);
  await focusCard(facet);
}

function selectAll(ctx: CommandContext): void {
  const all = readingOrder(ctx.project.layout);
  if (!select(all)) sayReason(`All ${plural(all.length, "card")} are already selected`);
}

function clearSelection(): void {
  select([]);
}

function moveTo(ctx: CommandContext): void {
  // M again leaves it, as Esc does.
  if (ctx.session.modes.moveTo) cancelMoveTo();
  else startMoveTo();
}

function nudge(ctx: CommandContext, { dir, step }: NudgeArgs): void {
  const names = selected(ctx);
  const large = step === "large";
  if (names.length === 0) {
    const by = directionVector(dir, large ? ARROW_PAN * 4 : ARROW_PAN);
    panSheet(-by.x, -by.y);
    announce(`Scrolled the sheet ${dir}.`, { merge: "sheet-scroll" });
    return;
  }
  const by = directionVector(dir, large ? ctx.settings.nudge.large : ctx.settings.nudge.small);
  // One burst per selection: presses that keep coming merge into one undo step (spec L475).
  const result = doc.burst(moveLabel(names), `nudge:${names.join("\n")}`, nudged(names, by));
  if (!result.changed) return;
  announce(describeMove(names, dir, doc.get().layout), { merge: "nudge" });
  const lead = activeCard();
  if (lead !== null && names.includes(lead)) ensureVisible(lead);
}

async function focusDirection(ctx: CommandContext, { dir }: FocusDirectionArgs): Promise<void> {
  const from = activeCard();
  if (from === null) {
    // No card to start from: the first one in reading order.
    const first = readingOrder(ctx.project.layout)[0];
    if (first !== undefined) await goTo(first);
    return;
  }
  const to = nearestInDirection(ctx.project.layout, currentSizes(), from, dir, layoutMetrics);
  if (to === null) {
    sayReason(`No card ${DIRECTION_WORDS[dir]} ${from}`);
    return;
  }
  await goTo(to);
}

async function focusEnd(ctx: CommandContext, which: "first" | "last"): Promise<void> {
  const order = readingOrder(ctx.project.layout);
  const target = which === "first" ? order[0] : order.at(-1);
  if (target !== undefined) await goTo(target);
}

function enterCardRows(): void {
  const facet = cardOf(document.activeElement) ?? activeCard();
  if (facet === null) {
    sayReason(NO_FOCUSED_CARD);
    return;
  }
  if (!enterRows(facet)) sayReason(`${facet} shows no rows at this zoom`);
}

async function removeSelected(ctx: CommandContext): Promise<void> {
  const facets = selected(ctx);
  const before = ctx.project.layout;
  const focused = cardOf(document.activeElement);
  // Focus in another region (the Structure tree, the inspector) stays with that region's own rules.
  const region = document.activeElement?.closest<HTMLElement>("[data-region]")?.dataset.region;
  const elsewhere = region !== undefined && region !== "sheet";
  if (session.get().modes.rows !== null) leaveRows(false);
  const outcome = await runCommand(commandRef("facet.remove", { facets }), ctx.source);
  if (!outcome.ok) return;
  const removed = facets.filter((name) => !doc.get().layout[name]);
  if (removed.length === 0) return;
  // Focus follows the delete rule (spec L755), unless it's on a card that stayed. After the menu or the
  // palette that ran this has closed.
  const stayed = focused !== null && !removed.includes(focused);
  if (!stayed && !elsewhere) requestAnimationFrame(() => void focusAfterDelete(removed, before));
}

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

function addFacetHere(_ctx: CommandContext, { at }: AddHereArgs): void {
  const point = isPoint(at) ? at : viewCenter();
  void runCommand(commandRef("palette.open", { mode: "facets", at: point }), "api");
}

/** The selector's catalog entry, from the named facet, else any facet that exports it. */
export function selectorEntry(ctx: CommandContext, selector: Hex4, facet?: string) {
  const facets = ctx.catalog?.facets ?? [];
  const own = facet === undefined ? undefined : facets.find((f) => f.name === facet);
  const pick = (f: (typeof facets)[number] | undefined) => f?.selectors.find((s) => s.hex === selector);
  return pick(own) ?? facets.map(pick).find((s) => s !== undefined);
}

/** `transfer · 0xa9059cbb` in code quotes (spec L670); a selector the catalog doesn't know shows as its hex. */
function selectorWords(ctx: CommandContext, selector: Hex4, facet?: string): string {
  const entry = selectorEntry(ctx, selector, facet);
  return entry ? formatSelector(entry, "dense") : `\`${selector}\``;
}

async function copy(value: string, label: string): Promise<void> {
  const { copyText } = await import("@/ui/copy/copy-text");
  await copyText(value, { label });
}

async function copySelector(ctx: CommandContext, { selector, facet }: CopyArgs): Promise<void> {
  await copy(selector, selectorWords(ctx, selector, facet));
}

async function copySignature(ctx: CommandContext, { selector, facet }: CopyArgs): Promise<void> {
  const entry = selectorEntry(ctx, selector, facet);
  if (entry) await copy(entry.signature, `\`${entry.signature}\``);
}

async function showOwner(ctx: CommandContext, { selector }: ShowOwnerArgs): Promise<void> {
  const owner = ctx.analysis.routing[selector]?.owner;
  if (owner === undefined) return;
  await runCommand(commandRef("sheet.locate", { facet: owner, selector }), "api");
  announce(`${owner} serves ${selectorWords(ctx, selector)}.`);
}

/** Every command's run, by command id. */
export const runs = {
  "sheet.selectAll": selectAll,
  "sheet.clearSelection": clearSelection,
  "sheet.moveTo": moveTo,
  "sheet.nudge": nudge,
  "sheet.focusDirection": focusDirection,
  "sheet.focusFirst": (ctx: CommandContext) => focusEnd(ctx, "first"),
  "sheet.focusLast": (ctx: CommandContext) => focusEnd(ctx, "last"),
  "sheet.enterRows": enterCardRows,
  "facet.removeSelected": removeSelected,
  "sheet.addFacetHere": addFacetHere,
  "selector.copy": copySelector,
  "selector.copySignature": copySignature,
  "selector.showOwner": showOwner,
};

export type Runs = typeof runs;
