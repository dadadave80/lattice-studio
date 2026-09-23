/**
 * S4e's commands (contracts §5.3): selecting, moving, nudging and reaching cards from the keyboard (IR L14-L31,
 * spec L749-L766), removing the selection, Add facet here…, and the pin menu's copies and Show owner (IR L195).
 *
 * Every command says what it did or why it didn't (contracts §6). Moves, nudges, Move to… and removes edit the
 * document, so they return the session's read-only reason from `enabled()` while one is set.
 */
import type { Hex4, Point } from "@lattice-studio/core";
import { formatSelector, moveCards, plural } from "@lattice-studio/core";
import {
  announce, command, commandRef, defineCommands, doc, layoutMetrics, log, runCommand, session, type CommandArgsOf,
  type CommandContext, type Direction, type Enablement, type KeyBinding, type KeyContext,
} from "@/contracts";
import { focusAfterDelete, focusCard } from "@/a11y/focus";
import { describeMove, readingOrder } from "@/a11y/positions";
import { ensureVisible, panSheet } from "@/sheet/canvas/sheet-view";
import { directionVector, nearestInDirection } from "./geometry";
import { activeCard, cardOf, enterRows, leaveRows } from "./focus";
import { cancelMoveTo, startMoveTo } from "./move-to";
import { moveLabel } from "./moves";
import { placedSelection, select } from "./selection";
import { currentSizes, viewCenter } from "./sheet-space";

type NudgeArgs = CommandArgsOf<"sheet.nudge">;
type FocusDirectionArgs = CommandArgsOf<"sheet.focusDirection">;
type AddHereArgs = CommandArgsOf<"sheet.addFacetHere">;
type CopyArgs = CommandArgsOf<"selector.copy">;
type ShowOwnerArgs = CommandArgsOf<"selector.showOwner">;

const SHEET: KeyContext[] = ["sheet"];
const SHEET_AND_ROWS: KeyContext[] = ["sheet", "card-rows"];
const OK: Enablement = { ok: true };

export const EMPTY_SHEET = "The sheet is empty";
export const NO_SELECTION = "Select a card first";
export const NOTHING_SELECTED = "Nothing is selected";
export const NO_FOCUSED_CARD = "Focus a card first";
export const NAME_A_SELECTOR = "Name a selector";

/** Screen px an arrow pans the view when no card is selected (spec L766); Shift pans four times as far. */
export const ARROW_PAN = 48;

const DIRECTIONS: readonly Direction[] = ["left", "right", "up", "down"];
const ARROW_KEYS: Readonly<Record<Direction, string>> = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };
const DIRECTION_WORDS: Readonly<Record<Direction, string>> = {
  left: "to the left of", right: "to the right of", up: "above", down: "below",
};

function refuse(reason: string): Enablement {
  return { ok: false, reason };
}

/** Says why a command that passed `enabled()` still did nothing, the way `runCommand` says a reason. */
function sayReason(reason: string): void {
  log({ tag: "Note", text: reason });
  announce(reason);
}

function readOnly(ctx: CommandContext): Enablement | null {
  return ctx.session.readOnly === null ? null : refuse(ctx.session.readOnly);
}

function hasCards(ctx: CommandContext): boolean {
  return Object.keys(ctx.project.layout).length > 0;
}

function selected(ctx: CommandContext): string[] {
  return placedSelection(ctx.project.layout, ctx.session.selection);
}

function isDirection(value: unknown): value is Direction {
  return typeof value === "string" && (DIRECTIONS as readonly string[]).includes(value);
}

function isHex4(value: unknown): value is Hex4 {
  return typeof value === "string" && /^0x[0-9a-f]{8}$/.test(value);
}

/** Moves focus and selection to `facet`, panning it into view first (spec L755). */
async function goTo(facet: string): Promise<void> {
  if (session.get().modes.rows !== null) leaveRows(false);
  select([facet]);
  await focusCard(facet);
}

// ── Selection ─────────────────────────────────────────────────────────────────────────────────────────

const selectAll = command({
  id: "sheet.selectAll",
  title: () => "Select all cards",
  category: "Sheet",
  keys: ["Mod+a"],
  keyContext: SHEET_AND_ROWS,
  palette: true,
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run(ctx) {
    const all = readingOrder(ctx.project.layout);
    if (!select(all)) sayReason(`All ${plural(all.length, "card")} are already selected`);
  },
});

const clearSelection = command({
  id: "sheet.clearSelection",
  title: () => "Clear the selection",
  category: "Sheet",
  palette: true,
  enabled: (ctx) => (ctx.session.selection.length > 0 ? OK : refuse(NOTHING_SELECTED)),
  run() {
    select([]);
  },
});

// ── Moving ────────────────────────────────────────────────────────────────────────────────────────────

const moveTo = command({
  id: "sheet.moveTo",
  title: () => "Move to…",
  category: "Sheet",
  keys: ["m"],
  keyContext: SHEET,
  palette: true,
  enabled(ctx) {
    if (ctx.session.modes.moveTo) return OK;
    return readOnly(ctx) ?? (selected(ctx).length > 0 ? OK : refuse(NO_SELECTION));
  },
  run(ctx) {
    // M again leaves it, as Esc does.
    if (ctx.session.modes.moveTo) cancelMoveTo();
    else startMoveTo();
  },
});

function nudgeBindings(): KeyBinding[] {
  return DIRECTIONS.flatMap((dir) => [
    { name: dir, keys: [ARROW_KEYS[dir]], args: { dir, step: "small" }, label: `Nudge ${dir}` },
    { name: `${dir}-large`, keys: [`Shift+${ARROW_KEYS[dir]}`], args: { dir, step: "large" }, label: `Nudge ${dir}, large step` },
  ]);
}

const nudge = command<NudgeArgs>({
  id: "sheet.nudge",
  title: ({ dir, step }) => (isDirection(dir) ? `Nudge ${dir}${step === "large" ? ", large step" : ""}` : "Nudge"),
  category: "Sheet",
  bindings: nudgeBindings(),
  keyContext: SHEET,
  enabled(ctx, { dir }) {
    if (!isDirection(dir)) return refuse("Nudge takes left, right, up or down");
    // With nothing selected the arrows scroll the sheet (spec L766), which read-only allows.
    if (selected(ctx).length === 0) return OK;
    return readOnly(ctx) ?? OK;
  },
  run(ctx, { dir, step }) {
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
    const result = doc.burst(moveLabel(names), `nudge:${names.join("\n")}`, (p) => moveCards(p, names, by));
    if (!result.changed) return;
    announce(describeMove(names, dir, doc.get().layout), { merge: "nudge" });
    const lead = activeCard();
    if (lead !== null && names.includes(lead)) ensureVisible(lead);
  },
});

// ── Focus ─────────────────────────────────────────────────────────────────────────────────────────────

function focusBindings(): KeyBinding[] {
  return DIRECTIONS.map((dir) => ({ name: dir, keys: [`Mod+${ARROW_KEYS[dir]}`], args: { dir } }));
}

const focusDirection = command<FocusDirectionArgs>({
  id: "sheet.focusDirection",
  title: ({ dir }) => (isDirection(dir) ? `Focus the card ${DIRECTION_WORDS[dir]} this one` : "Focus the nearest card"),
  category: "Sheet",
  bindings: focusBindings(),
  keyContext: SHEET_AND_ROWS,
  enabled(ctx, { dir }) {
    if (!isDirection(dir)) return refuse("Focus moves left, right, up or down");
    return hasCards(ctx) ? OK : refuse(EMPTY_SHEET);
  },
  async run(ctx, { dir }) {
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
  },
});

function endCard(which: "first" | "last") {
  return command({
    id: which === "first" ? "sheet.focusFirst" : "sheet.focusLast",
    title: () => `Focus the ${which} card`,
    category: "Sheet",
    keys: [which === "first" ? "Home" : "End"],
    keyContext: SHEET,
    enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
    async run(ctx) {
      const order = readingOrder(ctx.project.layout);
      const target = which === "first" ? order[0] : order.at(-1);
      if (target !== undefined) await goTo(target);
    },
  });
}

const enterRowsCommand = command({
  id: "sheet.enterRows",
  title: () => "Go into the card's rows",
  category: "Sheet",
  keys: ["Enter"],
  keyContext: SHEET,
  enabled: (ctx) => (hasCards(ctx) ? OK : refuse(EMPTY_SHEET)),
  run() {
    const facet = cardOf(document.activeElement) ?? activeCard();
    if (facet === null) {
      sayReason(NO_FOCUSED_CARD);
      return;
    }
    if (!enterRows(facet)) sayReason(`${facet} shows no rows at this zoom`);
  },
});

// ── Removing and placing ──────────────────────────────────────────────────────────────────────────────

const removeSelected = command({
  id: "facet.removeSelected",
  title: () => {
    const names = placedSelection(doc.get().layout, session.get().selection);
    return names.length === 1 ? `Remove ${names[0] ?? ""}` : names.length > 1 ? `Remove ${plural(names.length, "facet")}` : "Remove the selected facets";
  },
  category: "Build",
  keys: ["Delete", "Backspace"],
  keyContext: SHEET_AND_ROWS,
  palette: true,
  enabled: (ctx) => readOnly(ctx) ?? (selected(ctx).length > 0 ? OK : refuse("Select a facet to remove")),
  async run(ctx) {
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
  },
});

function isPoint(value: unknown): value is Point {
  if (typeof value !== "object" || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y);
}

const addFacetHere = command<AddHereArgs>({
  id: "sheet.addFacetHere",
  title: () => "Add facet here…",
  category: "Sheet",
  enabled: (ctx) => readOnly(ctx) ?? OK,
  run(_ctx, { at }) {
    const point = isPoint(at) ? at : viewCenter();
    void runCommand(commandRef("palette.open", { mode: "facets", at: point }), "api");
  },
});

// ── Pins ──────────────────────────────────────────────────────────────────────────────────────────────

/** The selector's catalog entry, from the named facet, else any facet that exports it. */
function selectorEntry(ctx: CommandContext, selector: Hex4, facet?: string) {
  const facets = ctx.catalog?.facets ?? [];
  const own = facet === undefined ? undefined : facets.find((f) => f.name === facet);
  const pick = (f: (typeof facets)[number] | undefined) => f?.selectors.find((s) => s.hex === selector);
  return pick(own) ?? facets.map(pick).find((s) => s !== undefined);
}

async function copy(value: string, label: string): Promise<void> {
  const { copyText } = await import("@/ui/copy/copy-text");
  await copyText(value, { label });
}

const copySelector = command<CopyArgs>({
  id: "selector.copy",
  title: () => "Copy selector",
  category: "Build",
  enabled: (_ctx, { selector }) => (isHex4(selector) ? OK : refuse(NAME_A_SELECTOR)),
  async run(ctx, { selector, facet }) {
    const entry = selectorEntry(ctx, selector, facet);
    await copy(selector, entry ? formatSelector(entry, "dense") : `\`${selector}\``);
  },
});

const copySignature = command<CopyArgs>({
  id: "selector.copySignature",
  title: () => "Copy signature",
  category: "Build",
  enabled(ctx, { selector, facet }) {
    if (!isHex4(selector)) return refuse(NAME_A_SELECTOR);
    if (!ctx.catalog) return refuse("The catalog hasn't loaded yet");
    return selectorEntry(ctx, selector, facet) ? OK : refuse(`No facet in the catalog exports ${selector}`);
  },
  async run(ctx, { selector, facet }) {
    const entry = selectorEntry(ctx, selector, facet);
    if (entry) await copy(entry.signature, `\`${entry.signature}\``);
  },
});

function ownerOf(ctx: CommandContext, selector: Hex4): string | undefined {
  return ctx.analysis.routing[selector]?.owner;
}

function selectorWords(ctx: CommandContext, selector: Hex4): string {
  const entry = selectorEntry(ctx, selector);
  return entry ? formatSelector(entry, "dense") : `\`${selector}\``;
}

const showOwner = command<ShowOwnerArgs>({
  id: "selector.showOwner",
  title: () => "Show owner",
  category: "Build",
  enabled(ctx, { selector }) {
    if (!isHex4(selector)) return refuse(NAME_A_SELECTOR);
    const owner = ownerOf(ctx, selector);
    if (owner === undefined) return refuse(`No facet serves ${selectorWords(ctx, selector)}`);
    return ctx.project.layout[owner] ? OK : refuse(`${owner} isn't on the sheet`);
  },
  async run(ctx, { selector }) {
    const owner = ownerOf(ctx, selector);
    if (owner === undefined) return;
    await runCommand(commandRef("sheet.locate", { facet: owner, selector }), "api");
    announce(`${owner} serves ${selectorWords(ctx, selector)}.`);
  },
});

export const interactCommands = [
  selectAll, clearSelection, moveTo, nudge, focusDirection, endCard("first"), endCard("last"), enterRowsCommand,
  removeSelected, addFacetHere, copySelector, copySignature, showOwner,
];

defineCommands(interactCommands);
